const fs = require('fs');
const path = require('path');

const log = require('../../cli/logger');
const { loadCourseConfig } = require('./course-config');

/** Built-in themes live here, one CSS file each. */
const THEMES_SUBDIR = path.join('src', 'css', 'themes');

const DEFAULT_THEME = 'github';

/** Every token this project reads is namespaced, so a user's own CSS in the
 *  same file is ignored rather than mistaken for a design token. */
const TOKEN_PREFIX = '--cw-';

/** The six alert kinds, in the order they are documented. Mirrors ICON_FILES
 *  in lib/convert/alert-icons.js and the alert kinds in
 *  export-styles/filter.lua. */
const ALERT_KINDS = ['note', 'tip', 'important', 'warning', 'caution', 'check'];

/** The tokens a theme has to carry beyond the alert pairs. Both draw tables:
 *  `border` is the cell border in a Canvas page (getTableStyles in
 *  lib/convert/markdown-to-html.js), on the site (`--ifm-color-emphasis-300`)
 *  and in the generic PDF template; `surface-subtle` fills the header row on
 *  all three and stripes every second row on the first two. Checked here so a
 *  theme missing one fails on the first load rather than on the first page that
 *  happens to hold a table. */
const REQUIRED_TOKENS = ['border', 'surface-subtle'];

/** Cache per resolved root dir: theme files are read once per process. */
const cache = new Map();

/**
 * Turn a `theme:` value into a file path.
 *
 * A bare name (`github`) selects a built-in under src/css/themes/. Anything
 * containing a separator or ending in `.css` is treated as a path relative to
 * the project root, which is how you point at your own theme in sources/.
 */
function resolveThemeFile(name, root) {
  if (name.includes('/') || name.includes(path.sep) || name.endsWith('.css')) {
    return path.resolve(root, name);
  }
  return path.join(root, THEMES_SUBDIR, `${name}.css`);
}

/**
 * Extract `--cw-*` custom properties from a CSS file.
 *
 * Comments are stripped first so a commented-out declaration does not count.
 * `var(--cw-x)` references never match: a reference has no colon after the
 * name. Values may span lines (font stacks do), so whitespace is collapsed.
 *
 * @param {string} css
 * @returns {object} Token name without the prefix -> value.
 */
function parseTokens(css) {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const tokens = {};
  const declaration = new RegExp(
    `${TOKEN_PREFIX}([a-z0-9-]+)\\s*:\\s*([^;]+);`,
    'gi',
  );
  let match;
  while ((match = declaration.exec(withoutComments)) !== null) {
    tokens[match[1].toLowerCase()] = match[2].trim().replace(/\s+/g, ' ');
  }
  return tokens;
}

/**
 * Load the theme selected in course.config.yml.
 *
 * An unknown or unreadable theme warns and falls back to the built-in default,
 * mirroring how an unknown `language` is handled. A missing default theme file
 * throws: that is a broken checkout, not a configuration mistake, and silently
 * inventing colours here would defeat the point of a single source of truth.
 *
 * @param {string} [rootDir] - Project root. Defaults to the CLI's PROJECT_ROOT;
 *   docusaurus.config.js passes __dirname.
 * @returns {{ name: string, file: string, tokens: object, colors: object,
 *   alerts: object }} Frozen resolved theme. `colors` holds only the plain-hex
 *   tokens (what can be injected into Typst); `alerts` maps each kind to
 *   `{ fg, bg }`.
 */
function loadTheme(rootDir) {
  const root = path.resolve(
    rootDir || require('../../cli/project-root').PROJECT_ROOT,
  );
  if (cache.has(root)) return cache.get(root);

  const requested = String(
    loadCourseConfig(root).theme || DEFAULT_THEME,
  ).trim();
  let name = requested;
  let file = resolveThemeFile(name, root);

  if (!fs.existsSync(file)) {
    log.warn(
      `[theme] Unknown theme "${requested}", falling back to "${DEFAULT_THEME}"`,
    );
    name = DEFAULT_THEME;
    file = resolveThemeFile(DEFAULT_THEME, root);
    if (!fs.existsSync(file)) {
      throw new Error(`Missing the built-in theme at ${file}`);
    }
  }

  const tokens = parseTokens(fs.readFileSync(file, 'utf8'));

  const colors = {};
  for (const [key, value] of Object.entries(tokens)) {
    if (/^#[0-9a-f]{3,8}$/i.test(value)) colors[key] = value;
  }

  const alerts = {};
  for (const kind of ALERT_KINDS) {
    const fg = tokens[`alert-${kind}-fg`];
    const bg = tokens[`alert-${kind}-bg`];
    if (!fg || !bg) {
      throw new Error(
        `Theme ${path.relative(root, file)} is missing ` +
          `${TOKEN_PREFIX}alert-${kind}-fg or ${TOKEN_PREFIX}alert-${kind}-bg`,
      );
    }
    alerts[kind] = Object.freeze({ fg, bg });
  }

  for (const token of REQUIRED_TOKENS) {
    if (!tokens[token]) {
      throw new Error(
        `Theme ${path.relative(root, file)} is missing ${TOKEN_PREFIX}${token}`,
      );
    }
  }

  const theme = Object.freeze({
    name,
    file,
    tokens: Object.freeze(tokens),
    colors: Object.freeze(colors),
    alerts: Object.freeze(alerts),
  });
  cache.set(root, theme);
  return theme;
}

/**
 * The theme's hex colours as pandoc variables, e.g. `cw-alert-note-fg`.
 * Non-hex tokens (font stacks, sizes) are left out: Typst gets its typography
 * from the export style, not from the theme.
 *
 * @param {object} theme - A resolved theme from loadTheme().
 * @returns {object} Pandoc variable name -> value.
 */
function themeVariables(theme) {
  const variables = {};
  for (const [key, value] of Object.entries(theme.colors)) {
    variables[`cw-${key}`] = value;
  }
  return variables;
}

/** A short stable digest of the theme's colours, used to detect a theme change
 *  without storing the whole palette (see lib/canvas/icons.js). */
function themeFingerprint(theme) {
  const canonical = Object.entries(theme.colors)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}:${value}`)
    .join(';');
  return require('crypto')
    .createHash('sha1')
    .update(canonical)
    .digest('hex')
    .slice(0, 12);
}

/** Test hook: forget cached themes so a test can vary the file contents. */
function _clearCache() {
  cache.clear();
}

module.exports = {
  ALERT_KINDS,
  DEFAULT_THEME,
  THEMES_SUBDIR,
  loadTheme,
  parseTokens,
  resolveThemeFile,
  themeVariables,
  themeFingerprint,
  _clearCache,
};
