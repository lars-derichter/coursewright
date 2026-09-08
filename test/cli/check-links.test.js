const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  extractLinks,
  classify,
  splitFragment,
  cleanTarget,
  collectRoot,
  checkLinks,
} = require('../../cli/check-links');
const { _clearCache } = require('../../lib/config/course-config');

describe('extractLinks', () => {
  it('finds inline links and images with 1-based line numbers', () => {
    const md =
      'intro\n[see here](./02-overview.md) and\n![alt](_files/foo.png)\n';
    const links = extractLinks(md);
    assert.deepEqual(links, [
      { target: './02-overview.md', line: 2 },
      { target: '_files/foo.png', line: 3 },
    ]);
  });

  it('ignores links inside fenced code blocks', () => {
    const md = 'a\n```\n[not a link](./nope.md)\n```\n[real](./yes.md)\n';
    const links = extractLinks(md);
    assert.deepEqual(links, [{ target: './yes.md', line: 5 }]);
  });

  it('ignores links inside inline code spans', () => {
    const md = 'see `[code](./nope.md)` but [real](./yes.md)\n';
    const links = extractLinks(md);
    assert.deepEqual(links, [{ target: './yes.md', line: 1 }]);
  });

  it('strips a link title and angle brackets from the target', () => {
    const md = '[a](./x.md "title")\n[b](<./y.md>)\n';
    const links = extractLinks(md);
    assert.deepEqual(links, [
      { target: './x.md', line: 1 },
      { target: './y.md', line: 2 },
    ]);
  });
});

describe('classify', () => {
  it('recognises anchors, external, protocol, absolute and relative targets', () => {
    assert.equal(classify('#section'), 'anchor');
    assert.equal(classify('https://example.com'), 'external');
    assert.equal(classify('//example.com'), 'external');
    assert.equal(classify('mailto:x@y.z'), 'mail');
    assert.equal(classify('/games/foo'), 'absolute');
    assert.equal(classify('@site/course/x.md'), 'absolute');
    assert.equal(classify('./x.md'), 'relative');
    assert.equal(classify('../mod/x.md'), 'relative');
  });
});

describe('splitFragment', () => {
  it('separates a path from its anchor', () => {
    assert.deepEqual(splitFragment('foo.md#bar'), {
      filePath: 'foo.md',
      fragment: 'bar',
    });
    assert.deepEqual(splitFragment('foo.md'), {
      filePath: 'foo.md',
      fragment: '',
    });
    assert.deepEqual(splitFragment('#bar'), { filePath: '', fragment: 'bar' });
  });
});

describe('cleanTarget', () => {
  it('drops titles and angle brackets', () => {
    assert.equal(cleanTarget('./x.md "t"'), './x.md');
    assert.equal(cleanTarget('<./x.md>'), './x.md');
    assert.equal(cleanTarget('  ./x.md  '), './x.md');
  });
});

describe('collectRoot', () => {
  it('accumulates every --root the command line repeats', () => {
    assert.deepEqual(collectRoot('course', []), ['course']);
    assert.deepEqual(collectRoot('docs', ['course']), ['course', 'docs']);
    assert.deepEqual(collectRoot('docs', undefined), ['docs']);
  });
});

describe('checkLinks', () => {
  /** A project root with one module page linking good and bad targets. */
  function makeProject() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'check-links-'));
    const courseDir = path.join(root, 'course', '01-mod');
    fs.mkdirSync(path.join(courseDir, '_files'), { recursive: true });
    fs.writeFileSync(path.join(courseDir, '02-overview.md'), 'ok\n');
    fs.writeFileSync(path.join(courseDir, '_files', 'foo.png'), 'x');
    fs.writeFileSync(
      path.join(courseDir, '01-index.md'),
      [
        '[good](./02-overview.md)',
        '[good-anchor](./02-overview.md#heading)',
        '[img](_files/foo.png)',
        '[bad](./99-missing.md)',
        '[ext](https://example.com)',
        '[anchor-only](#top)',
      ].join('\n') + '\n',
    );
    return root;
  }

  it('reports only broken relative links, keeping anchors on existing files', () => {
    const root = makeProject();
    try {
      const { broken, filesChecked } = checkLinks({ root, roots: ['course'] });
      assert.equal(filesChecked, 2);
      assert.equal(broken.length, 1);
      assert.equal(broken[0].target, './99-missing.md');
      assert.match(broken[0].file, /01-index\.md$/);
      assert.equal(broken[0].line, 4);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('scans course/ alone when the config names no roots', () => {
    const root = makeProject();
    fs.mkdirSync(path.join(root, 'notes'));
    fs.writeFileSync(path.join(root, 'notes', 'a.md'), '[x](./gone.md)\n');
    try {
      _clearCache();
      const { broken, filesChecked } = checkLinks({ root });
      assert.equal(filesChecked, 2);
      assert.deepEqual(
        broken.map((b) => b.target),
        ['./99-missing.md'],
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      _clearCache();
    }
  });

  it('scans the roots checks.links.roots names in course.config.yml', () => {
    const root = makeProject();
    fs.mkdirSync(path.join(root, 'notes'));
    fs.writeFileSync(path.join(root, 'notes', 'a.md'), '[x](./gone.md)\n');
    fs.writeFileSync(
      path.join(root, 'course.config.yml'),
      'checks:\n  links:\n    roots: [course, notes]\n',
    );
    try {
      _clearCache();
      const { broken, filesChecked } = checkLinks({ root });
      assert.equal(filesChecked, 3);
      assert.deepEqual(broken.map((b) => b.target).sort(), [
        './99-missing.md',
        './gone.md',
      ]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      _clearCache();
    }
  });

  it('skips a configured root that does not exist', () => {
    const root = makeProject();
    try {
      const { filesChecked } = checkLinks({ root, roots: ['course', 'nope'] });
      assert.equal(filesChecked, 2);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
