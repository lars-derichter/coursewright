const { describe, it, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const log = require('../../cli/logger');
const {
  ALERT_KINDS,
  DEFAULT_THEME,
  THEMES_SUBDIR,
  loadTheme,
  parseTokens,
  resolveThemeFile,
  themeVariables,
  themeFingerprint,
  _clearCache,
} = require('../../lib/config/theme');
const {
  CONFIG_FILENAME,
  _clearCache: clearConfigCache,
} = require('../../lib/config/course-config');

const MINIMAL_THEME = `
:root {
  --cw-fg: #111111;
  --cw-border: #cccccc;
  --cw-surface-subtle: #eeeeee;
  --cw-font-sans: Helvetica,
    Arial, sans-serif;
${ALERT_KINDS.map((kind) => `  --cw-alert-${kind}-fg: #aa00${kind.length}0;\n  --cw-alert-${kind}-bg: #bb00${kind.length}0;`).join('\n')}
}
`;

describe('parseTokens', () => {
  it('reads --cw-* declarations and collapses multi-line values', () => {
    const tokens = parseTokens(MINIMAL_THEME);
    assert.strictEqual(tokens.fg, '#111111');
    assert.strictEqual(tokens['font-sans'], 'Helvetica, Arial, sans-serif');
  });

  it('ignores commented-out declarations and var() references', () => {
    const tokens = parseTokens(`
      :root {
        /* --cw-ghost: #000000; */
        --cw-real: #ffffff;
        --ifm-link-color: var(--cw-real);
      }
    `);
    assert.deepStrictEqual(Object.keys(tokens), ['real']);
  });
});

describe('resolveThemeFile', () => {
  // A root the host itself calls absolute. `/project` is not one on Windows —
  // it names no drive — so `path.resolve` completes it with the drive the test
  // happens to run from, and the path branch below would never match an
  // expectation built by hand. A real project root always names a drive.
  const root = path.resolve('/project');

  it('treats a bare name as a built-in', () => {
    assert.strictEqual(
      resolveThemeFile('github', root),
      path.join(root, THEMES_SUBDIR, 'github.css'),
    );
  });

  it('treats a path as relative to the project root', () => {
    assert.strictEqual(
      resolveThemeFile('sources/mine.css', root),
      path.join(root, 'sources', 'mine.css'),
    );
  });
});

describe('loadTheme', () => {
  let tmpDir;
  let warnMock;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'theme-test-'));
    fs.mkdirSync(path.join(tmpDir, THEMES_SUBDIR), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, THEMES_SUBDIR, `${DEFAULT_THEME}.css`),
      MINIMAL_THEME,
    );
    // The logger, not console: what this pins is that the warning goes through
    // the sink `--quiet` and `--verbose` control. A console mock would pass
    // either way.
    warnMock = mock.method(log, 'warn', () => {});
    _clearCache();
    clearConfigCache();
  });

  afterEach(() => {
    warnMock.mock.restore();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    _clearCache();
    clearConfigCache();
  });

  function writeConfig(content) {
    fs.writeFileSync(path.join(tmpDir, CONFIG_FILENAME), content);
  }

  it('falls back to the built-in default with no config file', () => {
    const theme = loadTheme(tmpDir);
    assert.strictEqual(theme.name, DEFAULT_THEME);
    assert.strictEqual(theme.tokens.fg, '#111111');
  });

  it('exposes fg/bg for every alert kind', () => {
    const { alerts } = loadTheme(tmpDir);
    for (const kind of ALERT_KINDS) {
      assert.ok(alerts[kind].fg, `missing fg for ${kind}`);
      assert.ok(alerts[kind].bg, `missing bg for ${kind}`);
    }
  });

  it('keeps only plain hex values in colors', () => {
    const { colors } = loadTheme(tmpDir);
    assert.strictEqual(colors.fg, '#111111');
    assert.ok(!('font-sans' in colors), 'font stacks are not colours');
  });

  it('loads a theme given as a path', () => {
    fs.mkdirSync(path.join(tmpDir, 'sources'));
    fs.writeFileSync(
      path.join(tmpDir, 'sources', 'mine.css'),
      MINIMAL_THEME.replace('#111111', '#222222'),
    );
    writeConfig('theme: sources/mine.css\n');
    const theme = loadTheme(tmpDir);
    assert.strictEqual(theme.tokens.fg, '#222222');
  });

  it('warns and falls back when the theme does not exist', () => {
    writeConfig('theme: nope\n');
    const theme = loadTheme(tmpDir);
    assert.strictEqual(theme.name, DEFAULT_THEME);
    assert.strictEqual(warnMock.mock.callCount(), 1);
  });

  it('throws when a theme is missing an alert colour', () => {
    fs.writeFileSync(
      path.join(tmpDir, THEMES_SUBDIR, `${DEFAULT_THEME}.css`),
      ':root { --cw-fg: #111111; }',
    );
    assert.throws(() => loadTheme(tmpDir), /alert-note-fg/);
  });

  it('throws when a theme is missing a table colour', () => {
    // Same treatment as the alert pairs, for the same reason: the Canvas table
    // renderer has no fallback colour, and failing here names the theme rather
    // than the first page that happens to hold a table.
    fs.writeFileSync(
      path.join(tmpDir, THEMES_SUBDIR, `${DEFAULT_THEME}.css`),
      MINIMAL_THEME.replace('--cw-border: #cccccc;', ''),
    );
    assert.throws(() => loadTheme(tmpDir), /--cw-border/);
  });
});

describe('themeVariables and themeFingerprint', () => {
  const theme = {
    colors: { fg: '#111111', 'alert-note-fg': '#0969da' },
  };

  it('prefixes pandoc variable names', () => {
    assert.deepStrictEqual(themeVariables(theme), {
      'cw-fg': '#111111',
      'cw-alert-note-fg': '#0969da',
    });
  });

  it('is stable under key order and changes with a colour', () => {
    const reordered = { colors: { 'alert-note-fg': '#0969da', fg: '#111111' } };
    assert.strictEqual(themeFingerprint(theme), themeFingerprint(reordered));
    assert.notStrictEqual(
      themeFingerprint(theme),
      themeFingerprint({ colors: { ...theme.colors, fg: '#000000' } }),
    );
  });
});
