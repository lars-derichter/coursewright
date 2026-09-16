const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { buildPandocArgs, typstFontPaths } = require('../../lib/export/pandoc');

const WORD_FONTS = '/Applications/Microsoft Word.app/Contents/Resources/DFonts';

describe('buildPandocArgs', () => {
  const base = {
    input: 'in.md',
    output: 'out.pdf',
    format: 'pdf',
    filter: 'f.lua',
  };

  it('renders PDF through the Typst engine', () => {
    const args = buildPandocArgs({ ...base, template: 't.typ' });
    assert.ok(args.includes('--pdf-engine'));
    assert.strictEqual(args[args.indexOf('--pdf-engine') + 1], 'typst');
    assert.strictEqual(args[args.indexOf('--template') + 1], 't.typ');
  });

  it('widens the Typst root only when a cover logo is used', () => {
    const without = buildPandocArgs({ ...base });
    assert.ok(!without.includes('--pdf-engine-opt=--root=/'));

    const withLogo = buildPandocArgs({ ...base, logo: '/abs/logo.png' });
    assert.ok(withLogo.includes('--pdf-engine-opt=--root=/'));
    assert.ok(withLogo.includes('logo=/abs/logo.png'));
  });

  it('styles DOCX from the reference document instead', () => {
    const args = buildPandocArgs({
      ...base,
      format: 'docx',
      output: 'out.docx',
      referenceDoc: 'r.docx',
      template: 't.typ',
    });
    assert.strictEqual(args[args.indexOf('--reference-doc') + 1], 'r.docx');
    assert.ok(!args.includes('--pdf-engine'));
    assert.ok(!args.includes('--template'));
  });

  it('numbers sections only when asked, after the defaults file', () => {
    const without = buildPandocArgs({ ...base, defaultsFile: 'd.yml' });
    assert.ok(!without.includes('--number-sections'));

    const args = buildPandocArgs({
      ...base,
      defaultsFile: 'd.yml',
      numberSections: true,
    });
    assert.ok(args.includes('--number-sections'));
    // Later than --defaults, or its `number-sections: false` would win.
    assert.ok(args.indexOf('--number-sections') > args.indexOf('--defaults'));
  });

  it('passes each variable as its own -V pair', () => {
    const args = buildPandocArgs({
      ...base,
      variables: { fontsize: '12pt', margin: '2cm' },
    });
    assert.ok(args.includes('fontsize=12pt'));
    assert.ok(args.includes('margin=2cm'));
  });
});

describe('typstFontPaths', () => {
  const none = () => false;
  const all = () => true;

  it('returns nothing when the style ships no fonts and Office is absent', () => {
    const dirs = typstFontPaths(null, {
      platform: 'darwin',
      exists: none,
      existing: '',
    });
    assert.deepStrictEqual(dirs, []);
  });

  it('returns the style fonts directory on its own', () => {
    const dirs = typstFontPaths('/style/fonts', {
      platform: 'linux',
      exists: none,
      existing: '',
    });
    assert.deepStrictEqual(dirs, ['/style/fonts']);
  });

  it('adds the Office bundles on macOS, style directory first', () => {
    const dirs = typstFontPaths('/style/fonts', {
      platform: 'darwin',
      exists: (p) => p === WORD_FONTS,
      existing: '',
    });
    assert.deepStrictEqual(dirs, ['/style/fonts', WORD_FONTS]);
  });

  it('finds the Office bundles even when the style ships no fonts', () => {
    const dirs = typstFontPaths(null, {
      platform: 'darwin',
      exists: (p) => p === WORD_FONTS,
      existing: '',
    });
    assert.deepStrictEqual(dirs, [WORD_FONTS]);
  });

  // Windows Office installs into C:\Windows\Fonts, which Typst already scans.
  it('adds nothing of its own off macOS', () => {
    for (const platform of ['win32', 'linux']) {
      const dirs = typstFontPaths('/style/fonts', {
        platform,
        exists: all,
        existing: '',
      });
      assert.deepStrictEqual(dirs, ['/style/fonts'], platform);
    }
  });

  it("keeps the user's own TYPST_FONT_PATHS, last", () => {
    const existing = ['/mine/a', '/mine/b'].join(path.delimiter);
    const dirs = typstFontPaths('/style/fonts', {
      platform: 'linux',
      exists: none,
      existing,
    });
    assert.deepStrictEqual(dirs, ['/style/fonts', '/mine/a', '/mine/b']);
  });

  it('ignores empty entries in TYPST_FONT_PATHS', () => {
    const existing = ['', '/mine/a', ''].join(path.delimiter);
    const dirs = typstFontPaths(null, {
      platform: 'linux',
      exists: none,
      existing,
    });
    assert.deepStrictEqual(dirs, ['/mine/a']);
  });
});
