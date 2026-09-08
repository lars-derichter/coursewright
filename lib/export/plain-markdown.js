const fs = require('fs');
const path = require('path');

const { flattenItems } = require('../convert/course-scanner');
const { getLabels } = require('../config/labels');
const { parseFrontmatter } = require('../convert/frontmatter');
const { replaceOutsideCode } = require('../convert/link-resolver');
const { REFERENCE_TYPES } = require('./assemble');
const { shiftHeadings } = require('./preprocess');

/**
 * The plain-markdown flavour of the export: one file a student can attach to a
 * chatbot as a study pack. It is the twin of ./assemble.js and ./preprocess.js,
 * which build the same document for pandoc.
 *
 * It is a separate module because the two documents share no output. Every
 * string emitted here differs: no fenced divs, no `{#sec-...}` anchors, no YAML
 * block, no absolute image paths, no footnotes. The pandoc pair is pinned line
 * by line by test/export/assemble.test.js and test/export/preprocess.test.js,
 * so branching it on a format flag would put those assertions at risk for a
 * format that reuses none of them. What is format-neutral is imported instead:
 * shiftHeadings, REFERENCE_TYPES, flattenItems.
 */

/**
 * Stands in for a span that was taken out, so the line pass below can tell a
 * removal from whitespace the author typed. U+FFFC (object replacement
 * character) rather than a control character: it never occurs in course prose
 * and it keeps the regexes clear of ESLint's no-control-regex.
 */
const REMOVED = '￼';

/** Matches one removal together with the horizontal space around it. */
const REMOVED_PATTERN = new RegExp(`([ \\t]*)${REMOVED}([ \\t]*)`, 'g');

/**
 * Resolve the removals left by replaceAndTidy. A removal between words closes
 * up to a single space; a removal that was the whole line takes the line with
 * it, and with it the blank line it would otherwise have doubled, so a stripped
 * comment or image leaves no gap where it stood.
 *
 * @param {string} text - Markdown carrying REMOVED markers.
 * @returns {string}
 */
function collapseRemovals(text) {
  const lines = text.split('\n');
  const out = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.includes(REMOVED)) {
      out.push(line);
      continue;
    }

    const cleaned = line
      .replace(REMOVED_PATTERN, (match, before, after) =>
        before || after ? ' ' : '',
      )
      .replace(/[ \t]+$/, '');

    if (cleaned.trim() !== '') {
      out.push(cleaned);
      continue;
    }

    // Nothing survives on this line. Drop it, and swallow the blank lines that
    // now sit against a blank line (or against the top of the document).
    if (out.length === 0 || out[out.length - 1].trim() === '') {
      while (i + 1 < lines.length && lines[i + 1].trim() === '') i += 1;
    }
  }

  return out.join('\n');
}

/**
 * Replace every match of `regex` outside code, an empty answer from `replacer`
 * meaning "take this out", then tidy the whitespace the removals left.
 *
 * @param {string} md
 * @param {RegExp} regex - Must have the global flag.
 * @param {(realMatch: string) => string} replacer
 * @returns {string}
 */
function replaceAndTidy(md, regex, replacer) {
  const marked = replaceOutsideCode(md, regex, (real) => {
    const replacement = replacer(real);
    return replacement === '' ? REMOVED : replacement;
  });
  return marked.includes(REMOVED) ? collapseRemovals(marked) : marked;
}

/**
 * Strip HTML comments, single-line and multi-line alike. Comments inside code
 * survive: there they are the example, not a note.
 *
 * Authors leave notes to themselves in comments, and /lesson-module-build
 * leaves image-TODO blocks. Both are invisible in the preview and in the PDF,
 * and both are plainly visible in a raw markdown file a student uploads.
 *
 * @param {string} md
 * @returns {string}
 */
function stripHtmlComments(md) {
  return replaceAndTidy(md, /<!--[\s\S]*?-->/g, () => '');
}

/**
 * Replace every image, markdown or raw `<img>`, by its alt text in italics, and
 * remove the ones that have none. Images inside code are left alone.
 *
 * Every source is dropped, remote ones included: the pack is text for a
 * chatbot, not a document to render, so a path or a URL it cannot follow would
 * be noise. The alt text is the part that carries meaning into the conversation.
 *
 * @param {string} md
 * @returns {string}
 */
function stripImages(md) {
  const withoutMarkdown = replaceAndTidy(
    md,
    /!\[[^\]]*\]\([^)]*\)/g,
    (real) => {
      const m = real.match(/^!\[([^\]]*)\]/);
      const alt = m ? m[1].trim() : '';
      return alt ? `*${alt}*` : '';
    },
  );

  return replaceAndTidy(withoutMarkdown, /<img\b[^>]*>/gi, (real) => {
    const m = real.match(/\balt\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    const alt = ((m && (m[1] ?? m[2])) || '').trim();
    return alt ? `*${alt}*` : '';
  });
}

/**
 * Unlink every link the reader cannot follow from the pack: a `.md` target, a
 * `#fragment`, a `_files/` download, an absolute path. They become their link
 * text. Web and mailto links keep their href.
 *
 * No `#heading` anchors are generated in their place: a chatbot does not
 * resolve them, and GFM slugs differ per renderer, so an anchor would promise a
 * jump that nothing performs.
 *
 * @param {string} md
 * @returns {string}
 */
function unlinkLocalLinks(md) {
  // The lookbehind keeps an image out of the match, so this is safe to call on
  // markdown stripImages has not seen.
  return replaceOutsideCode(md, /(?<!!)\[([^\]]+)\]\(([^)]+)\)/g, (real) => {
    const m = real.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (!m) return real;
    return /^(https?:\/\/|\/\/|mailto:)/.test(m[2]) ? real : m[1];
  });
}

/**
 * Full per-item pipeline for the plain flavour: strip frontmatter, comments and
 * images, unlink local links, and shift headings for the target level. GFM
 * alerts are left verbatim, being readable markdown already.
 *
 * Order is the point. Comments go first, so a commented-out image never becomes
 * an alt line; images go before links, so an image wrapped in a link does not
 * leave `[*alt*]` behind.
 *
 * @param {string} rawMd - Raw file content (may include frontmatter).
 * @param {object} item - Scanner item. Unused: nothing here resolves against
 *   the item's path any more. Kept for symmetry with preprocessItem.
 * @param {object} ctx
 * @param {number} [ctx.headingShift]
 * @returns {string} Processed markdown body.
 */
function preprocessPlainItem(rawMd, item, ctx) {
  const { content } = parseFrontmatter(rawMd);
  let md = content;
  md = stripHtmlComments(md);
  md = stripImages(md);
  md = unlinkLocalLinks(md);
  md = shiftHeadings(md, (ctx && ctx.headingShift) || 0);
  return md.trim();
}

/**
 * Head the item body with its heading. The heading is always built from the
 * frontmatter title, emoji and all, because a course page carries no H1 of its
 * own: the title is the page heading in every output, Canvas and the preview
 * site included. A body that still opens with a heading therefore prints its
 * title twice, and `npx course validate` reports the page. No anchor is
 * attached, unlike the pandoc flavour's prependTitleHeading.
 *
 * An empty body yields the heading alone, so a scaffolded page with nothing
 * under its frontmatter does not join into a run of blank lines.
 *
 * @param {string} body - Preprocessed markdown body.
 * @param {object} item - Scanner item.
 * @param {number} level - Target heading level for this item.
 * @returns {string}
 */
function prependTitleHeading(body, item, level) {
  const heading = `${'#'.repeat(level)} ${item.title}`;
  const trimmed = body.trim();
  return trimmed ? `${heading}\n\n${trimmed}` : heading;
}

/**
 * Render one item at the given heading level. Pages, assignments and
 * discussions contribute their preprocessed body; the types that carry no body
 * become a heading plus the one line worth saying about them.
 *
 * @param {object} item - Scanner item, optionally carrying `rawMd`.
 * @param {number} level - Target heading level.
 * @param {number} shift - Heading shift for the body (level - 1, plus indent).
 * @param {object} ctx - { courseDir, labels? }; English labels when absent.
 * @returns {string}
 */
function renderPlainItem(item, level, shift, ctx) {
  const hashes = '#'.repeat(level);
  const labels = ctx.labels || getLabels();

  if (REFERENCE_TYPES.has(item.canvasType)) {
    return `${hashes} ${item.title}\n\n*${labels.reference.notice}*`;
  }

  if (item.canvasType === 'external_url') {
    const url = String(
      (item.frontmatter && item.frontmatter.external_url) || '',
    ).trim();
    // Bare, on its own line: a chatbot reads a URL as a URL, and there is no
    // card to put it in.
    return url
      ? `${hashes} ${item.title}\n\n${url}`
      : `${hashes} ${item.title}`;
  }

  if (item.canvasType === 'file') {
    const ref = item.frontmatter && item.frontmatter.file_ref;
    const name = ref ? path.posix.basename(ref.replace(/\\/g, '/')) : item.file;
    // The name alone: the binary is not in the pack, and no path in it would
    // resolve from where the pack is read.
    return `${hashes} ${item.title}\n\n${labels.export.attachment} ${name}`;
  }

  const raw =
    item.rawMd != null
      ? item.rawMd
      : fs.readFileSync(path.join(ctx.courseDir, item.relativePath), 'utf8');
  const body = preprocessPlainItem(raw, item, { ...ctx, headingShift: shift });
  return prependTitleHeading(body, item, level);
}

/**
 * Build the document header: the title as H1, then the subtitle and course name
 * as one italic line, then the date. A single-item export has no title, and
 * gets no header at all, the way the pandoc path gives it no title page.
 *
 * @param {object} meta - { title?, subtitle?, course?, date? }
 * @returns {string} The header, or '' when there is no title.
 */
function buildPlainHeader(meta = {}) {
  if (!meta.title) return '';

  const parts = [`# ${meta.title}`];
  const line = [meta.subtitle, meta.course].filter(Boolean).join(' · ');
  if (line) parts.push(`*${line}*`);
  if (meta.date) parts.push(meta.date);
  return parts.join('\n\n');
}

/**
 * Assemble one plain markdown string for the whole export.
 *
 * Heading regimes are the ones buildCombinedMarkdown uses:
 *  - `course`: module title as H1, items as H2 (body shifted +1).
 *  - `flat`: items as H1 (no shift).
 *  - `bare`: one item as H1, no header.
 *
 * Subheaders (subfolders) become a heading at the item level; their children
 * are nested one level deeper via their `indent`.
 *
 * @param {Array<{moduleTitle: string, moduleFolder?: string, items: object[]}>} groups
 * @param {object} meta - { title?, subtitle?, course?, date?, lang?, regime }
 * @param {object} ctx - { courseDir, labels? }
 * @returns {string}
 */
function buildPlainMarkdown(groups, meta, ctx) {
  const regime = meta.regime || 'flat';
  // A caller that has resolved the course's labels, overrides included, passes
  // them in; otherwise the document language decides.
  const labels = ctx.labels || getLabels(meta.lang);
  const fullCtx = { ...ctx, labels };
  const parts = [];

  const header = buildPlainHeader(meta);
  if (header) parts.push(header);

  if (regime === 'bare') {
    parts.push(renderPlainItem(groups[0].items[0], 1, 0, fullCtx));
    return parts.join('\n\n') + '\n';
  }

  const itemLevel = regime === 'course' ? 2 : 1;
  const baseShift = itemLevel - 1;

  for (const group of groups) {
    if (regime === 'course') parts.push(`# ${group.moduleTitle}`);

    for (const node of flattenItems(group.items)) {
      if (node.type === 'subheader') {
        parts.push(`${'#'.repeat(itemLevel)} ${node.title}`);
        continue;
      }
      const extra = node.indent || 0;
      parts.push(
        renderPlainItem(node, itemLevel + extra, baseShift + extra, fullCtx),
      );
    }
  }

  return parts.join('\n\n') + '\n';
}

module.exports = {
  buildPlainMarkdown,
  preprocessPlainItem,
  buildPlainHeader,
  renderPlainItem,
  prependTitleHeading,
  stripImages,
  stripHtmlComments,
  unlinkLocalLinks,
};
