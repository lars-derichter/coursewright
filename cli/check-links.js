const fs = require('fs');
const path = require('path');

const log = require('./logger');
const { PROJECT_ROOT } = require('./project-root');
const { loadCourseConfig } = require('../lib/config/course-config');

// The plain filesystem check beside `validate`. Validate knows the course tree
// and resolves a link against the items it scanned, so it never sees
// `course/index.md`, `course/LICENSE.md`, a folder nested deeper than a module
// takes, or markdown kept outside course/ altogether. This command reads every
// .md file under each root and asks one question of each relative link and
// image: does the target exist on disk. The roots are `checks.links.roots` in
// course.config.yml, `course` alone by default, or a repeated --root flag.

/**
 * Blank out inline `code` spans on one line, keeping the line's length so the
 * link positions that follow still hold. Fences span lines, so extractLinks
 * tracks those itself and only hands this the lines outside them.
 */
function stripInlineCode(line) {
  return line.replace(/`[^`]*`/g, (m) => ' '.repeat(m.length));
}

/**
 * Clean a raw link target: drop an optional `"title"`/`'title'`, strip angle
 * brackets, and trim. Returns the bare URL/path (fragment still attached).
 */
function cleanTarget(raw) {
  let t = raw.trim();
  if (t.startsWith('<') && t.endsWith('>')) t = t.slice(1, -1).trim();
  // A title is separated from the URL by whitespace: `url "title"`.
  const ws = t.search(/\s/);
  if (ws !== -1) t = t.slice(0, ws);
  return t.trim();
}

/**
 * Extract every markdown link and image target from a document, with 1-based
 * line numbers. Fenced code blocks and inline code are ignored so code samples
 * never register as links.
 *
 * @param {string} content - Raw markdown.
 * @returns {Array<{ target: string, line: number }>}
 */
function extractLinks(content) {
  const links = [];
  const lines = content.split(/\r?\n/);
  let inFence = false;
  let fenceMarker = '';

  const linkRe = /!?\[[^\]]*\]\(([^)]*)\)/g;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const fenceMatch = line.match(/^\s*(```+|~~~+)/);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (!inFence) {
        inFence = true;
        fenceMarker = marker;
      } else if (marker === fenceMarker) {
        inFence = false;
        fenceMarker = '';
      }
      continue;
    }
    if (inFence) continue;

    const cleaned = stripInlineCode(line);
    let m;
    linkRe.lastIndex = 0;
    while ((m = linkRe.exec(cleaned)) !== null) {
      const target = cleanTarget(m[1]);
      if (target) links.push({ target, line: i + 1 });
    }
  }

  return links;
}

/**
 * Classify a link target so the checker only resolves ones that point at a
 * local file it can verify.
 *
 * @returns {'external'|'anchor'|'absolute'|'mail'|'relative'}
 */
function classify(target) {
  if (/^#/.test(target)) return 'anchor';
  if (/^(https?:)?\/\//i.test(target)) return 'external';
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return 'mail'; // mailto:, tel:, etc.
  if (target.startsWith('/') || target.startsWith('@site/')) return 'absolute';
  return 'relative';
}

/**
 * Split a target into its path and fragment (`file.md#anchor` -> both parts).
 */
function splitFragment(target) {
  const hash = target.indexOf('#');
  if (hash === -1) return { filePath: target, fragment: '' };
  return { filePath: target.slice(0, hash), fragment: target.slice(hash + 1) };
}

/**
 * Recursively collect every `.md` file under a directory.
 */
function findMarkdownFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      out.push(...findMarkdownFiles(full));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Check every relative markdown/image link under the given roots and return the
 * broken ones. Pure over the filesystem: no writes, no process.exit.
 *
 * @param {object} [options]
 * @param {string} [options.root] - Project root (default: PROJECT_ROOT).
 * @param {string[]} [options.roots] - Root folders to scan, relative to the
 *   project root (default: `checks.links.roots` from course.config.yml).
 * @returns {{ broken: Array<{file:string,line:number,target:string,reason:string}>,
 *            filesChecked: number, linksChecked: number }}
 */
function checkLinks(options = {}) {
  const root = options.root || PROJECT_ROOT;
  const roots = options.roots || loadCourseConfig(root).checks.links.roots;

  const broken = [];
  let filesChecked = 0;
  let linksChecked = 0;

  for (const rel of roots) {
    const dir = path.resolve(root, rel);
    if (!fs.existsSync(dir)) continue;

    for (const file of findMarkdownFiles(dir)) {
      filesChecked += 1;
      const content = fs.readFileSync(file, 'utf8');
      for (const { target, line } of extractLinks(content)) {
        if (classify(target) !== 'relative') continue;
        linksChecked += 1;

        const { filePath } = splitFragment(target);
        // A pure fragment (`#anchor`) has no path to resolve.
        if (!filePath) continue;

        const resolved = path.resolve(
          path.dirname(file),
          decodeURIComponent(filePath),
        );
        if (!fs.existsSync(resolved)) {
          broken.push({
            file: path.relative(root, file),
            line,
            target,
            reason: `no such file: ${path.relative(root, resolved)}`,
          });
        }
      }
    }
  }

  return { broken, filesChecked, linksChecked };
}

/** Commander collector for the repeatable `--root` flag. */
function collectRoot(value, previous) {
  return (previous || []).concat(value);
}

/**
 * CLI action: report broken relative links and exit non-zero if any are found.
 *
 * @param {object} [options]
 * @param {string[]} [options.root] - Folders to scan instead of the configured
 *   roots; empty means "use the configuration".
 */
async function checkLinksCommand(options = {}) {
  const roots = options.root && options.root.length ? options.root : undefined;
  const { broken, filesChecked, linksChecked } = checkLinks({ roots });

  if (broken.length) {
    log.error(
      `[check-links] ${broken.length} broken link(s) in ${filesChecked} file(s):`,
    );
    for (const b of broken) {
      log.error(`  ${b.file}:${b.line}  ${b.target}  (${b.reason})`);
    }
    process.exit(1);
  }

  log.info(
    `[check-links] OK: ${linksChecked} relative link(s) in ${filesChecked} file(s), none broken.`,
  );
}

module.exports = checkLinksCommand;
module.exports.collectRoot = collectRoot;
// Exported for unit tests.
module.exports.extractLinks = extractLinks;
module.exports.classify = classify;
module.exports.splitFragment = splitFragment;
module.exports.cleanTarget = cleanTarget;
module.exports.stripInlineCode = stripInlineCode;
module.exports.checkLinks = checkLinks;
