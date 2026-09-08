const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const log = require('./logger');
const { PROJECT_ROOT } = require('./project-root');
const { COURSE_DIR } = require('./module-utils');
const { parseFrontmatter } = require('../lib/convert/frontmatter');
const { formatMarkdown } = require('../lib/convert/format-markdown');
const { LABEL_SETS } = require('../lib/config/labels');
const { loadCourseConfig } = require('../lib/config/course-config');

// Relative to the project root, not to the shell's working directory: see
// buildGlossary below.
const DEFAULT_GLOSSARY_PATH = 'sources/reference-materials/glossary.yml';

/**
 * Defaults for a given labels object (see lib/config/labels.js). Language
 * strings come from `labels.glossary`; the structural settings are fixed.
 */
function defaultConfigFor(labels) {
  return {
    title: labels.glossary.title,
    page_pattern: 'glossary\\.md$',
    module_pattern: '^(\\d+)',
    intro: labels.glossary.intro,
    kinds: ['concept', 'code', 'operator'],
    code_kinds: ['code', 'operator'],
    headings: {
      operators: labels.glossary.operators,
      terms: labels.glossary.terms,
    },
  };
}

// English baseline. Per-course values come from course.config.yml (language +
// label overrides) and from the glossary file's own `config:` block, which
// sits under the protected sources/ tree and survives upstream updates.
const DEFAULT_CONFIG = defaultConfigFor(LABEL_SETS.en);

/**
 * Load and validate the canonical glossary.
 * @param {string} glossaryPath - Absolute path to the glossary YAML file.
 * @param {object} [defaults] - Base config the file's `config:` block merges
 *   over (default: the English baseline).
 * @returns {{ terms: Array<object>, config: object }} Term entries and the
 *   file's config merged over the defaults.
 */
function loadGlossary(glossaryPath, defaults = DEFAULT_CONFIG) {
  const raw = fs.readFileSync(glossaryPath, 'utf8');
  // js-yaml 5 throws on empty input; keep the friendly error below instead
  const data = raw.trim() ? yaml.load(raw) : null;
  if (!data || !Array.isArray(data.terms)) {
    throw new Error(`${path.basename(glossaryPath)} has no "terms" list`);
  }
  const config = {
    ...defaults,
    ...(data.config || {}),
    headings: { ...defaults.headings, ...(data.config || {}).headings },
  };
  for (const t of data.terms) {
    if (!t.term || typeof t.lesson !== 'number' || !t.kind || !t.definition) {
      throw new Error(
        `glossary entry is missing a required field: ${JSON.stringify(t)}`,
      );
    }
    if (!config.kinds.includes(t.kind)) {
      throw new Error(`Unknown kind "${t.kind}" for term "${t.term}"`);
    }
  }
  return { terms: data.terms, config };
}

/**
 * Render one term as a Markdown list item.
 */
function renderLemma(t, config = DEFAULT_CONFIG) {
  const isCode = config.code_kinds.includes(t.kind);
  let head = isCode ? `**\`${t.term}\`**` : `**${t.term}**`;
  const synonyms = t.synonyms || [];
  if (synonyms.length) head += ` (${synonyms.join(', ')})`;
  let line = `- ${head}: ${t.definition}`;
  if (t.note) line += ` ${t.note}`;
  return line;
}

/**
 * Build the full page body (intro + sections) for a given lesson number.
 * Cumulative: every term with lesson <= the page's lesson.
 */
function renderBody(terms, lesson, config = DEFAULT_CONFIG) {
  const upto = terms.filter((t) => t.lesson <= lesson);

  // Operators sort on the raw symbol; terms sort case-insensitively.
  const operators = upto
    .filter((t) => t.kind === 'operator')
    .sort((a, b) => (a.term < b.term ? -1 : a.term > b.term ? 1 : 0));
  const regular = upto
    .filter((t) => t.kind !== 'operator')
    .sort((a, b) => {
      const x = a.term.toLowerCase();
      const y = b.term.toLowerCase();
      return x < y ? -1 : x > y ? 1 : 0;
    });

  const lines = [config.intro.replaceAll('{lesson}', String(lesson)), ''];
  if (operators.length) {
    lines.push(`## ${config.headings.operators}`, '');
    for (const t of operators) lines.push(renderLemma(t, config));
    lines.push('');
  }
  lines.push(`## ${config.headings.terms}`, '');
  for (const t of regular) lines.push(renderLemma(t, config));

  return lines.join('\n');
}

/**
 * Serialize a page: preserve all existing frontmatter (e.g. sidebar_position),
 * force the canonical title, default canvas_type, then append the generated
 * body.
 *
 * Every string value is double-quoted, with the emoji kept literal (via the
 * js-yaml 5 dump transform below; the v4 forceQuotes option no longer exists).
 *
 * The uniform quoting is this generated page's own style, not a requirement.
 * Docusaurus reads an unquoted emoji title without complaint — the tutorial
 * module's pages are written that way — and `serializeFrontmatter` keeps an
 * emoji literal too, since it dumps through the top-level js-yaml rather than
 * gray-matter's bundled js-yaml 3. What that writer will not do is quote a
 * value YAML does not need quoted, which is the only reason this path is still
 * its own.
 */

/**
 * Dump transform: double-quote every string *value* (not keys), matching the
 * output of js-yaml 4's forceQuotes + quotingType '"'.
 *
 * `node.style` is the numeric `SCALAR_STYLE` enum, and assigning to it is the
 * whole mechanism. js-yaml 5.4 replaced the object it used to be, and the old
 * `node.style.doubleQuoted = true` became a silent no-op — a property set on a
 * number primitive throws nothing and changes nothing — so the titles came out
 * plain and only the tests said so. Read the constant off the module rather
 * than writing `3`.
 */
function quoteStringValues(documents) {
  const walk = (node) => {
    if (!node) return;
    if (node.kind === 'mapping') {
      for (const item of node.items) walk(item.value);
    } else if (node.kind === 'sequence') {
      for (const item of node.items) walk(item);
    } else if (node.kind === 'scalar' && node.tag === 'tag:yaml.org,2002:str') {
      node.style = yaml.SCALAR_STYLE.DOUBLE_QUOTED;
    }
  };
  for (const doc of documents) walk(doc.contents);
}
function serializePage(existingData, body, config = DEFAULT_CONFIG) {
  // title and canvas_type first, then any remaining keys in their original order.
  const ordered = {
    title: config.title,
    canvas_type: existingData.canvas_type || 'page',
  };
  for (const [k, v] of Object.entries(existingData)) {
    if (k !== 'title' && k !== 'canvas_type') ordered[k] = v;
  }
  const frontmatter = yaml
    .dump(ordered, { lineWidth: -1, transform: quoteStringValues })
    .trimEnd();
  return `---\n${frontmatter}\n---\n\n${body}\n`;
}

/**
 * Find the single glossary markdown file in a module folder, if any.
 */
function findGlossaryPage(moduleDir, config) {
  const pageRe = new RegExp(config.page_pattern, 'i');
  const matches = fs.readdirSync(moduleDir).filter((f) => pageRe.test(f));
  if (matches.length === 0) return null;
  if (matches.length > 1) {
    throw new Error(
      `Multiple glossary pages in ${moduleDir}: ${matches.join(', ')}`,
    );
  }
  return matches[0];
}

/**
 * Resolve the lesson number a module's glossary page renders up to:
 * a `lesson:` frontmatter key on the page wins; otherwise the config's
 * module_pattern regex is applied to the folder name (by default the
 * module's numeric prefix, i.e. module number = lesson number).
 */
function resolveLesson(folder, pageData, config) {
  if (typeof pageData.lesson === 'number') return pageData.lesson;
  const match = folder.match(new RegExp(config.module_pattern, 'i'));
  if (!match || match[1] === undefined) return null;
  return parseInt(match[1], 10);
}

/**
 * Regenerate every module's glossary page from the canonical glossary file.
 *
 * @param {object} options
 * @param {string} [options.module] - Limit to a single module folder name.
 * @param {string} [options.glossary] - Path to the glossary YAML file,
 *   resolved from the working directory. Defaults to
 *   `sources/reference-materials/glossary.yml` under the project root.
 * @param {boolean} [options.check] - Do not write; exit non-zero if any page
 *   is out of date. Useful for CI and pre-push checks.
 */
async function buildGlossary(options = {}) {
  // The default is a project path, so it resolves from the project root, the
  // way `course/` above it does: run from `course/03-loops/` this command has
  // to read the same glossary and rewrite the same pages as a run from the
  // root. An explicit --glossary is whatever the author typed at a shell, and
  // resolves from there, like every other path flag in this CLI
  // (`export --toc`, `export --output`).
  const glossaryPath = options.glossary
    ? path.resolve(process.cwd(), options.glossary)
    : path.join(PROJECT_ROOT, DEFAULT_GLOSSARY_PATH);
  if (!fs.existsSync(glossaryPath)) {
    log.error(`[build-glossary] No glossary found at ${glossaryPath}`);
    process.exit(1);
  }
  if (!fs.existsSync(COURSE_DIR)) {
    log.error('[build-glossary] No course/ directory found.');
    process.exit(1);
  }

  let terms;
  let config;
  try {
    const defaults = defaultConfigFor(loadCourseConfig().labels);
    ({ terms, config } = loadGlossary(glossaryPath, defaults));
  } catch (err) {
    log.error(`[build-glossary] ${err.message}`);
    process.exit(1);
  }

  const folders = fs
    .readdirSync(COURSE_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_'))
    .map((d) => d.name)
    .sort();

  if (options.module && !folders.includes(options.module)) {
    log.error(
      `[build-glossary] Module "${options.module}" not found in course/ directory.`,
    );
    process.exit(1);
  }

  let written = 0;
  let unchanged = 0;
  let skipped = 0;
  const stale = [];

  for (const folder of folders) {
    if (options.module && folder !== options.module) continue;

    try {
      const moduleDir = path.join(COURSE_DIR, folder);
      const pageFile = findGlossaryPage(moduleDir, config);
      if (!pageFile) continue; // module has no glossary page

      const filePath = path.join(moduleDir, pageFile);
      const raw = fs.readFileSync(filePath, 'utf8');
      const { data } = parseFrontmatter(raw);

      const lesson = resolveLesson(folder, data, config);
      if (lesson === null) {
        // Not a lesson module (e.g. a reference module). Its page is not a
        // cumulative-to-lesson-N render, so leave it alone and say so.
        log.warn(
          `[build-glossary] Skipped ${folder}/${pageFile}: no lesson number ` +
            `(no "lesson:" frontmatter, folder does not match /${config.module_pattern}/).`,
        );
        skipped += 1;
        continue;
      }

      // Formatted before the comparison rather than on the way out, and that
      // order is the whole point. The page on disk is Prettier-canonical —
      // `npm run format` covers `course/` and CI checks it — so comparing the
      // raw render against it finds a difference on every run: `--check`
      // reports the page stale for ever and a plain run rewrites it, only for
      // the next format to put it back. Formatting first makes "unchanged"
      // mean what it says. Prettier is idempotent, so the write below needs no
      // second pass.
      const output = await formatMarkdown(
        filePath,
        serializePage(data, renderBody(terms, lesson, config), config),
      );

      if (output === raw) {
        unchanged += 1;
        log.verbose(`[build-glossary] unchanged: ${folder}/${pageFile}`);
        continue;
      }

      if (options.check) {
        stale.push(`${folder}/${pageFile}`);
        continue;
      }

      fs.writeFileSync(filePath, output, 'utf8');
      written += 1;
      log.info(
        `[build-glossary] wrote ${folder}/${pageFile} (up to lesson ${lesson})`,
      );
    } catch (err) {
      log.error(`[build-glossary] Failed on ${folder}: ${err.message}`);
      process.exit(1);
    }
  }

  if (options.check) {
    if (stale.length) {
      log.error(
        `[build-glossary] ${stale.length} glossary page(s) out of date:\n  ` +
          stale.join('\n  ') +
          '\nRun: npx course build-glossary',
      );
      process.exit(1);
    }
    log.info('[build-glossary] All glossary pages are up to date.');
    return;
  }

  log.info(
    `[build-glossary] Done: ${written} written, ${unchanged} unchanged` +
      (skipped ? `, ${skipped} skipped` : '') +
      '.',
  );
}

module.exports = buildGlossary;
// `check` reads this to decide whether a course has a glossary to keep fresh.
module.exports.DEFAULT_GLOSSARY_PATH = DEFAULT_GLOSSARY_PATH;
// Exported for unit tests.
module.exports.DEFAULT_CONFIG = DEFAULT_CONFIG;
module.exports.defaultConfigFor = defaultConfigFor;
module.exports.loadGlossary = loadGlossary;
module.exports.renderLemma = renderLemma;
module.exports.renderBody = renderBody;
module.exports.serializePage = serializePage;
module.exports.resolveLesson = resolveLesson;
