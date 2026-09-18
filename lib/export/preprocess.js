const path = require('path');
const { ALERT_KIND_MAP } = require('../convert/alert-icons');
const { parseFrontmatter } = require('../convert/frontmatter');
const {
  maskCodeRegions,
  replaceOutsideCode,
  canvasItemUrl,
} = require('../convert/link-resolver');

/**
 * Convert GFM blockquote alerts (`> [!NOTE] ...`) into pandoc fenced divs
 * (`::: {.alert .note}`). Alerts inside fenced code blocks are left untouched.
 *
 * Which markers count is not this module's answer: the table is ALERT_KIND_MAP
 * in lib/convert/alert-icons.js, where the preview site reads it too, so an
 * export and a preview of the same page recognise the same set. It lived here
 * once, which left the preview site's remark plugin importing its vocabulary
 * from the PDF export preprocessor.
 *
 * @param {string} md
 * @returns {string}
 */
function alertsToDivs(md) {
  const lines = md.split('\n');
  const out = [];
  let inFence = false;
  let fenceMarker = '';

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const fence = line.match(/^\s*(`{3,}|~{3,})/);

    if (inFence) {
      out.push(line);
      if (
        fence &&
        fence[1][0] === fenceMarker[0] &&
        fence[1].length >= fenceMarker.length
      ) {
        inFence = false;
        fenceMarker = '';
      }
      continue;
    }
    if (fence) {
      inFence = true;
      fenceMarker = fence[1];
      out.push(line);
      continue;
    }

    const alertMatch = line.match(/^\s*>\s*\[!(\w+)\]\s?(.*)$/i);
    if (alertMatch) {
      const kind = ALERT_KIND_MAP[alertMatch[1].toLowerCase()];
      if (!kind) {
        out.push(line);
        continue;
      }
      const body = [];
      const firstInline = alertMatch[2].trim();
      if (firstInline) body.push(firstInline);

      let j = i + 1;
      while (j < lines.length && /^\s*>/.test(lines[j])) {
        body.push(lines[j].replace(/^\s*>\s?/, ''));
        j += 1;
      }
      while (body.length && body[0].trim() === '') body.shift();
      while (body.length && body[body.length - 1].trim() === '') body.pop();

      out.push(`::: {.alert .${kind}}`);
      out.push(...body);
      out.push(':::');
      i = j - 1;
      continue;
    }

    out.push(line);
  }

  return out.join('\n');
}

/**
 * Shift ATX heading levels by `by`, clamped to [1, 6]. Headings inside fenced
 * code blocks are left untouched.
 *
 * @param {string} md
 * @param {number} by
 * @returns {string}
 */
function shiftHeadings(md, by) {
  if (!by) return md;
  const masked = maskCodeRegions(md).split('\n');
  const lines = md.split('\n');
  return lines
    .map((line, idx) => {
      // A heading only counts when the code-masked view still shows the hashes.
      // The mask blanks inline code too, so a heading whose text is a code span
      // (## `void`) has nothing after its hashes there: the text is read from
      // the real line.
      if (!/^#{1,6}\s/.test(masked[idx])) return line;
      const m = line.match(/^(#{1,6})(\s+)(\S.*)$/);
      if (!m) return line;
      const level = Math.max(1, Math.min(6, m[1].length + by));
      return '#'.repeat(level) + m[2] + m[3];
    })
    .join('\n');
}

/**
 * Rewrite relative image references to absolute filesystem paths so a single
 * combined pandoc run (in a temp dir) can still find them. External, absolute,
 * and data: URLs are left untouched, as are references inside code.
 *
 * @param {string} md
 * @param {string} relativePath - Item path relative to course/ (posix).
 * @param {string} courseDir - Absolute path to course/.
 * @returns {string}
 */
function rewriteImagePaths(md, relativePath, courseDir) {
  const currentDir = path.posix.dirname(relativePath);
  return replaceOutsideCode(md, /!\[[^\]]*\]\(([^)]+)\)/g, (real) => {
    const m = real.match(/^(!\[[^\]]*\]\()([^)]+)(\))$/);
    if (!m) return real;
    const href = m[2];
    const bare = href.split(/\s+/)[0];
    if (
      /^(https?:\/\/|\/\/|#|mailto:|data:)/.test(bare) ||
      bare.startsWith('/')
    ) {
      return real;
    }
    const cleaned = bare.replace(/^\.\//, '');
    const abs = path.resolve(courseDir, currentDir, cleaned);
    return `${m[1]}${abs}${m[3]}`;
  });
}

/**
 * Rewrite cross-item markdown links. Links whose target is included in the
 * export become internal anchors; links to items outside the export are
 * unlinked to plain text, with an inline footnote pointing at the Canvas URL
 * when one is known.
 *
 * @param {string} md
 * @param {string} relativePath - Item path relative to course/ (posix).
 * @param {object} ctx
 * @param {Set<string>} ctx.includedPaths - relativePaths in this export.
 * @param {(relPath: string) => string} ctx.anchorFor - anchor id for a path.
 * @param {Map<string, {canvasType: string, canvasId: string|number}>} [ctx.linkMap]
 * @param {string|number} [ctx.courseId]
 * @param {string} [ctx.onlineLabel] - Footnote prefix for out-of-export links.
 * @returns {string}
 */
function rewriteCrossLinks(md, relativePath, ctx) {
  const currentDir = path.posix.dirname(relativePath);
  const { includedPaths, anchorFor, linkMap, courseId } = ctx;
  const onlineLabel = ctx.onlineLabel || 'Online:';

  return replaceOutsideCode(md, /\[([^\]]+)\]\(([^)]+)\)/g, (real) => {
    const m = real.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (!m) return real;
    const text = m[1];
    const href = m[2];
    if (/^(https?:\/\/|\/\/|mailto:)/.test(href)) return real;
    // Same-page fragment links (`#`, `#some-heading`) reference anchors from the
    // original page that do not survive the merge, so unlink them to plain text.
    // Our own generated internal links use `#sec-...` and are produced below.
    if (href.startsWith('#')) return text;

    const hashIndex = href.indexOf('#');
    const pathPart = hashIndex >= 0 ? href.slice(0, hashIndex) : href;
    if (!pathPart.endsWith('.md')) return real;

    const target = path.posix.normalize(path.posix.join(currentDir, pathPart));

    if (includedPaths.has(target)) {
      return `[${text}](#${anchorFor(target)})`;
    }

    // Target not in the export: drop the link, optionally footnote the Canvas URL.
    if (linkMap && courseId != null) {
      const entry = linkMap.get(target);
      if (entry) {
        const url = canvasItemUrl(courseId, entry.canvasType, entry.canvasId);
        return `${text}^[${onlineLabel} ${url}]`;
      }
    }
    return text;
  });
}

/**
 * Full per-item preprocessing pipeline: strip frontmatter, normalize alerts,
 * rewrite image paths and cross-links, and shift headings for the target
 * heading level.
 *
 * @param {string} rawMd - Raw file content (may include frontmatter).
 * @param {object} item - Scanner item ({ relativePath, ... }).
 * @param {object} ctx
 * @param {string} ctx.courseDir - Absolute path to course/.
 * @param {Set<string>} ctx.includedPaths
 * @param {(relPath: string) => string} ctx.anchorFor
 * @param {number} [ctx.headingShift]
 * @param {Map} [ctx.linkMap]
 * @param {string|number} [ctx.courseId]
 * @returns {string} Processed markdown body.
 */
function preprocessItem(rawMd, item, ctx) {
  const { content } = parseFrontmatter(rawMd);
  let md = content;
  md = alertsToDivs(md);
  md = rewriteImagePaths(md, item.relativePath, ctx.courseDir);
  md = rewriteCrossLinks(md, item.relativePath, ctx);
  md = shiftHeadings(md, ctx.headingShift || 0);
  return md.trim();
}

module.exports = {
  alertsToDivs,
  shiftHeadings,
  rewriteImagePaths,
  rewriteCrossLinks,
  preprocessItem,
};
