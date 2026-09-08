const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const log = require('../../cli/logger');
const {
  DEFAULT_LANGUAGE,
  LABEL_SETS,
  getLabels,
  validateOverrides,
} = require('./labels');

const CONFIG_FILENAME = 'course.config.yml';

/** Keys the file may contain. Anything else warns and is ignored. */
const KNOWN_KEYS = [
  'title',
  'tagline',
  'language',
  'labels',
  'theme',
  'export',
  'checks',
];

/** Built-in defaults for the two "pick a look" keys. The names they resolve to
 *  are validated where they are used — lib/config/theme.js for the theme,
 *  lib/export/style-resolver.js for the export style — so this module stays
 *  free of both. */
const DEFAULT_THEME_NAME = 'github';
const DEFAULT_EXPORT_STYLE = 'generic';

/** Where `check-links` looks when `checks.links.roots` is unset: the course
 *  itself, and nothing else. */
const DEFAULT_CHECK_LINK_ROOTS = Object.freeze(['course']);

/** Cache per resolved root dir: the file is read once per process. */
const cache = new Map();

/**
 * Load course.config.yml and resolve the course title, language, labels, theme,
 * export style and pre-ship checks.
 *
 * A missing (or empty) config file is fine — everything falls back to the
 * built-in `en` set, so neither `npx course` nor the Docusaurus build depends
 * on the file existing. A file that exists but cannot be parsed throws:
 * an authored-but-broken config should fail loudly, not silently anglicise
 * a course. Unknown languages and unknown label keys only warn, through
 * cli/logger so `--quiet` covers them like every other CLI line. The logger
 * requires nothing and defaults to plain console output, so a Docusaurus build
 * that loads this module gets the same warnings it always did.
 *
 * @param {string} [rootDir] - Project root containing course.config.yml.
 *   Defaults to the CLI's PROJECT_ROOT; docusaurus.config.js passes __dirname.
 * @returns {{ title: string, tagline: string, language: string, labels: object,
 *   theme: string, export: { style: string },
 *   checks: { links: { roots: string[] }, extra: string[] } }} Frozen resolved
 *   config. `title` is never empty — Docusaurus requires one — and falls back
 *   to the language's generic course label. `theme` and `export.style` are
 *   names or paths, resolved to files by their consumers. `checks` is what
 *   `check` and `check-links` read: the roots the link check scans, and the
 *   subcommands `check` runs after its built-in list.
 */
function loadCourseConfig(rootDir) {
  const root = path.resolve(
    rootDir || require('../../cli/project-root').PROJECT_ROOT,
  );
  if (cache.has(root)) return cache.get(root);

  const filePath = path.join(root, CONFIG_FILENAME);
  let data = null;
  if (fs.existsSync(filePath)) {
    const raw = fs.readFileSync(filePath, 'utf8');
    if (raw.trim()) {
      try {
        data = yaml.load(raw);
      } catch (err) {
        throw new Error(`Cannot parse ${CONFIG_FILENAME}: ${err.message}`, {
          cause: err,
        });
      }
      if (typeof data !== 'object' || data === null || Array.isArray(data)) {
        throw new Error(
          `${CONFIG_FILENAME} must be a YAML mapping (${KNOWN_KEYS.join(', ')})`,
        );
      }
    }
  }
  data = data || {};

  for (const key of Object.keys(data)) {
    if (!KNOWN_KEYS.includes(key)) {
      log.warn(
        `[course-config] Ignoring unknown key "${key}" in ${CONFIG_FILENAME}`,
      );
    }
  }

  let language = DEFAULT_LANGUAGE;
  if (data.language != null) {
    const requested = String(data.language).trim().toLowerCase();
    if (LABEL_SETS[requested]) {
      language = requested;
    } else {
      log.warn(
        `[course-config] Unknown language "${data.language}" in ${CONFIG_FILENAME}, ` +
          `falling back to "${DEFAULT_LANGUAGE}"`,
      );
    }
  }

  for (const problem of validateOverrides(data.labels)) {
    log.warn(`[course-config] Ignoring ${problem} in ${CONFIG_FILENAME}`);
  }

  const theme = readName(data.theme, DEFAULT_THEME_NAME, 'theme');

  if (
    data.export != null &&
    (typeof data.export !== 'object' || Array.isArray(data.export))
  ) {
    log.warn(
      `[course-config] Ignoring "export" in ${CONFIG_FILENAME}: expected a mapping`,
    );
  }
  const exportSettings =
    data.export && !Array.isArray(data.export) ? data.export : {};
  for (const key of Object.keys(exportSettings)) {
    if (key !== 'style') {
      log.warn(
        `[course-config] Ignoring unknown key "export.${key}" in ${CONFIG_FILENAME}`,
      );
    }
  }

  const checks = readChecks(data.checks);

  // The title falls back to a label, so labels have to be resolved first.
  const labels = getLabels(language, data.labels);
  const config = Object.freeze({
    title: readName(data.title, labels.export.course_title, 'title'),
    tagline: readText(data.tagline, 'tagline'),
    language,
    labels: deepFreeze(labels),
    theme,
    export: Object.freeze({
      style: readName(
        exportSettings.style,
        DEFAULT_EXPORT_STYLE,
        'export.style',
      ),
    }),
    checks: deepFreeze(checks),
  });
  cache.set(root, config);
  return config;
}

/**
 * Read a required scalar — the course title, or a theme or export-style name:
 * a non-empty string, trimmed. Theme and style values may be a built-in name or
 * a path, so they are passed through as authored; only the shape is checked
 * here.
 */
function readName(value, fallback, keyName) {
  if (value == null) return fallback;
  if (typeof value === 'object') {
    log.warn(
      `[course-config] Ignoring "${keyName}" in ${CONFIG_FILENAME}: expected a string`,
    );
    return fallback;
  }
  const name = String(value).trim();
  if (!name) {
    log.warn(
      `[course-config] Ignoring empty "${keyName}" in ${CONFIG_FILENAME}`,
    );
    return fallback;
  }
  return name;
}

/**
 * Read an optional free-text scalar. Unlike readName, an empty value is
 * legitimate rather than a mistake — no tagline is the normal case, and it is
 * also what Docusaurus itself defaults to — so it never warns about emptiness.
 */
function readText(value, keyName) {
  if (value == null) return '';
  if (typeof value === 'object') {
    log.warn(
      `[course-config] Ignoring "${keyName}" in ${CONFIG_FILENAME}: expected a string`,
    );
    return '';
  }
  return String(value).trim();
}

/**
 * Read the `checks:` mapping: the folders `check-links` scans and the extra
 * subcommands `check` runs after its built-in list. A value of the wrong shape
 * warns and falls back, entry by entry where it can, so one typo does not
 * switch every check off.
 */
function readChecks(value) {
  const defaults = { links: { roots: DEFAULT_CHECK_LINK_ROOTS }, extra: [] };
  if (value == null) return defaults;
  if (typeof value !== 'object' || Array.isArray(value)) {
    log.warn(
      `[course-config] Ignoring "checks" in ${CONFIG_FILENAME}: expected a mapping`,
    );
    return defaults;
  }
  for (const key of Object.keys(value)) {
    if (key !== 'links' && key !== 'extra') {
      log.warn(
        `[course-config] Ignoring unknown key "checks.${key}" in ${CONFIG_FILENAME}`,
      );
    }
  }

  let links = value.links;
  if (links != null && (typeof links !== 'object' || Array.isArray(links))) {
    log.warn(
      `[course-config] Ignoring "checks.links" in ${CONFIG_FILENAME}: expected a mapping`,
    );
    links = null;
  }
  links = links || {};
  for (const key of Object.keys(links)) {
    if (key !== 'roots') {
      log.warn(
        `[course-config] Ignoring unknown key "checks.links.${key}" in ${CONFIG_FILENAME}`,
      );
    }
  }

  // No root at all would make check-links a check of nothing, silently green.
  let roots = readList(
    links.roots,
    DEFAULT_CHECK_LINK_ROOTS,
    'checks.links.roots',
  );
  if (roots.length === 0) {
    log.warn(
      `[course-config] Ignoring empty "checks.links.roots" in ${CONFIG_FILENAME}`,
    );
    roots = DEFAULT_CHECK_LINK_ROOTS;
  }

  return { links: { roots }, extra: readList(value.extra, [], 'checks.extra') };
}

/**
 * Read a list of non-empty strings, trimmed. Anything but a list warns and
 * falls back whole; an entry that is not a string, or is blank, is dropped
 * with a warning and the rest is kept.
 */
function readList(value, fallback, keyName) {
  if (value == null) return fallback;
  if (!Array.isArray(value)) {
    log.warn(
      `[course-config] Ignoring "${keyName}" in ${CONFIG_FILENAME}: expected a list`,
    );
    return fallback;
  }
  const items = [];
  for (const entry of value) {
    const text =
      entry == null || typeof entry === 'object' ? '' : String(entry).trim();
    if (!text) {
      log.warn(
        `[course-config] Ignoring an entry of "${keyName}" in ${CONFIG_FILENAME}: expected a string`,
      );
      continue;
    }
    items.push(text);
  }
  return items;
}

function deepFreeze(obj) {
  for (const value of Object.values(obj)) {
    if (value && typeof value === 'object') deepFreeze(value);
  }
  return Object.freeze(obj);
}

/** Test hook: forget cached configs so a test can vary the file contents. */
function _clearCache() {
  cache.clear();
}

module.exports = {
  CONFIG_FILENAME,
  DEFAULT_CHECK_LINK_ROOTS,
  DEFAULT_EXPORT_STYLE,
  DEFAULT_THEME_NAME,
  loadCourseConfig,
  _clearCache,
};
