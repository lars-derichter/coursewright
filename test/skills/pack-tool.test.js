const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCRIPT = path.join(
  __dirname,
  '..',
  '..',
  '.agents',
  'skills',
  'study-pack-build',
  'scripts',
  'pack-tool.js',
);
const tool = require(SCRIPT);

const RAW = `# Pack title

*Subtitle · Course*

2026-09-18

# Lesson 1: Arrays

## Overview

Today we open IntelliJ and look at arrays together. Bring your laptop.

## 📐 Card: array

An array has a fixed \`length\`, no brackets.

\`\`\`java
int[] a = new int[5];
\`\`\`

## Practice

Call \`foo()\` twice and read the output.

\`\`\`java
foo();
foo();
\`\`\`

# Lesson 2: Lists

## 📐 Card: ArrayList

A list grows.

\`\`\`java
List<String> l = new ArrayList<>();
\`\`\`

## Homework

Write \`bar()\` so it returns the count.
`;

const COMPACT = `# Pack title

*Subtitle · Course*

2026-09-18

# Lesson 1: Arrays

## Overview

Arrays.

## 📐 Card: array

An array has a fixed \`length\`, no brackets.

\`\`\`java
int[] a = new int[5];
\`\`\`

## Practice

Call \`foo()\` twice.

\`\`\`java
foo();
foo();
\`\`\`

# Lesson 2: Lists

## 📐 Card: ArrayList

A list grows.

\`\`\`java
List<String> l = new ArrayList<>();
\`\`\`

## Homework

Write \`bar()\` so it returns the count.
`;

let dir;

function write(name, text) {
  const file = path.join(dir, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
}

/** A recipe whose raw sits at raw/<name>.md next to it and whose compact is
 *  the given file. Absolute paths resolve as given. */
function recipe(name, compactFile, verbatim = '["📐", "📘 Glossary"]') {
  const file = write(
    `${name}.toc.md`,
    [
      '---',
      'title: "Pack title"',
      'subtitle: "Subtitle"',
      `compact: ${compactFile}`,
      `verbatim: ${verbatim}`,
      '---',
      '',
      '- 01-x/01-y.md  # Overview',
      '',
    ].join('\n'),
  );
  return tool.readRecipe(file);
}

function failures(result) {
  return result.lines
    .filter((l) => l.tag !== 'section' && l.tag !== 'term')
    .map((l) => `${l.tag} ${l.status} ${l.msg}`);
}

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-tool-'));
});

after(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('readRecipe', () => {
  it('reads the compact path, the prefixes and derives the raw path', () => {
    const r = recipe('demo', path.join(dir, 'demo-compact.md'));
    assert.equal(r.name, 'demo');
    assert.equal(r.compact, path.join(dir, 'demo-compact.md'));
    assert.equal(r.raw, path.join(dir, 'raw', 'demo.md'));
    assert.deepEqual(r.verbatim, ['📐', '📘 Glossary']);
  });

  it('refuses a recipe without a compact path', () => {
    const file = write('bare.toc.md', '---\ntitle: "x"\n---\n');
    assert.throws(() => tool.readRecipe(file), /compact:/);
  });
});

describe('splitSections', () => {
  it('ignores a heading inside a fence', () => {
    const lines = ['# A', '```', '# not a heading', '```', '# B'];
    const titles = tool.splitSections(lines, 1).map((s) => s.title);
    assert.deepEqual(titles, [null, 'A', 'B']);
  });

  it('takes the first H1 as the header', () => {
    const pack = tool.parsePack(RAW.split('\n'));
    assert.equal(pack.header.title, 'Pack title');
    assert.deepEqual(
      pack.sections.map((s) => s.title),
      ['Lesson 1: Arrays', 'Lesson 2: Lists'],
    );
  });
});

describe('check', () => {
  it('passes an identical compact at ratio 1', () => {
    write('raw/same.md', RAW);
    const r = tool.check(recipe('same', write('same-compact.md', RAW)));
    assert.equal(r.failures, 0);
    assert.equal(r.compactBytes, r.rawBytes);
  });

  it('passes a condensed compact and reports the sizes', () => {
    write('raw/ok.md', RAW);
    const r = tool.check(recipe('ok', write('ok-compact.md', COMPACT)));
    assert.deepEqual(failures(r), []);
    assert.ok(r.compactBytes < r.rawBytes);
    assert.ok(r.lines.some((l) => l.tag === 'section' && l.status === 'ratio'));
  });

  it('names a missing H2 and the code block that went with it', () => {
    write('raw/h2.md', RAW);
    const compact = COMPACT.replace(/## Practice[\s\S]*?(?=# Lesson 2)/, '');
    const r = tool.check(recipe('h2', write('h2-compact.md', compact)));
    assert.deepEqual(failures(r), [
      'heading missing H2 "Practice" in "Lesson 1: Arrays"',
      'code missing in "Lesson 1: Arrays": foo();',
    ]);
  });

  it('names an extra code block', () => {
    write('raw/extra.md', RAW);
    const compact = COMPACT.replace(
      '## Homework',
      '## Homework\n\n```java\nbaz();\n```\n',
    );
    const r = tool.check(recipe('extra', write('extra-compact.md', compact)));
    assert.deepEqual(failures(r), ['code extra in "Lesson 2: Lists": baz();']);
  });

  it('refuses a verbatim section that changed', () => {
    write('raw/verb.md', RAW);
    const compact = COMPACT.replace('A list grows.', 'A list can grow.');
    const r = tool.check(recipe('verb', write('verb-compact.md', compact)));
    assert.equal(r.failures, 1);
    assert.match(failures(r)[0], /^verbatim differs "📐 Card: ArrayList"/);
  });

  it('refuses a changed header, unless one section is checked', () => {
    write('raw/head.md', RAW);
    const compact = COMPACT.replace('*Subtitle · Course*', '*Other*');
    const rec = recipe('head', write('head-compact.md', compact));
    assert.match(failures(tool.check(rec))[0], /^header differs/);
    const one = tool.check(rec, { section: 'Lesson 2: Lists' });
    assert.equal(one.failures, 0);
    assert.ok(!one.lines.some((l) => l.msg.includes('Lesson 1')));
  });

  it('reports leftovers with their line', () => {
    write('raw/left.md', RAW);
    const compact = COMPACT + ':::\n\nSee [the card](../01-x/card.md).\n';
    const r = tool.check(recipe('left', write('left-compact.md', compact)));
    const lines = COMPACT.split('\n').length;
    assert.deepEqual(failures(r), [
      `leftover line ${lines} fenced div ":::"`,
      `leftover line ${lines + 2} local link ](../01-x/card.md)`,
    ]);
  });

  it('reports the extra H1 and the order', () => {
    write('raw/order.md', RAW);
    const [head, one, two] = COMPACT.split(/^(?=# Lesson)/m);
    const compact = head + two + one + '# Lesson 3: Maps\n\nNew.\n';
    const r = tool.check(recipe('order', write('order-compact.md', compact)));
    assert.deepEqual(failures(r), [
      'heading extra H1 "Lesson 3: Maps"',
      'heading order H1 sequence differs from the raw',
    ]);
  });

  it('warns about a dropped term without failing', () => {
    write('raw/term.md', RAW);
    const compact = COMPACT.replace('Write `bar()` so', 'Write it so');
    const r = tool.check(recipe('term', write('term-compact.md', compact)));
    assert.equal(r.failures, 0);
    assert.equal(r.warnings, 1);
    assert.ok(
      r.lines.some((l) => l.tag === 'term' && l.msg.includes('`bar()`')),
    );
  });
});

describe('changed', () => {
  it('reports nothing for an identical raw and a date-only header', () => {
    write('raw/diff.md', RAW);
    const rec = recipe('diff', path.join(dir, 'diff-compact.md'));
    const same = tool.changed(rec, write('old-same.md', RAW));
    assert.equal(same.changed, 0);
    assert.equal(same.header, 'unchanged');
    const dated = tool.changed(
      rec,
      write('old-dated.md', RAW.replace('2026-09-18', '2026-09-01')),
    );
    assert.equal(dated.changed, 0);
    assert.equal(dated.header, 'date only');
  });

  it('lists changed, added and removed sections', () => {
    const fresh = RAW.replace('Bring your laptop.', 'Bring a laptop.').replace(
      /# Lesson 2[\s\S]*$/,
      '# Lesson 3: Maps\n\nNew.\n',
    );
    write('raw/lists.md', fresh);
    const rec = recipe('lists', path.join(dir, 'lists-compact.md'));
    const r = tool.changed(rec, write('old-lists.md', RAW));
    assert.deepEqual(
      r.entries.map((e) => `${e.status} ${e.title}`),
      [
        'changed Lesson 1: Arrays',
        'added Lesson 3: Maps',
        'removed Lesson 2: Lists',
      ],
    );
    assert.equal(r.changed, 3);
    assert.equal(r.total, 2);
  });

  it('treats a missing old raw as all added', () => {
    write('raw/new.md', RAW);
    const rec = recipe('new', path.join(dir, 'new-compact.md'));
    const r = tool.changed(rec, path.join(dir, 'never-written.md'));
    assert.deepEqual(
      r.entries.map((e) => e.status),
      ['added', 'added'],
    );
    assert.equal(r.header, 'new');
  });
});

describe('section and splice', () => {
  it('prints one H1 section', () => {
    const file = write('sec.md', RAW);
    const text = tool.section(file, 'Lesson 2: Lists');
    assert.ok(text.startsWith('# Lesson 2: Lists\n'));
    assert.ok(text.includes('## Homework'));
    assert.ok(!text.includes('Lesson 1'));
    assert.throws(() => tool.section(file, 'Lesson 9'), /Sections:/);
  });

  it('replaces a section in place and refreshes the header', () => {
    write('raw/sp.md', RAW.replace('2026-09-18', '2026-10-01'));
    const rec = recipe('sp', write('sp-compact.md', COMPACT));
    const piece = write(
      'piece.md',
      '# Lesson 1: Arrays\n\n## Overview\n\nShort.\n',
    );
    const r = tool.splice(rec, piece);
    assert.deepEqual(r, { action: 'replaced', title: 'Lesson 1: Arrays' });
    const out = fs.readFileSync(rec.compact, 'utf8');
    assert.ok(out.includes('2026-10-01'));
    assert.ok(
      out.includes(
        '\n# Lesson 1: Arrays\n\n## Overview\n\nShort.\n\n# Lesson 2: Lists\n',
      ),
    );
    assert.ok(!out.includes('Card: array'));
  });

  it('inserts a missing section at the raw position', () => {
    write('raw/ins.md', RAW);
    const [head, , two] = COMPACT.split(/^(?=# Lesson)/m);
    const rec = recipe('ins', write('ins-compact.md', head + two));
    tool.splice(rec, write('piece1.md', '# Lesson 1: Arrays\n\nBack.\n'));
    const out = fs.readFileSync(rec.compact, 'utf8');
    assert.ok(
      out.indexOf('# Lesson 1: Arrays') < out.indexOf('# Lesson 2: Lists'),
    );
    assert.equal(
      tool.check(rec).lines.filter((l) => l.tag === 'heading').length,
      3,
    );
  });
});

describe('drop', () => {
  it('removes one section and keeps the rest', () => {
    write('raw/drop.md', RAW);
    const rec = recipe('drop', write('drop-compact.md', COMPACT));
    assert.deepEqual(tool.drop(rec, 'Lesson 1: Arrays'), {
      action: 'dropped',
      title: 'Lesson 1: Arrays',
    });
    const out = fs.readFileSync(rec.compact, 'utf8');
    assert.ok(out.startsWith('# Pack title\n'));
    assert.ok(!out.includes('Lesson 1'));
    assert.ok(out.includes('# Lesson 2: Lists'));
    assert.throws(() => tool.drop(rec, 'Lesson 1: Arrays'), /No H1 section/);
  });
});

describe('command line', () => {
  it('exits 1 with the usage on a bad command', () => {
    assert.throws(
      () =>
        execFileSync(process.execPath, [SCRIPT, 'bogus'], { stdio: 'pipe' }),
      (err) => err.status === 1 && /Usage:/.test(String(err.stderr)),
    );
  });
});
