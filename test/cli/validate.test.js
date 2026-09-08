const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { scanCourse } = require('../../lib/convert/course-scanner');
const { _validateModules: validateModules } = require('../../cli/validate');

let tmpDir;
let moduleDir;

/**
 * Run validate over the temp course tree.
 */
function run() {
  return validateModules(scanCourse(tmpDir), tmpDir);
}

/**
 * Write a file inside the module folder, creating parent folders as needed.
 */
function writeItem(relativePath, content) {
  const target = path.join(moduleDir, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

describe('validateModules — file items', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-test-'));
    moduleDir = path.join(tmpDir, '01-module');
    fs.mkdirSync(moduleDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('accepts a file wrapper whose file_ref exists', () => {
    writeItem('_files/syllabus.pdf', 'binary');
    writeItem(
      '01-syllabus.md',
      '---\ntitle: Syllabus\ncanvas_type: file\nfile_ref: _files/syllabus.pdf\n---\n',
    );

    const { errors, warnings } = run();
    assert.deepEqual(errors, []);
    assert.deepEqual(warnings, []);
  });

  it('reports a file wrapper without a file_ref', () => {
    writeItem(
      '01-syllabus.md',
      '---\ntitle: Syllabus\ncanvas_type: file\n---\n',
    );

    const { errors } = run();
    assert.deepEqual(errors, [
      '01-module/01-syllabus.md: file type requires a file_ref field',
    ]);
  });

  it('reports a file wrapper whose file_ref target is missing', () => {
    writeItem(
      '01-syllabus.md',
      '---\ntitle: Syllabus\ncanvas_type: file\nfile_ref: _files/missing.pdf\n---\n',
    );

    const { errors } = run();
    assert.deepEqual(errors, [
      '01-module/01-syllabus.md: file_ref not found: _files/missing.pdf',
    ]);
  });

  it('resolves file_ref relative to the wrapper, not the course root', () => {
    fs.mkdirSync(path.join(moduleDir, '02-section'), { recursive: true });
    writeItem('02-section/_files/handout.pdf', 'binary');
    writeItem(
      '02-section/01-handout.md',
      '---\ntitle: Handout\ncanvas_type: file\nfile_ref: _files/handout.pdf\n---\n',
    );

    const { errors } = run();
    assert.deepEqual(errors, []);
  });

  it('skips raw binaries dropped in a module folder', () => {
    writeItem('slides.pptx', 'binary');

    const { errors, warnings } = run();
    assert.deepEqual(errors, []);
    assert.deepEqual(warnings, []);
  });

  it('accepts canvas_type: discussion as a known type', () => {
    writeItem(
      '01-debate.md',
      '---\ntitle: Week 1 debate\ncanvas_type: discussion\n---\n\nSay something.\n',
    );

    const { errors } = run();
    assert.deepEqual(errors, []);
  });

  it('accepts canvas_type: file as a known type', () => {
    writeItem('_files/syllabus.pdf', 'binary');
    writeItem(
      '01-syllabus.md',
      '---\ntitle: Syllabus\ncanvas_type: file\nfile_ref: _files/syllabus.pdf\n---\n',
    );

    const { errors } = run();
    assert.equal(
      errors.some((e) => e.includes('unknown canvas_type')),
      false,
    );
  });

  it('still reports an unknown canvas_type', () => {
    writeItem(
      '01-mystery.md',
      '---\ntitle: Mystery\ncanvas_type: announcement\n---\n',
    );

    const { errors } = run();
    assert.equal(errors.length, 1);
    assert.match(
      errors[0],
      /^01-module\/01-mystery\.md: unknown canvas_type "announcement" \(expected: /,
    );
  });

  it('validates a file wrapper like any other item', () => {
    writeItem('_files/syllabus.pdf', 'binary');
    writeItem(
      'syllabus.md',
      '---\ntitle: Syllabus\ncanvas_type: file\nfile_ref: _files/syllabus.pdf\n---\n\nSee [the intro](./99-nope.md).\n',
    );

    const { errors, warnings } = run();
    assert.deepEqual(warnings, [
      '01-module/syllabus.md: filename should start with a two-digit prefix',
    ]);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /broken link to "\.\/99-nope\.md"/);
  });
});

describe('validateModules — internal links', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-links-'));
    moduleDir = path.join(tmpDir, '01-module');
    fs.mkdirSync(moduleDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // Only broken links were pinned here, and a check that reports every link
  // broken passes that. The resolved target is built with `path.posix` and
  // matched against the set of scanned item paths, so the two agree only while
  // the scanner hands over forward slashes: a native `01-module\02-next.md` in
  // the set is a string no resolved target can equal.
  it('says nothing about links to items that exist', () => {
    writeItem(
      '01-page.md',
      '---\ntitle: Page\n---\n\nSee [next](./02-next.md) and [deep](03-sub/01-deep.md).\n',
    );
    writeItem('02-next.md', '---\ntitle: Next\n---\n');
    writeItem(
      '03-sub/01-deep.md',
      '---\ntitle: Deep\n---\n\nBack to [the page](../01-page.md).\n',
    );

    const { errors, warnings } = run();
    assert.deepEqual(errors, []);
    assert.deepEqual(warnings, []);
  });
});

describe('validateModules — a level-1 heading in the body', () => {
  const WARNING =
    '01-module/01-page.md: the body opens with a level-1 heading, "# Page". ' +
    'The frontmatter title is already the page heading on the site, on Canvas ' +
    'and in every export, so this line shows the title twice: remove it and ' +
    'open the first section with ##.';

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-h1-'));
    moduleDir = path.join(tmpDir, '01-module');
    fs.mkdirSync(moduleDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  /** Write a page whose body is `body`. */
  function writePage(body) {
    writeItem('01-page.md', `---\ntitle: Page\n---\n\n${body}\n`);
  }

  it('warns about a body that opens with an H1', () => {
    writePage('# Page\n\nSome text.');

    const { errors, warnings } = run();
    assert.deepEqual(errors, []);
    assert.deepEqual(warnings, [WARNING]);
  });

  it('still warns when blank lines come first', () => {
    writePage('\n\n   \n\n# Page\n\nSome text.');

    const { warnings } = run();
    assert.deepEqual(warnings, [WARNING]);
  });

  it('says nothing about a body that opens with an H2', () => {
    writePage('## Section\n\nSome text.');

    const { errors, warnings } = run();
    assert.deepEqual(errors, []);
    assert.deepEqual(warnings, []);
  });

  it('ignores an H1 inside a fence that opens the body', () => {
    // The fence opener is the first non-blank line, so the heading inside it
    // is never the line that gets read.
    writePage('```markdown\n# Example\n```\n\nSome text.');

    const { errors, warnings } = run();
    assert.deepEqual(errors, []);
    assert.deepEqual(warnings, []);
  });

  it('says nothing about an H1 further down the page', () => {
    // Deliberate: the check is about the doubled title at the top of the page,
    // not about every H1 in the file.
    writePage('Some text.\n\n# Later heading\n\nMore text.');

    const { errors, warnings } = run();
    assert.deepEqual(errors, []);
    assert.deepEqual(warnings, []);
  });

  it('keeps the H1 warning out of the exit-code path', () => {
    // Warnings never fail validate; only errors do. A doubled title is ugly,
    // not broken: the page renders and pushes either way.
    writePage('# Page\n\nSome text.');

    const { errors } = run();
    assert.deepEqual(errors, []);
  });
});

describe('validateModules — raw HTML file references', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-rawhtml-'));
    moduleDir = path.join(tmpDir, '01-module');
    fs.mkdirSync(moduleDir, { recursive: true });
    fs.mkdirSync(path.join(moduleDir, '_files'), { recursive: true });
    // Distinct bytes, and one page referencing both inline, so the _files
    // folder checks stay quiet and these tests stay about syntax alone.
    fs.writeFileSync(
      path.join(moduleDir, '_files', 'diagram.png'),
      'png bytes',
    );
    fs.writeFileSync(
      path.join(moduleDir, '_files', 'handout.pdf'),
      'pdf bytes',
    );
    writeItem(
      '00-refs.md',
      '---\ntitle: Refs\n---\n\n![D](./_files/diagram.png)\n\n[H](./_files/handout.pdf)\n',
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  /** Write a page whose body is `body`. */
  function writePage(body) {
    writeItem('01-page.md', `---\ntitle: Page\n---\n\n${body}\n`);
  }

  it('warns about an image written as a raw HTML tag', () => {
    writePage('<img src="_files/diagram.png" alt="Diagram">');

    const { errors, warnings } = run();
    assert.deepEqual(errors, []);
    assert.equal(warnings.length, 1);
    assert.match(
      warnings[0],
      /^01-module\/01-page\.md: raw HTML <img src="_files\/diagram\.png"> will not sync\./,
    );
    assert.match(warnings[0], /!\[alt\]\(_files\/diagram\.png\)/);
  });

  it('warns about a link written as a raw HTML tag', () => {
    writePage('<a href="_files/handout.pdf">Handout</a>');

    const { errors, warnings } = run();
    assert.deepEqual(errors, []);
    assert.equal(warnings.length, 1);
    assert.match(
      warnings[0],
      /^01-module\/01-page\.md: raw HTML <a href="_files\/handout\.pdf"> will not sync\./,
    );
    assert.match(warnings[0], /\[text\]\(_files\/handout\.pdf\)/);
  });

  it('says nothing about the same references in markdown syntax', () => {
    writePage(
      '![Diagram](_files/diagram.png)\n\n[Handout](_files/handout.pdf)\n',
    );

    const { errors, warnings } = run();
    assert.deepEqual(errors, []);
    assert.deepEqual(warnings, []);
  });

  it('ignores a raw HTML example inside a fence or a code span', () => {
    writePage(
      '```html\n<img src="_files/diagram.png">\n```\n\n' +
        'Avoid `<a href="_files/handout.pdf">Handout</a>` in a page.\n',
    );

    const { errors, warnings } = run();
    assert.deepEqual(errors, []);
    assert.deepEqual(warnings, []);
  });

  it('reports each distinct raw HTML reference once', () => {
    writePage(
      '<img src="_files/diagram.png">\n\n<img src="_files/diagram.png">\n\n' +
        "<a href='_files/handout.pdf'>Handout</a>\n",
    );

    const { warnings } = run();
    assert.equal(warnings.length, 2);
    assert.match(warnings[0], /<img src="_files\/diagram\.png">/);
    assert.match(warnings[1], /<a href="_files\/handout\.pdf">/);
  });

  it('leaves an absolute URL that happens to contain _files/ alone', () => {
    writePage('<img src="https://example.org/_files/diagram.png">');

    const { errors, warnings } = run();
    assert.deepEqual(errors, []);
    assert.deepEqual(warnings, []);
  });

  it('does not mistake a data- attribute for src', () => {
    writePage('<div data-src="_files/diagram.png"></div>');

    const { warnings } = run();
    assert.deepEqual(warnings, []);
  });

  it('keeps the raw HTML warning out of the exit-code path', () => {
    // Warnings never fail validate; only errors do. This one is a warning
    // because the page still renders locally and pushes without crashing.
    writePage('<img src="_files/diagram.png">');

    const { errors } = run();
    assert.deepEqual(errors, []);
  });

  it('warns about the embed tags, not just img and a', () => {
    writePage(
      '<video src="_files/clip.mp4" controls></video>\n\n' +
        '<audio src="_files/track.mp3"></audio>\n\n' +
        '<iframe src="_files/slides.html"></iframe>\n\n' +
        '<embed src="_files/model.svg">\n\n' +
        '<object data="_files/handout.pdf"></object>\n\n' +
        '<video controls><source src="_files/clip.webm" type="video/webm"></video>\n',
    );

    const { errors, warnings } = run();
    assert.deepEqual(errors, []);
    assert.deepEqual(
      warnings.map((w) => w.replace(/^.*raw HTML (<[^>]+>).*$/s, '$1')),
      [
        '<video src="_files/clip.mp4">',
        '<audio src="_files/track.mp3">',
        '<iframe src="_files/slides.html">',
        '<embed src="_files/model.svg">',
        '<object data="_files/handout.pdf">',
        '<source src="_files/clip.webm">',
      ],
    );
  });

  it('reports each distinct embed reference once, per tag and attribute', () => {
    writePage(
      '<video src="_files/clip.mp4"></video>\n\n' +
        '<video src="_files/clip.mp4"></video>\n\n' +
        '<audio src="_files/clip.mp4"></audio>\n',
    );

    const { warnings } = run();
    assert.equal(warnings.length, 2);
    assert.match(warnings[0], /<video src="_files\/clip\.mp4">/);
    assert.match(warnings[1], /<audio src="_files\/clip\.mp4">/);
  });

  it('points a non-image embed at a markdown link', () => {
    writePage('<video src="_files/clip.mp4"></video>');

    const { warnings } = run();
    assert.equal(warnings.length, 1);
    assert.match(
      warnings[0],
      /Write it as \[text\]\(_files\/clip\.mp4\) instead\.$/,
    );
  });

  it('leaves an absolute URL on an embed tag alone', () => {
    writePage(
      '<video src="https://example.org/_files/clip.mp4"></video>\n\n' +
        '<object data="/_files/handout.pdf"></object>\n',
    );

    const { errors, warnings } = run();
    assert.deepEqual(errors, []);
    assert.deepEqual(warnings, []);
  });

  it('ignores an embed tag inside a fence or a code span', () => {
    writePage(
      '```html\n<video src="_files/clip.mp4"></video>\n```\n\n' +
        'Avoid `<object data="_files/handout.pdf"></object>` in a page.\n',
    );

    const { errors, warnings } = run();
    assert.deepEqual(errors, []);
    assert.deepEqual(warnings, []);
  });

  it('does not mistake a data- attribute for data', () => {
    writePage('<object data-src="_files/handout.pdf"></object>');

    const { warnings } = run();
    assert.deepEqual(warnings, []);
  });

  it('leaves srcset and poster unwarned', () => {
    // Both are as dead on Canvas as everything this warns about, and both are
    // out of the checked set on purpose (see the table in cli/validate.js and
    // the bullet in docs/limitations.md).
    writePage(
      '<img srcset="_files/diagram.png 1x, _files/diagram@2x.png 2x" alt="D">\n\n' +
        '<video poster="_files/diagram.png" src="https://example.org/clip.mp4"></video>\n',
    );

    const { warnings } = run();
    assert.deepEqual(warnings, []);
  });

  it('keeps the embed-tag warning out of the exit-code path', () => {
    writePage('<video src="_files/clip.mp4"></video>');

    const { errors } = run();
    assert.deepEqual(errors, []);
  });
});

describe('validateModules — reference-style file references', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-refstyle-'));
    moduleDir = path.join(tmpDir, '01-module');
    fs.mkdirSync(moduleDir, { recursive: true });
    fs.mkdirSync(path.join(moduleDir, '_files'), { recursive: true });
    // Distinct bytes, and one page referencing both inline, so the _files
    // folder checks stay quiet and these tests stay about syntax alone.
    fs.writeFileSync(
      path.join(moduleDir, '_files', 'diagram.png'),
      'png bytes',
    );
    fs.writeFileSync(
      path.join(moduleDir, '_files', 'handout.pdf'),
      'pdf bytes',
    );
    writeItem(
      '00-refs.md',
      '---\ntitle: Refs\n---\n\n![D](./_files/diagram.png)\n\n[H](./_files/handout.pdf)\n',
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  /** Write a page whose body is `body`. */
  function writePage(body) {
    writeItem('01-page.md', `---\ntitle: Page\n---\n\n${body}\n`);
  }

  it('warns about an image written reference-style', () => {
    writePage('![Diagram][d]\n\n[d]: _files/diagram.png');

    const { errors, warnings } = run();
    assert.deepEqual(errors, []);
    assert.equal(warnings.length, 1);
    assert.match(
      warnings[0],
      /^01-module\/01-page\.md: reference-style definition \[d\]: _files\/diagram\.png will not sync\./,
    );
    assert.match(warnings[0], /!\[alt\]\(_files\/diagram\.png\)/);
    assert.match(warnings[0], /\[text\]\(_files\/diagram\.png\)/);
  });

  it('warns once per definition, not once per reference to it', () => {
    writePage(
      '![Diagram][d]\n\nAnd again: ![Diagram][d]\n\nCollapsed: ![d][]\n\n' +
        'Shortcut: [d]\n\n[d]: _files/diagram.png\n[h]: _files/handout.pdf',
    );

    const { warnings } = run();
    assert.equal(warnings.length, 2);
    assert.match(warnings[0], /\[d\]: _files\/diagram\.png/);
    assert.match(warnings[1], /\[h\]: _files\/handout\.pdf/);
  });

  it('quotes the label as the author spelled it', () => {
    writePage('![Diagram][Big Label]\n\n[Big Label]: _files/diagram.png');

    const { warnings } = run();
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /definition \[Big Label\]: _files\/diagram\.png/);
  });

  it('reads an angle-bracketed destination and a title on the next line', () => {
    writePage('![Diagram][d]\n\n[d]: <_files/diagram.png>\n   "The diagram"');

    const { warnings } = run();
    assert.equal(warnings.length, 1);
    assert.match(
      warnings[0],
      /definition \[d\]: _files\/diagram\.png will not/,
    );
  });

  it('finds a definition nested in a blockquote or a list item', () => {
    // CommonMark resolves a reference through either of these, so a push turns
    // them into the same dead relative path a top-level definition would.
    writePage(
      '> [d]: _files/diagram.png\n\n- item\n\n  [h]: _files/handout.pdf',
    );

    const { warnings } = run();
    assert.equal(warnings.length, 2);
    assert.match(warnings[0], /\[d\]: _files\/diagram\.png/);
    assert.match(warnings[1], /\[h\]: _files\/handout\.pdf/);
  });

  it('says nothing about the same reference in inline syntax', () => {
    writePage(
      '![Diagram](_files/diagram.png)\n\n[Handout](_files/handout.pdf)\n',
    );

    const { errors, warnings } = run();
    assert.deepEqual(errors, []);
    assert.deepEqual(warnings, []);
  });

  it('leaves an absolute destination alone', () => {
    writePage(
      '![Diagram][d]\n\n[d]: https://example.org/_files/diagram.png\n' +
        '[h]: /_files/handout.pdf',
    );

    const { errors, warnings } = run();
    assert.deepEqual(errors, []);
    assert.deepEqual(warnings, []);
  });

  it('ignores a definition inside a fence, a code span or an indented block', () => {
    writePage(
      '```markdown\n[d]: _files/diagram.png\n```\n\n' +
        'Avoid `[d]: _files/diagram.png` at the bottom.\n\n' +
        '    [d]: _files/diagram.png\n',
    );

    const { errors, warnings } = run();
    assert.deepEqual(errors, []);
    assert.deepEqual(warnings, []);
  });

  it('does not mistake a definition-shaped line inside a paragraph for one', () => {
    // A definition cannot interrupt a paragraph, so this is prose that happens
    // to look like one and resolves no reference at all.
    writePage('Some text\n[d]: _files/diagram.png');

    const { warnings } = run();
    assert.deepEqual(warnings, []);
  });

  it('leaves a definition that points outside _files/ alone', () => {
    writePage('[d]: ./02-other.md\n[e]: ../01-module/notes.txt');

    const { warnings } = run();
    assert.deepEqual(warnings, []);
  });

  it('keeps the reference-style warning out of the exit-code path', () => {
    // Warnings never fail validate; only errors do. The page still renders
    // locally and still pushes, it just loses the file on the way.
    writePage('![Diagram][d]\n\n[d]: _files/diagram.png');

    const { errors } = run();
    assert.deepEqual(errors, []);
  });
});

describe('validateModules — the _files folders', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-files-'));
    moduleDir = path.join(tmpDir, '01-module');
    fs.mkdirSync(moduleDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  /** Write a file anywhere under the course root. */
  function write(relativePath, content) {
    const target = path.join(tmpDir, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }

  it('says nothing about a shared file referenced across modules', () => {
    write('_files/logo.png', 'the one logo');
    write(
      '01-module/01-page.md',
      '---\ntitle: Page\n---\n\n![Logo](../_files/logo.png)\n',
    );

    const { errors, warnings } = run();
    assert.deepEqual(errors, []);
    assert.deepEqual(warnings, []);
  });

  it('warns once about byte-identical copies, naming every path', () => {
    write('01-module/_files/logo.png', 'same bytes');
    write('02-module/_files/emblem.png', 'same bytes');
    write(
      '01-module/01-page.md',
      '---\ntitle: Page\n---\n\n![Logo](./_files/logo.png)\n',
    );
    write(
      '02-module/01-page.md',
      '---\ntitle: Page\n---\n\n![Emblem](./_files/emblem.png)\n',
    );

    const { errors, warnings } = run();
    assert.deepEqual(errors, []);
    assert.deepEqual(warnings, [
      '01-module/_files/logo.png: byte-identical to 02-module/_files/emblem.png. One shared copy under course/_files/ can serve every module.',
    ]);
  });

  it('warns about a binary nothing references', () => {
    write('01-module/_files/leftover.svg', 'stray icon');
    write('01-module/01-page.md', '---\ntitle: Page\n---\n\nNo images.\n');

    const { errors, warnings } = run();
    assert.deepEqual(errors, []);
    assert.deepEqual(warnings, [
      '01-module/_files/leftover.svg: nothing references this file. It is never synced, exported or shown; reference it or delete it.',
    ]);
  });

  it('counts a file_ref as a reference', () => {
    write('01-module/_files/syllabus.pdf', 'binary');
    write(
      '01-module/01-syllabus.md',
      '---\ntitle: Syllabus\ncanvas_type: file\nfile_ref: _files/syllabus.pdf\n---\n',
    );

    const { errors, warnings } = run();
    assert.deepEqual(errors, []);
    assert.deepEqual(warnings, []);
  });

  it('counts a raw HTML mention, and leaves that to its own warning', () => {
    // The raw-HTML tag already gets a warning of its own; the basename
    // fallback keeps the same file from also being reported as an orphan.
    write('01-module/_files/diagram.png', 'binary');
    write(
      '01-module/01-page.md',
      '---\ntitle: Page\n---\n\n<img src="_files/diagram.png" alt="D">\n',
    );

    const { warnings } = run();
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /raw HTML/);
  });

  it('counts a reference from loose markdown outside any module', () => {
    // course/index.md is not a scanned item, but an image it embeds is still
    // shown on the site's landing page — that file is no orphan.
    write('_files/hero.png', 'binary');
    write('index.md', '# Course\n\n![Hero](_files/hero.png)\n');
    write('01-module/01-page.md', '---\ntitle: Page\n---\n\nText.\n');

    const { errors, warnings } = run();
    assert.deepEqual(errors, []);
    assert.deepEqual(warnings, []);
  });

  it('ignores dotfiles in a _files folder', () => {
    write('01-module/_files/.DS_Store', 'finder litter');
    write('01-module/_files/photo.png', 'binary');
    write(
      '01-module/01-page.md',
      '---\ntitle: Page\n---\n\n![Photo](./_files/photo.png)\n',
    );

    const { errors, warnings } = run();
    assert.deepEqual(errors, []);
    assert.deepEqual(warnings, []);
  });
});

describe('validateModules — quiz items', () => {
  let root;
  let courseDir;
  let quizModuleDir;

  /**
   * Validate a repo-shaped temp tree: course/ holds the modules, and quiz_ref
   * paths resolve from the root above it, where evaluations/ lives.
   */
  function runFromRoot() {
    return validateModules(scanCourse(courseDir), courseDir, root);
  }

  /** Write a quiz item with the given frontmatter lines. */
  function writeQuiz(lines) {
    fs.writeFileSync(
      path.join(quizModuleDir, '05-test.md'),
      `---\ntitle: Test 1\ncanvas_type: quiz\n${lines}---\n`,
    );
  }

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-quiz-'));
    courseDir = path.join(root, 'course');
    quizModuleDir = path.join(courseDir, '01-module');
    fs.mkdirSync(quizModuleDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('accepts a quiz whose quiz_ref zip is on disk', () => {
    const zipDir = path.join(root, 'evaluations', '2526', 'test-1');
    fs.mkdirSync(zipDir, { recursive: true });
    fs.writeFileSync(path.join(zipDir, 'test-1-qti.zip'), 'binary');
    writeQuiz('quiz_ref: evaluations/2526/test-1/test-1-qti.zip\n');

    const { errors, warnings } = runFromRoot();
    assert.deepEqual(errors, []);
    assert.deepEqual(warnings, []);
  });

  it('warns about a quiz without a quiz_ref, but does not error', () => {
    // A quiz pulled from Canvas has no quiz_ref and never will until the author
    // points it at a package, so this state has to stay valid. It is still the
    // one a rollover cannot rebuild, so it has to be said out loud.
    writeQuiz('');

    const { errors, warnings } = runFromRoot();
    assert.deepEqual(errors, []);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /^01-module\/05-test\.md: quiz has no quiz_ref/);
    assert.match(warnings[0], /rollover/);
  });

  it('reports a quiz_ref that points at nothing', () => {
    writeQuiz('quiz_ref: evaluations/2526/test-1/missing-qti.zip\n');

    const { errors } = runFromRoot();
    assert.deepEqual(errors, [
      '01-module/05-test.md: quiz_ref not found: evaluations/2526/test-1/missing-qti.zip (resolved from the repo root)',
    ]);
  });

  it('resolves quiz_ref from the repo root, not from the item', () => {
    // The zip lives under evaluations/, outside course/, so a path that would
    // resolve relative to the markdown file must not be accepted.
    fs.mkdirSync(path.join(quizModuleDir, 'evaluations'), { recursive: true });
    fs.writeFileSync(
      path.join(quizModuleDir, 'evaluations', 'test-1-qti.zip'),
      'binary',
    );
    writeQuiz('quiz_ref: evaluations/test-1-qti.zip\n');

    const { errors } = runFromRoot();
    assert.equal(errors.length, 1);
    assert.match(errors[0], /quiz_ref not found/);
  });

  it('accepts canvas_type: quiz as a known type', () => {
    writeQuiz('quiz_ref: evaluations/2526/test-1/test-1-qti.zip\n');

    const { errors } = runFromRoot();
    assert.equal(
      errors.some((e) => e.includes('unknown canvas_type')),
      false,
    );
  });
});
