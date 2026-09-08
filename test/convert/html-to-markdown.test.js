const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const TurndownService = require('turndown');
const {
  htmlToMarkdown,
  canvasItemToMarkdown,
} = require('../../lib/convert/html-to-markdown');
const { markdownToHtml } = require('../../lib/convert/markdown-to-html');

describe('htmlToMarkdown', () => {
  it('converts basic HTML to markdown', () => {
    const md = htmlToMarkdown('<h1>Title</h1><p>Paragraph.</p>');
    assert.match(md, /# Title/);
    assert.match(md, /Paragraph\./);
  });

  it('converts headings at different levels', () => {
    const md = htmlToMarkdown('<h2>Sub</h2><h3>SubSub</h3>');
    assert.match(md, /## Sub/);
    assert.match(md, /### SubSub/);
  });

  it('converts bold and italic', () => {
    const md = htmlToMarkdown(
      '<p><strong>bold</strong> and <em>italic</em></p>',
    );
    assert.ok(md.includes('**bold**'), 'Expected bold markdown');
    // Asserted through the push rather than as a string: which delimiter
    // turndown picked is cosmetic, whether what it wrote still reads as
    // emphasis is not.
    assert.match(markdownToHtml(md), /<em>italic<\/em>/);
  });

  it('converts strikethrough from every tag that spells it', () => {
    // A pull's input is Canvas HTML, not this project's markdown, and Canvas's
    // rich-content editor writes <s> where markdownToHtml writes <del>.
    // <strike> is the legacy spelling still sitting in older pages. Without a
    // rule for these, turndown keeps the text and drops the tag, so the
    // strikethrough leaves the file and the next push makes the loss stick.
    assert.equal(
      htmlToMarkdown('<p>A <s>gone</s> word.</p>'),
      'A ~~gone~~ word.',
    );
    assert.equal(
      htmlToMarkdown('<p>A <strike>gone</strike> word.</p>'),
      'A ~~gone~~ word.',
    );
    assert.equal(
      htmlToMarkdown('<p>A <del>gone</del> word.</p>'),
      'A ~~gone~~ word.',
    );
  });

  it('sends Canvas <s> back up as <del> on the next push', () => {
    // The one normalisation in that set: three spellings collapse to `~~`, and
    // the push that follows picks <del>. Different tag, same strikethrough.
    const md = htmlToMarkdown('<p>A <s>gone</s> word.</p>');
    assert.match(markdownToHtml(md), /<del>gone<\/del>/);
  });

  it('converts code blocks', () => {
    const md = htmlToMarkdown('<pre><code>const x = 1;</code></pre>');
    assert.match(md, /```/);
    assert.match(md, /const x = 1;/);
  });

  it('converts unordered lists', () => {
    const md = htmlToMarkdown('<ul><li>Item A</li><li>Item B</li></ul>');
    assert.ok(md.includes('Item A'), 'Expected Item A');
    assert.ok(md.includes('Item B'), 'Expected Item B');
    assert.match(md, /^-/m, 'Expected bullet list markers');
  });

  it('converts links', () => {
    const md = htmlToMarkdown('<a href="https://example.com">Link</a>');
    assert.match(md, /\[Link\]\(https:\/\/example\.com\)/);
  });

  it('converts images', () => {
    const md = htmlToMarkdown('<img src="image.png" alt="Photo">');
    assert.match(md, /!\[Photo\]\(image\.png\)/);
  });

  it('handles empty input', () => {
    assert.equal(htmlToMarkdown(''), '');
    assert.equal(htmlToMarkdown(null), '');
  });
});

describe('htmlToMarkdown tables', () => {
  it('converts a table with a header row to a GFM pipe table', () => {
    const html =
      '<table><thead><tr><th>Name</th><th>Score</th></tr></thead>' +
      '<tbody><tr><td>Alice</td><td>10</td></tr></tbody></table>';
    const md = htmlToMarkdown(html);
    assert.match(md, /\| Name \| Score \|/);
    assert.match(md, /\| ---/, 'Expected header separator row');
    assert.match(md, /\| Alice \| 10\s+\|/);
  });

  it('converts a headerless table (Canvas RCE style)', () => {
    const html =
      '<table style="border-collapse: collapse;"><tbody>' +
      '<tr><td><p>a</p></td><td><p>b</p></td></tr>' +
      '<tr><td>1</td><td>2</td></tr></tbody></table>';
    const md = htmlToMarkdown(html);
    assert.match(md, /\| a\s+\| b\s+\|/);
    assert.match(md, /\| ---/, 'Expected header separator row');
    assert.match(md, /\| 1\s+\| 2\s+\|/);
  });

  it('round-trips a pipe table through push and pull conversion', () => {
    const { markdownToHtml } = require('../../lib/convert/markdown-to-html');
    const source =
      '| Name | Score |\n| --- | --- |\n| Alice | 10 |\n| Bob | 7 |';
    const md = htmlToMarkdown(markdownToHtml(source));
    assert.match(md, /\| Name \| Score \|/);
    assert.match(md, /\| ---/, 'Expected header separator row');
    assert.match(md, /\| Alice \| 10\s+\|/);
    assert.match(md, /\| Bob\s+\| 7\s+\|/);
  });

  it('drops the table styling on pull', () => {
    // A push styles every table inline, because Canvas serves no stylesheet.
    // None of that reaches the author's file: @joplin/turndown-plugin-gfm keeps
    // a table as raw HTML only when `preserveTableStyles` is set, and this
    // repo never sets it, so a styled table pulls back as a plain pipe table.
    const md = htmlToMarkdown(
      markdownToHtml('| A | B |\n| --- | --- |\n| 1 | 2 |'),
    );
    assert.doesNotMatch(md, /style=/);
    assert.doesNotMatch(md, /<table/);

    // The trapdoor, pinned: the plugin's `tableShouldBeHtml` keeps a table as
    // HTML when that option is on and a cell carries a style it lists, and its
    // list holds `background`, `border`, `border-bottom` and `padding`,
    // exactly what the renderer emits. Turned on, every table this project
    // pushes would come back into the markdown as raw HTML.
    assert.equal(
      new TurndownService().options.preserveTableStyles,
      undefined,
      'preserveTableStyles is on, so a pull now writes tables as raw HTML',
    );
  });

  it('resolves Canvas links inside table cells', () => {
    const html =
      '<table><thead><tr><th>Link</th></tr></thead><tbody><tr>' +
      '<td><a href="/courses/42/pages/welcome">Welcome</a></td>' +
      '</tr></tbody></table>';
    const md = htmlToMarkdown(html, {
      linkResolver: (href) =>
        href === '/courses/42/pages/welcome' ? './01-welcome.md' : null,
    });
    assert.match(md, /\[Welcome\]\(.\/01-welcome\.md\)/);
    assert.match(md, /\| Link \|/);
  });
});

describe('htmlToMarkdown alerts', () => {
  const alertHtml = (type, title, body) =>
    `<div class="markdown-alert markdown-alert-${type}" style="border-left: .25em solid #ccc; padding-left: 1em;">
      <p class="markdown-alert-title" style="font-size: 1.2em;">${title}</p>
      <p>${body}</p>
    </div><p>\u00a0</p>`;

  it('converts NOTE alert back to GFM syntax', () => {
    const md = htmlToMarkdown(alertHtml('note', 'Info', 'This is a note.'));
    assert.match(md, /\[!NOTE\]/);
    assert.match(md, /This is a note\./);
  });

  it('converts CAUTION back to ATTENTION', () => {
    const md = htmlToMarkdown(alertHtml('caution', 'Opgelet', 'Watch out!'));
    assert.match(md, /\[!ATTENTION\]/);
    assert.match(md, /Watch out!/);
  });

  it('converts TIP alert', () => {
    const md = htmlToMarkdown(alertHtml('tip', 'Tip', 'A tip.'));
    assert.match(md, /\[!TIP\]/);
  });

  it('converts CHECK alert', () => {
    const md = htmlToMarkdown(alertHtml('check', 'Check', 'All good.'));
    assert.match(md, /\[!CHECK\]/);
  });

  it('preserves plain text nodes inside alerts', () => {
    const html = `<div class="markdown-alert markdown-alert-note" style="border-left: .25em solid #ccc; padding-left: 1em;">
      <p class="markdown-alert-title" style="font-size: 1.2em;">Info</p>
      Some plain text without a wrapper element.
    </div>`;
    const md = htmlToMarkdown(html);
    assert.match(md, /\[!NOTE\]/);
    assert.match(md, /Some plain text without a wrapper element\./);
  });

  // No rule in html-to-markdown.js does this, and none needs to: `\s` matches
  // U+00A0, so `<p>&nbsp;</p>` satisfies turndown's own `isBlank` test and
  // `rules.forNode` hands it to `blankRule` before it ever scans the custom
  // rules. The spacer markdownToHtml emits after every alert has always been
  // dropped by turndown itself. Worth pinning anyway: the day that stops being
  // true, every pulled alert grows a stray non-breaking space.
  //
  // The paragraph after the alert is what makes this a pin rather than a
  // decoration. Turndown finishes by trimming `/[\t\r\n\s]+$/` off its output,
  // and `\s` matches U+00A0 there too, so a spacer left as the last node is
  // swept up by that trim whatever the blank handling did with it. Without
  // something following it, this assertion passes even against a converter
  // deliberately broken to emit the character.
  it('strips spacer paragraphs after alerts', () => {
    const html = alertHtml('note', 'Info', 'Content.') + '<p>After.</p>';
    const md = htmlToMarkdown(html);
    assert.doesNotMatch(md, /\u00a0/);
    assert.match(md, /After\./);
  });
});

describe('htmlToMarkdown link resolution', () => {
  it('resolves Canvas page links via linkResolver', () => {
    const html = '<a href="/courses/42/pages/welcome">Welcome</a>';
    const md = htmlToMarkdown(html, {
      linkResolver: (href) =>
        href === '/courses/42/pages/welcome' ? './01-welcome.md' : null,
    });
    assert.match(md, /\[Welcome\]\(.\/01-welcome\.md\)/);
  });

  it('resolves Canvas assignment links', () => {
    const html = '<a href="/courses/42/assignments/300">Assignment</a>';
    const md = htmlToMarkdown(html, {
      linkResolver: (href) =>
        href === '/courses/42/assignments/300' ? '../02-mod/01-hw.md' : null,
    });
    assert.match(md, /\[Assignment\]\(\.\.\/02-mod\/01-hw\.md\)/);
  });

  it('resolves Canvas discussion links', () => {
    const html = '<a href="/courses/42/discussion_topics/77">Debate</a>';
    const md = htmlToMarkdown(html, {
      linkResolver: (href) =>
        href === '/courses/42/discussion_topics/77' ? './03-debate.md' : null,
    });
    assert.match(md, /\[Debate\]\(\.\/03-debate\.md\)/);
  });

  it('leaves an unresolvable Canvas discussion link as-is', () => {
    const html = '<a href="/courses/42/discussion_topics/999">Gone</a>';
    const md = htmlToMarkdown(html, { linkResolver: () => null });
    assert.match(md, /\[Gone\]\(\/courses\/42\/discussion_topics\/999\)/);
  });

  it('leaves non-Canvas links unchanged', () => {
    const html = '<a href="https://example.com">External</a>';
    const md = htmlToMarkdown(html, {
      linkResolver: () => null,
    });
    assert.match(md, /\[External\]\(https:\/\/example\.com\)/);
  });
});

describe('htmlToMarkdown file resolution', () => {
  it('resolves Canvas file images via fileResolver', () => {
    const html = '<img src="/courses/42/files/500/preview" alt="diagram">';
    const md = htmlToMarkdown(html, {
      fileResolver: (src) =>
        src === '/courses/42/files/500/preview' ? './_files/diagram.png' : null,
    });
    assert.match(md, /!\[diagram\]\(\.\/_files\/diagram\.png\)/);
  });

  it('resolves Canvas file links via fileResolver', () => {
    const html = '<a href="/courses/42/files/600/download">PDF</a>';
    const md = htmlToMarkdown(html, {
      fileResolver: (href) =>
        href === '/courses/42/files/600/download' ? './_files/guide.pdf' : null,
    });
    assert.match(md, /\[PDF\]\(\.\/_files\/guide\.pdf\)/);
  });
});

describe('canvasItemToMarkdown', () => {
  it('converts a Canvas page to markdown with frontmatter', () => {
    const item = {
      title: 'Welcome',
      page_id: 100,
      url: 'welcome',
      body: '<p>Hello world.</p>',
    };
    const md = canvasItemToMarkdown(item, 'page');

    assert.match(md, /title: Welcome/);
    assert.match(md, /canvas_type: page/);
    assert.ok(
      !md.includes('canvas_id'),
      'which Canvas page this is belongs to the sync state, keyed by path',
    );
    assert.match(md, /Hello world\./);
  });

  it('keeps an emoji in the Canvas title literal', () => {
    // A course whose page titles lead with an emoji is the common case, not the
    // exotic one, and a pull that escaped it wrote `title: "\U0001F3E5 Afwezig"`
    // into a file the author then had to read.
    const md = canvasItemToMarkdown(
      {
        title: '\u{1F3E5} Afwezig',
        page_id: 101,
        url: 'afwezig',
        body: '<p>Hi.</p>',
      },
      'page',
    );

    assert.match(md, /title: \u{1F3E5} Afwezig/u);
    assert.ok(!md.includes('\\U'), `escaped the emoji: ${md}`);
  });

  it('writes title and canvas_type and no identity at all', () => {
    // The whole of what a pull puts in the frontmatter about identity: what the
    // file is called, and what kind of Canvas object it should be. Which object
    // is in `.canvas-sync.json`, keyed by this file's path.
    const md = canvasItemToMarkdown(
      { title: 'Welcome', page_id: 100, url: 'welcome', body: '<p>Hi.</p>' },
      'page',
    );
    const frontmatter = md.split('---')[1];

    assert.deepEqual(
      frontmatter
        .split('\n')
        .filter(Boolean)
        .map((line) => line.split(':')[0]),
      ['title', 'canvas_type'],
    );
  });

  it('converts a Canvas assignment with metadata', () => {
    const item = {
      name: 'Homework 1',
      id: 300,
      description: '<p>Do this assignment.</p>',
      points_possible: 10,
      submission_types: ['online_upload'],
      due_at: '2025-03-15T23:59:00Z',
      published: true,
    };
    const md = canvasItemToMarkdown(item, 'assignment');

    assert.match(md, /title: Homework 1/);
    assert.match(md, /canvas_type: assignment/);
    assert.ok(!md.includes('canvas_id'));
    assert.match(md, /points_possible: 10/);
    assert.match(md, /Do this assignment\./);
  });

  it('converts a Canvas discussion with its metadata', () => {
    const item = {
      title: 'Week 1 debate',
      id: 77,
      message: '<p>Say something.</p>',
      discussion_type: 'threaded',
      require_initial_post: true,
      published: true,
      delayed_post_at: '2026-03-01T08:00:00Z',
      lock_at: '2026-03-08T23:59:00Z',
    };
    const md = canvasItemToMarkdown(item, 'discussion');

    assert.match(md, /title: Week 1 debate/);
    assert.match(md, /canvas_type: discussion/);
    assert.ok(!md.includes('canvas_id'));
    assert.match(md, /discussion_type: threaded/);
    assert.match(md, /require_initial_post: true/);
    assert.match(md, /published: true/);
    assert.ok(md.includes('delayed_post_at:'), 'Expected delayed_post_at');
    assert.ok(md.includes('lock_at:'), 'Expected lock_at');
    assert.match(md, /Say something\./);
  });

  it('writes the discussion message as the markdown body', () => {
    const item = {
      title: 'Week 1 debate',
      id: 77,
      message: '<h2>Prompt</h2><p>What do you think?</p>',
    };
    const md = canvasItemToMarkdown(item, 'discussion');

    assert.match(md, /## Prompt/);
    assert.match(md, /What do you think\?/);
  });

  it('drops a discussion field the Canvas topic no longer has', () => {
    const item = { title: 'Week 1 debate', id: 77, message: '<p>Hi.</p>' };
    const md = canvasItemToMarkdown(item, 'discussion', {
      existingFrontmatter: {
        discussion_type: 'threaded',
        lock_at: '2026-03-08T23:59:00Z',
        lesson: 3,
      },
    });

    assert.ok(
      !md.includes('discussion_type'),
      'Expected a threading change in Canvas to reach the file',
    );
    assert.ok(!md.includes('lock_at'), 'Expected the same for lock_at');
    assert.match(md, /lesson: 3/);
  });

  it('writes a quiz reference file from a module item', () => {
    const item = { title: 'Test 1', id: 800, content_id: 12 };
    const md = canvasItemToMarkdown(item, 'quiz');

    assert.match(md, /title: Test 1/);
    assert.match(md, /canvas_type: quiz/);
    assert.ok(
      !md.includes('canvas_id'),
      'the stub says what the file is, never which Canvas object it points at',
    );
  });

  it('gives a quiz no body, since its questions are not held here', () => {
    const md = canvasItemToMarkdown(
      { title: 'Test 1', content_id: 12, description: '<p>Read this.</p>' },
      'quiz',
    );

    assert.ok(!md.includes('Read this.'), 'Expected a frontmatter-only file');
  });

  it('keeps the quiz_ref a pull found in the local file', () => {
    const md = canvasItemToMarkdown(
      { title: 'Test 1', content_id: 12 },
      'quiz',
      {
        existingFrontmatter: {
          quiz_ref: 'evaluations/2526/test-1/test-1-qti.zip',
        },
      },
    );

    assert.match(md, /quiz_ref: evaluations\/2526\/test-1\/test-1-qti\.zip/);
  });

  it('converts an external URL item', () => {
    const item = {
      title: 'Resource',
      id: 400,
      external_url: 'https://example.com/resource',
    };
    const md = canvasItemToMarkdown(item, 'external_url');

    assert.match(md, /title: Resource/);
    assert.match(md, /canvas_type: external_url/);
    assert.ok(
      md.includes('external_url:'),
      'Expected external_url in frontmatter',
    );
    assert.ok(
      md.includes('https://example.com/resource'),
      'Expected URL in frontmatter',
    );
  });

  it('handles items with no body', () => {
    const item = { title: 'Empty', page_id: 999, url: 'empty', body: '' };
    const md = canvasItemToMarkdown(item, 'page');
    assert.match(md, /title: Empty/);
    assert.match(md, /canvas_type: page/);
  });

  it('carries over frontmatter keys Canvas knows nothing about', () => {
    const item = {
      title: 'Welcome',
      page_id: 100,
      url: 'welcome',
      body: '<p>Hello.</p>',
    };
    const md = canvasItemToMarkdown(item, 'page', {
      existingFrontmatter: {
        title: 'Stale local title',
        canvas_type: 'page',
        canvas_id: 100,
        export: true,
        lesson: 3,
        anything_at_all: 'kept',
      },
    });

    assert.match(md, /export: true/);
    assert.match(md, /lesson: 3/);
    assert.match(md, /anything_at_all: kept/);
    // Canvas stays authoritative for the keys it owns.
    assert.match(md, /title: Welcome/);
    assert.ok(
      !md.includes('Stale local title'),
      'Expected the Canvas title to win',
    );
    // A `canvas_id` written into a file by hand is cleared, not carried over.
    // It is a Canvas-owned key that never has a value, so it goes the way any
    // owned key with no value goes — leaving it would leave a second id in the
    // file to drift from the sync row for good.
    assert.ok(!md.includes('canvas_id'));
  });

  it('drops a Canvas-owned field the Canvas item no longer has', () => {
    const item = {
      name: 'Homework 1',
      id: 300,
      description: '<p>Do this.</p>',
      points_possible: 10,
    };
    const md = canvasItemToMarkdown(item, 'assignment', {
      existingFrontmatter: {
        due_at: '2025-03-15T23:59:00Z',
        lock_at: '2025-03-22T23:59:00Z',
        export: true,
      },
    });

    assert.ok(
      !md.includes('due_at'),
      'Expected a due date cleared in Canvas to clear locally',
    );
    assert.ok(!md.includes('lock_at'), 'Expected the same for lock_at');
    assert.match(md, /export: true/);
  });
});

/**
 * Compare two pieces of HTML the way a reader sees them rather than the way a
 * diff does.
 *
 * Deliberately ignored, because none of it changes what the page says:
 *
 *   - whitespace between tags, so `</p>\n<ul>` and `</p><ul>` compare equal;
 *   - runs of whitespace inside text, which HTML collapses when it renders, so
 *     a newline where the other side has a space reads identically;
 *   - leading and trailing whitespace of the whole document.
 *
 * Deliberately *not* ignored: everything inside a `<pre>`, where whitespace is
 * the content and not the layout. Those spans are compared byte for byte, so a
 * code block that comes back re-indented still fails. Nothing else is touched
 * either — tag names, attributes (the alert class and its inline colours
 * included), attribute order, element order and text all have to match.
 */
function normaliseHtml(html) {
  return String(html)
    .split(/(<pre[\s\S]*?<\/pre>)/)
    .map((part, index) =>
      index % 2 === 1
        ? part
        : part.replace(/>\s+</g, '><').replace(/\s+/g, ' '),
    )
    .join('')
    .trim();
}

/**
 * Push markdown to Canvas, pull it back down, and push the result again.
 *
 *   h1  — the HTML the first push sends to Canvas
 *   md2 — the markdown the pull writes back into the file
 *   h2  — the HTML the next push would send
 *
 * `options` reaches all three legs. Both converters read the same two resolver
 * names, and a real sync always passes them, which matters for more than
 * completeness: `markdownToHtml` only installs its own link and image renderers
 * when it is given one, so the trip a case runs without them never reaches the
 * code that escapes a URL. A pair of resolvers answering null is the honest
 * stand-in for a reference that resolves to nothing — installed, resolving
 * nothing, leaving the URL the author wrote as the one under test.
 */
function roundTrips(sourceMarkdown, options = {}) {
  const h1 = markdownToHtml(sourceMarkdown, options);
  const md2 = htmlToMarkdown(h1, options);
  const h2 = markdownToHtml(md2, options);
  return { h1, md2, h2 };
}

/**
 * The invariant this whole suite exists for: an author's markdown, pushed to
 * Canvas and pulled back down, means the same thing on the next push. If `h1`
 * and `h2` differ, push and pull disagree about what the page says and the two
 * commands can ping-pong the page forever.
 *
 * `md2 === source` is deliberately not the invariant and never will be:
 * turndown indents lists and wraps lines its own way, and neither changes the
 * meaning. Where the markdown a pull writes is worth pinning in its own right,
 * the cases below assert on `md2` as well, because HTML equality alone would
 * pass happily if both pushes were equally wrong.
 */
function assertSurvivesRoundTrip({ h1, md2, h2 }) {
  assert.equal(
    normaliseHtml(h2),
    normaliseHtml(h1),
    `A pull changed what the page says. The pull wrote:\n${md2}`,
  );
}

describe('round trip through push and pull: text and inline formatting', () => {
  it('survives consecutive paragraphs', () => {
    const rt = roundTrips('An opening paragraph.\n\nA second paragraph.\n');
    assertSurvivesRoundTrip(rt);
    assert.match(rt.md2, /^An opening paragraph\.$/m);
    assert.match(rt.md2, /^A second paragraph\.$/m);
  });

  it('survives strong and emphasis', () => {
    const rt = roundTrips('A **bold** word and an *italic* word.\n');
    assertSurvivesRoundTrip(rt);
    assert.match(rt.md2, /\*\*bold\*\*/);
    // Nothing but whitespace either side, so the emphasis rule picks `_`, the
    // delimiter Prettier writes. The cases below are the ones that cannot.
    assert.match(rt.md2, /_italic_/);
  });

  it('survives emphasis between two word characters', () => {
    // `_` cannot do this one: an underscore flanked by alphanumerics can
    // neither open nor close emphasis, so a pull that wrote `2_3_4` would hand
    // the next push three literal characters where an <em> used to be.
    const rt = roundTrips('The default grid is 2*3*4 cells.\n');
    assertSurvivesRoundTrip(rt);
    assert.match(rt.md2, /2\*3\*4/);
  });

  it('survives emphasis with a word character on one side only', () => {
    // A word character on the left and a space on the right still rules `_`
    // out, because the opening one cannot open. This is why the rule asks
    // whether either neighbour is a word character rather than both.
    const rt = roundTrips('Type foo*bar* baz to run it.\n');
    assertSurvivesRoundTrip(rt);
    assert.match(rt.md2, /foo\*bar\* baz/);
  });

  it('survives strong wrapping emphasis', () => {
    // The construct an unconditional `*` breaks: turndown collapses the two
    // delimiters into `***both***`, which CommonMark re-reads as emphasis
    // wrapping strong — the nesting inverted. Nothing covered this before,
    // which is how a fully green suite missed it.
    const rt = roundTrips('Make it **_both_** at once.\n');
    assertSurvivesRoundTrip(rt);
    assert.match(rt.md2, /\*\*_both_\*\*/);
  });

  it('survives emphasis wrapping strong', () => {
    // The same pair the other way round, which has to keep its own nesting.
    const rt = roundTrips('Make it _**both**_ at once.\n');
    assertSurvivesRoundTrip(rt);
    assert.match(rt.md2, /_\*\*both\*\*_/);
  });

  it('survives strikethrough', () => {
    const rt = roundTrips('A ~~struck out~~ word and a plain one.\n');
    assertSurvivesRoundTrip(rt);
    assert.match(rt.md2, /~~struck out~~/);
    assert.match(rt.md2, /and a plain one\./);
  });

  it('survives inline code', () => {
    const rt = roundTrips('Run the `push` command first.\n');
    assertSurvivesRoundTrip(rt);
    assert.match(rt.md2, /`push`/);
  });

  it('survives a link', () => {
    const rt = roundTrips('Read [the guide](https://example.com/guide).\n');
    assertSurvivesRoundTrip(rt);
    assert.match(rt.md2, /\[the guide\]\(https:\/\/example\.com\/guide\)/);
  });

  it('survives a link title', () => {
    const rt = roundTrips(
      'Read [the guide](https://example.com/guide "The guide").\n',
    );
    assertSurvivesRoundTrip(rt);
    assert.match(
      rt.md2,
      /\[the guide\]\(https:\/\/example\.com\/guide "The guide"\)/,
    );
  });

  it('survives an image', () => {
    const rt = roundTrips('![A flow diagram](./_files/flow.png)\n');
    assertSurvivesRoundTrip(rt);
    assert.match(rt.md2, /!\[A flow diagram\]\(\.\/_files\/flow\.png\)/);
  });

  it('survives an image title', () => {
    const rt = roundTrips('![A flow diagram](./_files/flow.png "Figure 1")\n');
    assertSurvivesRoundTrip(rt);
    assert.match(
      rt.md2,
      /!\[A flow diagram\]\(\.\/_files\/flow\.png "Figure 1"\)/,
    );
  });
});

describe('escaping on the way down from Canvas', () => {
  it('leaves an underscore inside a word unescaped', () => {
    assert.equal(
      htmlToMarkdown('<p>Use snake_case and foo_bar_baz in Python.</p>'),
      'Use snake_case and foo_bar_baz in Python.',
    );
  });

  it('round-trips an underscore inside a word', () => {
    const rt = roundTrips('Use snake_case and foo_bar_baz in Python.\n');
    assertSurvivesRoundTrip(rt);
    assert.match(rt.md2, /snake_case/);
    assert.match(rt.md2, /foo_bar_baz/);
    assert.doesNotMatch(rt.md2, /\\_/, 'Expected no backslash noise at all');
  });

  it('keeps escaping an underscore at either end of a word', () => {
    // The guard that stops the fix over-reaching, and it matters more than the
    // positive case: `_lead` can open emphasis and `trail_` can close it, so a
    // pull that dropped these two backslashes would hand the next push a pair
    // that italicises everything between them.
    assert.equal(
      htmlToMarkdown('<p>A _lead and a trail_ word.</p>'),
      'A \\_lead and a trail\\_ word.',
    );
    const rt = roundTrips('A \\_lead and a trail\\_ word.\n');
    assertSurvivesRoundTrip(rt);
    assert.doesNotMatch(
      markdownToHtml(rt.md2),
      /<em>/,
      'Expected the two underscores not to pair up into emphasis',
    );
  });

  it('keeps escaping an underscore standing on its own', () => {
    assert.equal(htmlToMarkdown('<p>a _ b</p>'), 'a \\_ b');
    assert.equal(
      htmlToMarkdown('<p>_ opens the line and closes it _</p>'),
      '\\_ opens the line and closes it \\_',
    );
    assertSurvivesRoundTrip(roundTrips('a \\_ b\n'));
  });

  it('keeps escaping a doubled underscore, dunder names included', () => {
    // Neither pair here is intraword on both sides: the leading `__` can open
    // strong emphasis and the trailing `__` can close it, so unescaped it comes
    // back from the next push as <strong>init</strong>. Escaping the whole run
    // is the conservative reading of the rule and the correct one.
    assert.equal(
      htmlToMarkdown('<p>Python has __init__ methods.</p>'),
      'Python has \\_\\_init\\_\\_ methods.',
    );
    const rt = roundTrips('Python has \\_\\_init\\_\\_ methods.\n');
    assertSurvivesRoundTrip(rt);
    assert.doesNotMatch(markdownToHtml(rt.md2), /<strong>/);
  });

  it('escapes and emphasises within the same run of text', () => {
    // The new escape and the per-node emphasis delimiter exercised together:
    // the two loose underscores are the <em>, the two inside words are text.
    const md = htmlToMarkdown(
      '<p>snake_case with <em>emphasis</em> and more_names</p>',
    );
    assert.equal(md, 'snake_case with _emphasis_ and more_names');
    assert.equal(
      normaliseHtml(markdownToHtml(md)),
      normaliseHtml('<p>snake_case with <em>emphasis</em> and more_names</p>'),
    );
  });

  it('counts a letter or digit in any script as a word character', () => {
    // The condition is `\p{L}\p{N}`, not `\w`, so an accented or CJK neighbour
    // makes the underscore literal exactly as an ASCII one does.
    const rt = roundTrips('The names café_señor and 変数_名前 are literal.\n');
    assertSurvivesRoundTrip(rt);
    assert.match(rt.md2, /café_señor/);
    assert.match(rt.md2, /変数_名前/);
  });

  it('neither doubles nor drops a backslash Canvas already holds', () => {
    // The text node itself contains `\_`, i.e. someone escaped the underscore
    // in Canvas. Both characters are literal text and both have to come back as
    // literal text: the backslash escaped as `\\`, and the underscore still
    // escaped, because a backslash is not a word character.
    const md = htmlToMarkdown('<p>A back\\_slash already there.</p>');
    assert.equal(md, 'A back\\\\\\_slash already there.');
    assert.match(
      markdownToHtml(md),
      /A back\\_slash already there\./,
      'Expected the next push to send the same two literal characters',
    );
  });

  it('still escapes every other character turndown escapes', () => {
    // `_` was the only one let through: `*` delimits emphasis intraword too, a
    // backtick always opens a code span, and a bracket needs a parser to judge.
    // Each case carries an intraword underscore as well, which also shows that
    // hiding one disturbs no rule anchored to the start of the text node.
    assert.equal(
      htmlToMarkdown('<p>A * star and a ` tick in snake_case.</p>'),
      'A \\* star and a \\` tick in snake_case.',
    );
    assert.equal(
      htmlToMarkdown('<p>[a bracket] beside snake_case</p>'),
      '\\[a bracket\\] beside snake_case',
    );
    assert.equal(
      htmlToMarkdown('<p># not a heading, snake_case</p>'),
      '\\# not a heading, snake_case',
    );
    assert.equal(
      htmlToMarkdown('<p>&gt; not a quote, snake_case</p>'),
      '\\> not a quote, snake_case',
    );
    assert.equal(
      htmlToMarkdown('<p>1. not a list, snake_case</p>'),
      '1\\. not a list, snake_case',
    );
    assert.equal(
      htmlToMarkdown('<p>- not a bullet, snake_case</p>'),
      '\\- not a bullet, snake_case',
    );
  });

  it('hides an intraword underscore where no turndown rule can notice it', () => {
    // The coupling the fix has to turndown's internals. Rather than copy
    // turndown's escape table into this repo minus its `_` row, htmlToMarkdown
    // swaps intraword underscores for U+0000, lets turndown's own escape do the
    // work, and swaps them back. Two conditions make that sound, and both are
    // pinned here so a turndown upgrade cannot break either quietly.
    const placeholder = '\u0000';
    const escapeAll = TurndownService.prototype.escape;

    // One: no rule in the table matches the placeholder.
    assert.equal(
      escapeAll(`before${placeholder}after`),
      `before${placeholder}after`,
    );

    // Two: no rule matches `_` either, bar the one being worked around, so a
    // one-for-one swap at the same index is invisible to the other twelve. This
    // is the leg that is easy to leave out, and matching no rule is not enough
    // without it: six of the thirteen rules are anchored to the start of the
    // string and read a prefix rather than one character, so a swap they could
    // see would carry an escape off with it, and `-lead` without its backslash
    // is a bullet on the next push. One string per anchored rule, escaped with
    // the underscore hidden and with it showing, has to come out differing in
    // nothing but that underscore.
    for (const text of [
      '-lead_word',
      '+ plus_word',
      '=setext_word',
      '# heading_word',
      '~~~fence_word',
      '>quote_word',
      '1. ordered_word',
      '1_2. digits',
    ]) {
      assert.equal(
        escapeAll(text.split('_').join(placeholder)),
        escapeAll(text).split('\\_').join(placeholder),
        `Hiding the underscore changed how turndown escaped ${text}`,
      );
    }
  });

  // Turndown's escape table has no `<` rule, which is right for CommonMark and
  // wrong here twice: the preview is MDX, which reads `<` as a tag whenever the
  // next character is not whitespace, and an unescaped one goes back to Canvas
  // on the next push as markup rather than as the words it was.
  it('escapes an angle bracket that would open a tag', () => {
    assert.equal(
      htmlToMarkdown('<p>Whatsapp ons op &lt;tel nr&gt;.</p>'),
      'Whatsapp ons op \\<tel nr>.',
    );
    assert.equal(
      htmlToMarkdown('<p>Emoji &lt;3, and x&lt;y, and &lt;/close.</p>'),
      'Emoji \\<3, and x\\<y, and \\</close.',
    );
  });

  it('leaves a spaced comparison alone, which is most prose', () => {
    // The guard against over-reaching. MDX starts a tag only on a non-space,
    // so escaping these would be backslash noise on every maths-shaped line
    // for no gain at all.
    assert.equal(
      htmlToMarkdown('<p>Compare a &lt; b and c &gt; d.</p>'),
      'Compare a < b and c > d.',
    );
    assert.equal(
      htmlToMarkdown('<p>As a &lt; type of user &gt;, I want …</p>'),
      'As a < type of user >, I want …',
    );
  });

  it('leaves markup inside a code span raw', () => {
    // Only text nodes reach the escaper, so a code span keeps the angle
    // brackets an author needs to show markup at all.
    assert.equal(
      htmlToMarkdown('<p>Use <code>&lt;div&gt;</code> for a block.</p>'),
      'Use `<div>` for a block.',
    );
  });

  it('round-trips an angle bracket back to the text Canvas sent', () => {
    // The push-side half. Unescaped, `<tel nr>` reaches Canvas as a tag and
    // the words vanish from the page; escaped, it comes back as `&lt;tel nr&gt;`.
    const rt = roundTrips('Whatsapp ons op \\<tel nr>.\n');
    assertSurvivesRoundTrip(rt);
    assert.match(rt.md2, /\\<tel nr>/);
    assert.match(markdownToHtml(rt.md2), /&lt;tel nr&gt;/);
  });

  it('round-trips a link wrapped in angle brackets', () => {
    // The second shape a real Canvas import produced, and the one whose MDX
    // error named `[` rather than a tag name.
    const rt = roundTrips(
      'Verzameld door \\<[DOCENT](https://example.com)\\>\n',
    );
    assertSurvivesRoundTrip(rt);
    assert.match(rt.md2, /\\</);
  });
});

describe('round trip through push and pull: block structure', () => {
  it('survives every heading level', () => {
    const rt = roundTrips(
      '# One\n\n## Two\n\n### Three\n\n#### Four\n\n##### Five\n\n###### Six\n',
    );
    assertSurvivesRoundTrip(rt);
    assert.match(rt.md2, /^# One$/m);
    assert.match(rt.md2, /^## Two$/m);
    assert.match(rt.md2, /^### Three$/m);
    assert.match(rt.md2, /^#### Four$/m);
    assert.match(rt.md2, /^##### Five$/m);
    assert.match(rt.md2, /^###### Six$/m);
  });

  it('survives a fenced code block with its language hint', () => {
    const rt = roundTrips(
      '```js\nfunction add(a, b) {\n  return a + b;\n}\n```\n',
    );
    assertSurvivesRoundTrip(rt);
    assert.ok(
      rt.md2.includes('```js\n'),
      'Expected the fence to come back with its language hint',
    );
    assert.ok(
      rt.md2.includes('function add(a, b) {\n  return a + b;\n}'),
      'Expected the body back with its indentation untouched',
    );
  });

  it('survives a fenced code block indented deeper than one level', () => {
    const rt = roundTrips(
      '```python\ndef add(a, b):\n    total = a + b\n    return total\n```\n',
    );
    assertSurvivesRoundTrip(rt);
    assert.ok(rt.md2.includes('```python\n'));
    assert.ok(
      rt.md2.includes('def add(a, b):\n    total = a + b\n    return total'),
      'Expected four-space Python indentation to come back as four spaces',
    );
  });

  it('survives an unordered list', () => {
    const rt = roundTrips('- Apples\n- Pears\n- Plums\n');
    assertSurvivesRoundTrip(rt);
    assert.match(rt.md2, /^-\s+Apples$/m);
    assert.match(rt.md2, /^-\s+Pears$/m);
    assert.match(rt.md2, /^-\s+Plums$/m);
  });

  it('survives a nested unordered list', () => {
    const rt = roundTrips('- Fruit\n  - Apples\n  - Pears\n- Vegetables\n');
    assertSurvivesRoundTrip(rt);
    assert.match(rt.md2, /^-\s+Fruit$/m);
    assert.match(rt.md2, /^-\s+Vegetables$/m);
    // How far turndown indents a nested item is its own business; that the
    // item is still nested at all is not.
    assert.match(rt.md2, /^\s+-\s+Apples$/m);
    assert.match(rt.md2, /^\s+-\s+Pears$/m);
  });

  it('survives a task list, box and tick alike', () => {
    const rt = roundTrips('- [ ] Still to do\n- [x] Already done\n');
    assertSurvivesRoundTrip(rt);
    // Turndown's own three-space list indent plus the space the plugin adds
    // after the box, so the gaps are wider than an author would type. It reads
    // oddly and it re-parses as a task list all the same.
    assert.match(rt.md2, /^-\s+\[ \]\s+Still to do$/m);
    assert.match(rt.md2, /^-\s+\[x\]\s+Already done$/m);
  });

  it('survives inline formatting inside a task list item', () => {
    const rt = roundTrips(
      '- [ ] Run **push** with the `--dry-run` flag\n' +
        '- [x] Read [the guide](https://example.com/guide)\n',
    );
    assertSurvivesRoundTrip(rt);
    assert.match(
      rt.md2,
      /^-\s+\[ \]\s+Run \*\*push\*\* with the `--dry-run` flag$/m,
    );
    assert.match(
      rt.md2,
      /^-\s+\[x\]\s+Read \[the guide\]\(https:\/\/example\.com\/guide\)$/m,
    );
  });

  it('survives an ordered list', () => {
    const rt = roundTrips('1. First\n2. Second\n3. Third\n');
    assertSurvivesRoundTrip(rt);
    assert.match(rt.md2, /^1\.\s+First$/m);
    assert.match(rt.md2, /^2\.\s+Second$/m);
    assert.match(rt.md2, /^3\.\s+Third$/m);
  });

  // An author makes an empty bullet by pressing enter twice in Canvas's rich
  // content editor, and `marked` produces `<li></li>` for the markdown form of
  // it. That node is blank by turndown's test, so without the blankReplacement
  // in htmlToMarkdown it never reaches the built-in listItem rule and the item
  // is dropped. Losing the bullet is the small half; the blank line it leaves
  // behind is what makes `marked` re-read a tight list as loose, so the next
  // push sends `<li><p>One</p></li>` where the last one sent `<li>One</li>`.
  it('survives an empty item in the middle of a list', () => {
    const rt = roundTrips('- One\n-\n- Three\n');
    assertSurvivesRoundTrip(rt);
    assert.match(rt.md2, /^-\s+One$/m);
    assert.match(rt.md2, /^-\s+Three$/m);
    assert.match(rt.md2, /^-\s*$/m, 'Expected the empty item to come back');
    // The half that breaks the round trip rather than merely losing content.
    assert.doesNotMatch(
      rt.h2,
      /<li><p>/,
      'A dropped empty item turns the tight list loose on the next push',
    );
  });

  it('survives an empty item at either end of a list', () => {
    // Only the middle case flips the list loose, so the first and last items
    // used to vanish with nothing in the HTML to show for it.
    const first = roundTrips('-\n- Two\n- Three\n');
    assertSurvivesRoundTrip(first);
    assert.equal((first.h1.match(/<li>/g) || []).length, 3);

    const last = roundTrips('- One\n- Two\n-\n');
    assertSurvivesRoundTrip(last);
    assert.equal((last.h1.match(/<li>/g) || []).length, 3);
  });

  it('survives an empty item in an ordered list without renumbering', () => {
    // Delegating to turndown's own listItem rule is what keeps the numbering
    // right: it reads the item's index in its parent, so the items after the
    // empty one keep the numbers they went out with.
    const rt = roundTrips('1. One\n2.\n3. Three\n');
    assertSurvivesRoundTrip(rt);
    assert.match(rt.md2, /^1\.\s+One$/m);
    assert.match(rt.md2, /^2\.\s*$/m, 'Expected the empty item to come back');
    assert.match(rt.md2, /^3\.\s+Three$/m);
  });

  it('keeps turndown owning the list-item prefix', () => {
    // The coupling the empty-item fix has to turndown's internals, and the only
    // one: htmlToMarkdown's blankReplacement hands a blank <li> to
    // `options.rules.listItem` rather than rebuilding the bullet marker, the
    // `<ol start=…>` offset and the trailing newline itself. Pinned here so a
    // turndown upgrade that moved or renamed that rule fails loudly instead of
    // throwing inside every pull.
    const rule = new TurndownService().options.rules.listItem;
    assert.equal(typeof rule.replacement, 'function', 'rules.listItem moved');
    assert.equal(rule.filter, 'li');
  });

  it('survives a blockquote of two paragraphs', () => {
    const rt = roundTrips('> First quoted line.\n>\n> Second quoted line.\n');
    assertSurvivesRoundTrip(rt);
    assert.match(rt.md2, /^> First quoted line\.$/m);
    assert.match(rt.md2, /^> Second quoted line\.$/m);
  });

  it('survives a GFM pipe table', () => {
    const rt = roundTrips(
      '| Name | Score |\n| --- | --- |\n| Alice | 10 |\n| Bob | 7 |\n',
    );
    assertSurvivesRoundTrip(rt);
    assert.match(rt.md2, /\| Name \| Score \|/);
    assert.match(rt.md2, /\| ---/, 'Expected header separator row');
    assert.match(rt.md2, /\| Alice \| 10\s+\|/);
    assert.match(rt.md2, /\| Bob\s+\| 7\s+\|/);
  });

  it('survives a pipe table with column alignment', () => {
    // Alignment rides on the `align` attribute a push emits, never on a
    // `text-align` in the cell style: the pull reads either one as the column's
    // alignment, so a style-borne one would put a `:---` under every column of
    // a table nobody aligned.
    const rt = roundTrips(
      '| L | R | C |\n| :--- | ---: | :---: |\n| 1 | 2 | 3 |\n',
    );
    assertSurvivesRoundTrip(rt);
    assert.ok(rt.md2.includes('| :--- |'), `No left column in:\n${rt.md2}`);
    assert.ok(rt.md2.includes('| ---: |'), `No right column in:\n${rt.md2}`);
    assert.ok(rt.md2.includes('| :---: |'), `No centre column in:\n${rt.md2}`);
  });
});

describe('round trip through push and pull: alerts', () => {
  // Every type in ALERT_TYPE_MAP (lib/convert/html-to-markdown.js), which is
  // the set this project supports.
  const alertTypes = [
    'NOTE',
    'TIP',
    'IMPORTANT',
    'WARNING',
    'ATTENTION',
    'CHECK',
  ];

  for (const type of alertTypes) {
    it(`survives ${type} alerts`, () => {
      const rt = roundTrips(`> [!${type}]\n>\n> The body of the alert.\n`);
      assertSurvivesRoundTrip(rt);
      assert.match(rt.md2, new RegExp(`^> \\[!${type}\\]$`, 'm'));
      assert.match(rt.md2, /^> The body of the alert\.$/m);
    });
  }

  it('keeps ATTENTION spelled ATTENTION, though Canvas holds it as caution', () => {
    // markdownToHtml rewrites [!ATTENTION] to [!CAUTION] so marked-alert knows
    // it, which lands in Canvas as markdown-alert-caution; ALERT_TYPE_MAP maps
    // that class back to ATTENTION. Both halves of the asymmetry, in one trip.
    const rt = roundTrips('> [!ATTENTION]\n>\n> Mind the gap.\n');
    assertSurvivesRoundTrip(rt);
    assert.match(rt.h1, /markdown-alert-caution/);
    assert.match(rt.md2, /\[!ATTENTION\]/);
    assert.doesNotMatch(
      rt.md2,
      /\[!CAUTION\]/,
      'Expected the pull to undo the rewrite the push made',
    );
  });

  it('survives an alert written out as a fenced example', () => {
    // A lesson that teaches the alert syntax would carry one of these. The push
    // used to rewrite the marker inside the fence, so the page on Canvas told
    // the reader to write `[!CAUTION]`, and the pull then wrote that spelling
    // back into the source file.
    const rt = roundTrips(
      'Write this:\n\n```md\n> [!ATTENTION]\n>\n> Mind this.\n```\n',
    );
    assertSurvivesRoundTrip(rt);
    assert.match(rt.h1, /&gt; \[!ATTENTION\]/);
    assert.doesNotMatch(rt.h1, /CAUTION/);
    assert.doesNotMatch(rt.h1, /markdown-alert/);
    assert.match(rt.md2, /^> \[!ATTENTION\]$/m);
  });

  it('survives an alert whose body is more than one paragraph', () => {
    const rt = roundTrips(
      '> [!NOTE]\n>\n> The first paragraph.\n>\n> The second paragraph.\n',
    );
    assertSurvivesRoundTrip(rt);
    assert.match(rt.md2, /^> \[!NOTE\]$/m);
    assert.match(rt.md2, /^> The first paragraph\.$/m);
    assert.match(rt.md2, /^> The second paragraph\.$/m);
  });

  it('survives an alert containing a list', () => {
    const rt = roundTrips(
      '> [!TIP]\n>\n> Do this:\n>\n> - Step one\n> - Step two\n',
    );
    assertSurvivesRoundTrip(rt);
    assert.match(rt.md2, /^> \[!TIP\]$/m);
    assert.match(rt.md2, /^> Do this:$/m);
    assert.match(rt.md2, /^>\s+-\s+Step one$/m);
    assert.match(rt.md2, /^>\s+-\s+Step two$/m);
  });

  it('survives inline formatting inside an alert', () => {
    const rt = roundTrips(
      '> [!IMPORTANT]\n>\n> Run **push** with the `--dry-run` flag.\n',
    );
    assertSurvivesRoundTrip(rt);
    assert.match(rt.md2, /\*\*push\*\*/);
    assert.match(rt.md2, /`--dry-run`/);
  });

  it('survives an alert followed by more content, spacer and all', () => {
    const rt = roundTrips(
      '> [!WARNING]\n>\n> Be careful.\n\nA paragraph after the alert.\n',
    );
    assertSurvivesRoundTrip(rt);
    assert.match(
      rt.h1,
      /<p>&nbsp;<\/p>/,
      'Expected the push to emit a spacer after the alert',
    );
    assert.doesNotMatch(
      rt.md2,
      /\u00a0|&nbsp;/,
      'Expected the pull to strip that spacer again',
    );
    assert.match(rt.md2, /^> \[!WARNING\]$/m);
    assert.match(rt.md2, /^A paragraph after the alert\.$/m);
  });

  it('survives two alerts in a row followed by more content', () => {
    const rt = roundTrips(
      '> [!NOTE]\n>\n> The first one.\n\n> [!TIP]\n>\n> The second one.\n\nAnd a closing paragraph.\n',
    );
    assertSurvivesRoundTrip(rt);
    assert.match(rt.md2, /^> \[!NOTE\]$/m);
    assert.match(rt.md2, /^> \[!TIP\]$/m);
    assert.doesNotMatch(rt.md2, /\u00a0|&nbsp;/);
    assert.match(rt.md2, /^And a closing paragraph\.$/m);
  });
});

describe('round trip through push and pull: escaped attributes', () => {
  // Installed so the escaping renderers run, answering null so the URL the
  // author wrote is the one that makes the trip.
  const passthrough = { linkResolver: () => null, fileResolver: () => null };

  it('survives an ampersand in a query string', () => {
    const rt = roundTrips(
      'Read [the docs](https://example.com/s?q=one&r=two).\n',
      passthrough,
    );
    assertSurvivesRoundTrip(rt);
    assert.match(rt.h1, /href="https:\/\/example\.com\/s\?q=one&amp;r=two"/);
    // The half that makes the escape safe: turndown parses the HTML rather
    // than pattern-matching it, so `&amp;` comes back off the attribute as the
    // `&` the author typed and the next push escapes it again.
    assert.match(rt.md2, /\(https:\/\/example\.com\/s\?q=one&r=two\)/);
  });

  it('survives a quote in a link href', () => {
    const rt = roundTrips(
      'Read [the docs](https://example.com/s?q=a"b).\n',
      passthrough,
    );
    assertSurvivesRoundTrip(rt);
    assert.match(rt.h1, /href="https:\/\/example\.com\/s\?q=a&quot;b"/);
    // Unescaped, the attribute ended at the quote and the pull read back
    // `…?q=a`, silently rewriting the author's link to a different URL.
    assert.match(rt.md2, /\(https:\/\/example\.com\/s\?q=a"b\)/);
  });

  it('survives a quote and an ampersand in a filename', () => {
    const rt = roundTrips(
      '![Cheese](./_files/say"cheese&co.png)\n',
      passthrough,
    );
    assertSurvivesRoundTrip(rt);
    assert.match(rt.h1, /src="\.\/_files\/say&quot;cheese&amp;co\.png"/);
    assert.match(rt.md2, /!\[Cheese\]\(\.\/_files\/say"cheese&co\.png\)/);
  });

  it('survives a Canvas file URL carrying a verifier query string', () => {
    // The real shape of the trip: the push swaps the local path for a Canvas
    // URL, the pull swaps it back. Written out rather than run through
    // roundTrips because the two resolvers point opposite ways.
    const local = './_files/diagram.png';
    const canvasUrl = '/courses/42/files/500/preview?verifier=ab12&wrap=1';
    const push = { fileResolver: (ref) => (ref === local ? canvasUrl : null) };
    const pull = {
      fileResolver: (src) =>
        src.startsWith('/courses/42/files/500/') ? local : null,
    };

    const h1 = markdownToHtml(`![A diagram](${local})\n`, push);
    assert.match(
      h1,
      /src="\/courses\/42\/files\/500\/preview\?verifier=ab12&amp;wrap=1"/,
    );
    // What `downloadReferencedFiles` (lib/sync/local-write.js) reads out of the
    // raw HTML on a pull: digits and slashes, upstream of the `?` where the
    // first escapable character can appear, so the escape cannot reach it.
    assert.deepEqual(h1.match(/\/courses\/(\d+)\/files\/(\d+)/).slice(1), [
      '42',
      '500',
    ]);

    const md2 = htmlToMarkdown(h1, pull);
    assert.match(md2, /!\[A diagram\]\(\.\/_files\/diagram\.png\)/);

    const h2 = markdownToHtml(md2, push);
    assert.equal(
      normaliseHtml(h2),
      normaliseHtml(h1),
      `A pull changed what the page says. The pull wrote:\n${md2}`,
    );
  });

  it('survives a href the author wrote with an entity in it', () => {
    // A URL copied out of a page's HTML source. marked hands the renderer the
    // destination as raw source text, so this arrives spelled `&amp;` and is
    // decoded before it is escaped again; without that it would go out as
    // `&amp;amp;` and Canvas would serve a parameter named `amp;b`.
    const rt = roundTrips(
      'Read [the docs](https://example.com/s?a=1&amp;b=2).\n',
      passthrough,
    );
    assertSurvivesRoundTrip(rt);
    assert.match(rt.h1, /href="https:\/\/example\.com\/s\?a=1&amp;b=2"/);
    assert.doesNotMatch(rt.h1, /&amp;amp;/);
    // The pull writes the URL in its decoded spelling, which is the form the
    // next push already handled — the entity spelling settles into it once and
    // stays there.
    assert.match(rt.md2, /\(https:\/\/example\.com\/s\?a=1&b=2\)/);
  });

  it('survives an image src the author wrote with an entity in it', () => {
    const rt = roundTrips('![Cheese](./_files/say&amp;co.png)\n', passthrough);
    assertSurvivesRoundTrip(rt);
    assert.match(rt.h1, /src="\.\/_files\/say&amp;co\.png"/);
    assert.doesNotMatch(rt.h1, /&amp;amp;/);
    assert.match(rt.md2, /!\[Cheese\]\(\.\/_files\/say&co\.png\)/);
  });

  it('survives an alt text the author wrote with an entity in it', () => {
    // The same trip one field over: alt text is raw source text too, so it is
    // decoded before it is escaped. Undecoded it went out as `&amp;amp;` and
    // the reader saw the entity spelled out under the image.
    const rt = roundTrips('![a &amp; b](./_files/x.png)\n', passthrough);
    assertSurvivesRoundTrip(rt);
    assert.match(rt.h1, /alt="a &amp; b"/);
    assert.doesNotMatch(rt.h1, /&amp;amp;/);
    // The pull writes the decoded spelling, which is what the next push
    // already sends: the entity settles into it once and stays there.
    assert.match(rt.md2, /!\[a & b\]\(\.\/_files\/x\.png\)/);
  });

  it('survives a link title the author wrote with an entity in it', () => {
    const rt = roundTrips(
      'Read [the docs](https://example.com "a &amp; b").\n',
      passthrough,
    );
    assertSurvivesRoundTrip(rt);
    assert.match(rt.h1, /title="a &amp; b"/);
    assert.doesNotMatch(rt.h1, /&amp;amp;/);
    assert.match(rt.md2, /\(https:\/\/example\.com "a & b"\)/);
  });

  it('pushes both spellings of one alt text to the same HTML', () => {
    const plain = roundTrips('![a & b](./_files/x.png)\n', passthrough);
    const encoded = roundTrips('![a &amp; b](./_files/x.png)\n', passthrough);
    assert.equal(encoded.h1, plain.h1);
    assert.equal(encoded.md2, plain.md2);
  });

  it('pushes both spellings of one URL to the same HTML', () => {
    // The two forms CommonMark reads as the same URL, pushed side by side.
    // Equal HTML is what makes the entity spelling settle rather than drift:
    // whichever one the author wrote, the next push sends this.
    const plain = roundTrips(
      'Read [the docs](https://example.com/s?a=1&b=2).\n',
      passthrough,
    );
    const encoded = roundTrips(
      'Read [the docs](https://example.com/s?a=1&amp;b=2).\n',
      passthrough,
    );
    assert.equal(encoded.h1, plain.h1);
    assert.equal(encoded.md2, plain.md2);
  });

  it('survives an alert, icon URL and all', () => {
    const iconUrls = {
      note: 'https://canvas.example.com/courses/42/files/9/preview?verifier=ab12&wrap=1',
    };
    const rt = roundTrips('> [!NOTE]\n>\n> Mind this.\n', {
      ...passthrough,
      iconUrls,
    });
    assertSurvivesRoundTrip(rt);
    assert.match(rt.h1, /<img[^>]*\?verifier=ab12&amp;wrap=1"/);
    // Decorative: the title beside it says the same thing in words.
    assert.match(rt.h1, /<img[^>]*alt=""/);
    assert.match(rt.md2, /^> \[!NOTE\]$/m);
    // The icon belongs to the rendering, not to the page: a pull drops it
    // along with the whole title paragraph, and the next push puts it back.
    assert.doesNotMatch(rt.md2, /verifier|!\[/);
  });
});

describe('round trip through push and pull: a whole page', () => {
  it('survives a page that mixes every construct the suite covers', () => {
    const rt = roundTrips(
      [
        '# Module 1',
        '',
        'An intro paragraph with **bold**, *italic* and `code`.',
        '',
        '## Steps',
        '',
        '1. Read [the guide](https://example.com/guide).',
        '2. Run the command.',
        '',
        '> [!NOTE]',
        '>',
        '> Remember this bit.',
        '',
        '```js',
        'const total = add(1, 2);',
        '```',
        '',
        '- Apples',
        '  - Pears',
        '',
        '| A | B |',
        '| --- | --- |',
        '| 1 | 2 |',
        '',
        '> A closing quotation.',
        '',
      ].join('\n'),
    );
    assertSurvivesRoundTrip(rt);
    assert.match(rt.md2, /^# Module 1$/m);
    assert.match(rt.md2, /^## Steps$/m);
    assert.match(rt.md2, /^> \[!NOTE\]$/m);
    assert.ok(rt.md2.includes('```js\nconst total = add(1, 2);\n```'));
    assert.match(rt.md2, /\| ---/);
    assert.match(rt.md2, /^> A closing quotation\.$/m);
  });
});
