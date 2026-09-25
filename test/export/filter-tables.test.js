const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const path = require('path');

// Runs the shipped filter through pandoc itself. CI installs no pandoc, so the
// suite skips there and runs wherever exports can run at all.
const FILTER = path.join(__dirname, '..', '..', 'export-styles', 'filter.lua');

function hasPandoc() {
  try {
    execFileSync('pandoc', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function toTypst(md) {
  return execFileSync(
    'pandoc',
    ['-f', 'markdown', '-t', 'typst', '--lua-filter', FILTER],
    { input: md, encoding: 'utf8' },
  );
}

describe(
  'filter.lua tables',
  { skip: !hasPandoc() && 'pandoc not installed' },
  () => {
    // Wider than 72 characters, so pandoc reads relative widths off the dashes.
    const wide = [
      '| Kaart                                                   | Les | Wanneer                 |',
      '| ------------------------------------------------------- | --- | ----------------------- |',
      '| [String](../03-les1-de-slaapkamer/04-syntaxkaart-string.md) | 1   | Je werkt met tekst. |',
      '',
    ].join('\n');

    it('sizes columns to their content instead of the separator dashes', () => {
      const out = toTypst(wide);
      assert.match(out, /columns: 3,/);
      assert.doesNotMatch(out, /columns: \(/);
    });

    it('left-aligns a column the markdown leaves unaligned', () => {
      assert.match(toTypst(wide), /align: \(left,left,left,\)/);
    });

    it('keeps an alignment the markdown sets explicitly', () => {
      const md = '| a | b | c |\n|:-:|--:|---|\n| 1 | 2 | 3 |\n';
      assert.match(toTypst(md), /align: \(center,right,left,\)/);
    });
  },
);
