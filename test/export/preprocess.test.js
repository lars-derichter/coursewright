const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const {
  alertsToDivs,
  shiftHeadings,
  rewriteImagePaths,
  rewriteCrossLinks,
} = require('../../lib/export/preprocess');

describe('alertsToDivs', () => {
  it('converts each GFM alert kind to a fenced div', () => {
    for (const [marker, cls] of [
      ['NOTE', 'note'],
      ['TIP', 'tip'],
      ['IMPORTANT', 'important'],
      ['WARNING', 'warning'],
      ['CAUTION', 'caution'],
    ]) {
      const out = alertsToDivs(`> [!${marker}]\n>\n> Body text.`);
      assert.match(out, new RegExp(`::: \\{\\.alert \\.${cls}\\}`));
      assert.match(out, /Body text\./);
      assert.match(out, /:::/);
    }
  });

  it('maps [!ATTENTION] to caution and preserves [!CHECK]', () => {
    assert.match(alertsToDivs('> [!ATTENTION]\n> x'), /\.alert \.caution/);
    assert.match(alertsToDivs('> [!CHECK]\n> x'), /\.alert \.check/);
  });

  it('handles inline text on the marker line', () => {
    const out = alertsToDivs('> [!NOTE] This is inline.');
    assert.match(out, /::: \{\.alert \.note\}/);
    assert.match(out, /This is inline\./);
  });

  it('does not convert alerts inside fenced code blocks', () => {
    const input = '```\n> [!NOTE]\n> example\n```';
    assert.equal(alertsToDivs(input), input);
  });

  it('leaves unknown alert kinds untouched', () => {
    const input = '> [!BOGUS]\n> x';
    assert.equal(alertsToDivs(input), input);
  });
});

describe('shiftHeadings', () => {
  it('shifts heading levels by the given amount', () => {
    assert.equal(shiftHeadings('# A\n## B', 1), '## A\n### B');
  });

  it('clamps at level 6', () => {
    assert.equal(shiftHeadings('###### Deep', 2), '###### Deep');
  });

  it('clamps at level 1 for negative shifts', () => {
    assert.equal(shiftHeadings('## A', -5), '# A');
  });

  it('ignores hashes inside fenced code blocks', () => {
    const input = '```\n# not a heading\n```';
    assert.equal(shiftHeadings(input, 1), input);
  });

  it('shifts a heading whose text is an inline code span', () => {
    assert.equal(shiftHeadings('## `void`', 1), '### `void`');
  });

  it('leaves a heading with no text alone', () => {
    assert.equal(shiftHeadings('## ', 1), '## ');
  });

  it('is a no-op when shift is 0', () => {
    const input = '# A\n## B';
    assert.equal(shiftHeadings(input, 0), input);
  });
});

describe('rewriteImagePaths', () => {
  const courseDir = '/course';

  it('rewrites a relative image path to an absolute path', () => {
    const out = rewriteImagePaths(
      '![alt](./_files/img.svg)',
      '01-mod/01-page.md',
      courseDir,
    );
    assert.equal(
      out,
      `![alt](${path.resolve('/course/01-mod/_files/img.svg')})`,
    );
  });

  it('leaves http and absolute urls untouched', () => {
    const input = '![a](https://x/y.png)\n![b](/abs.png)';
    assert.equal(
      rewriteImagePaths(input, '01-mod/01-page.md', courseDir),
      input,
    );
  });

  it('does not rewrite images inside code', () => {
    const input = '```\n![a](./_files/img.svg)\n```';
    assert.equal(
      rewriteImagePaths(input, '01-mod/01-page.md', courseDir),
      input,
    );
  });
});

describe('rewriteCrossLinks', () => {
  const anchorFor = (p) =>
    'item-' + p.replace(/[^a-z0-9]+/gi, '-').toLowerCase();

  it('rewrites a link to an included item as an internal anchor', () => {
    const ctx = {
      includedPaths: new Set(['01-mod/02-other.md']),
      anchorFor,
    };
    const out = rewriteCrossLinks(
      '[Other](02-other.md)',
      '01-mod/01-page.md',
      ctx,
    );
    assert.equal(out, `[Other](#${anchorFor('01-mod/02-other.md')})`);
  });

  it('unlinks a link to an excluded item', () => {
    const ctx = { includedPaths: new Set(), anchorFor };
    const out = rewriteCrossLinks('[Gone](99-x.md)', '01-mod/01-page.md', ctx);
    assert.equal(out, 'Gone');
  });

  it('adds a Canvas footnote when the excluded target is synced', () => {
    const ctx = {
      includedPaths: new Set(),
      anchorFor,
      linkMap: new Map([
        ['01-mod/99-x.md', { canvasType: 'page', canvasId: 'x-slug' }],
      ]),
      courseId: 42,
    };
    const out = rewriteCrossLinks('[X](99-x.md)', '01-mod/01-page.md', ctx);
    assert.equal(out, 'X^[Online: /courses/42/pages/x-slug]');
  });

  it('footnotes a discussion target with its discussion_topics URL', () => {
    const ctx = {
      includedPaths: new Set(),
      anchorFor,
      linkMap: new Map([
        ['01-mod/99-x.md', { canvasType: 'discussion', canvasId: 77 }],
      ]),
      courseId: 42,
    };
    const out = rewriteCrossLinks('[X](99-x.md)', '01-mod/01-page.md', ctx);
    assert.equal(out, 'X^[Online: /courses/42/discussion_topics/77]');
  });

  it('footnotes an assignment target with its assignments URL', () => {
    const ctx = {
      includedPaths: new Set(),
      anchorFor,
      linkMap: new Map([
        ['01-mod/99-x.md', { canvasType: 'assignment', canvasId: 300 }],
      ]),
      courseId: 42,
    };
    const out = rewriteCrossLinks('[X](99-x.md)', '01-mod/01-page.md', ctx);
    assert.equal(out, 'X^[Online: /courses/42/assignments/300]');
  });

  it('uses ctx.onlineLabel as the footnote prefix', () => {
    const ctx = {
      includedPaths: new Set(),
      anchorFor,
      linkMap: new Map([
        ['01-mod/99-x.md', { canvasType: 'page', canvasId: 'x-slug' }],
      ]),
      courseId: 42,
      onlineLabel: 'Zie online:',
    };
    const out = rewriteCrossLinks('[X](99-x.md)', '01-mod/01-page.md', ctx);
    assert.equal(out, 'X^[Zie online: /courses/42/pages/x-slug]');
  });

  it('leaves external and non-md links untouched', () => {
    const ctx = { includedPaths: new Set(), anchorFor };
    const input = '[web](https://x.com) and [file](./_files/a.zip)';
    assert.equal(rewriteCrossLinks(input, '01-mod/01-page.md', ctx), input);
  });
});
