const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  buildPlainMarkdown,
  preprocessPlainItem,
  buildPlainHeader,
  prependTitleHeading,
  stripImages,
  stripHtmlComments,
  unlinkLocalLinks,
} = require('../../lib/export/plain-markdown');
const { getLabels } = require('../../lib/config/labels');

/** Build a minimal page item carrying inline markdown. */
function page(relativePath, title, rawMd) {
  return {
    type: 'item',
    canvasType: 'page',
    relativePath,
    file: relativePath.split('/').pop(),
    title,
    rawMd,
    frontmatter: {},
    indent: 0,
  };
}

/** Build a bodyless item (file, external_url, quiz, external_tool). */
function bodyless(canvasType, relativePath, title, frontmatter = {}) {
  return {
    type: 'item',
    canvasType,
    relativePath,
    file: relativePath.split('/').pop(),
    title,
    frontmatter,
    indent: 0,
  };
}

// No test here reaches the filesystem: every page item carries its own rawMd,
// and the bodyless types never read a file.
const ctx = { courseDir: '/course' };

/** Render one item as a single-module export. */
function render(item, meta = {}, context = ctx) {
  return buildPlainMarkdown(
    [{ moduleTitle: 'A', moduleFolder: '01-a', items: [item] }],
    { regime: 'flat', ...meta },
    context,
  );
}

describe('stripImages', () => {
  it('replaces an image by its alt text in italics', () => {
    assert.equal(stripImages('![Diagram](_files/d.png)'), '*Diagram*');
  });

  it('drops an alt-less image without leaving a blank line behind', () => {
    assert.equal(stripImages('Intro\n\n![](d.png)\n\nOutro'), 'Intro\n\nOutro');
  });

  it('replaces an image in the middle of a sentence in place', () => {
    assert.equal(
      stripImages('See ![the map](m.png) for the route.'),
      'See *the map* for the route.',
    );
  });

  it('ignores the title part of an image', () => {
    assert.equal(stripImages('![Alt](d.png "A title")'), '*Alt*');
  });

  it('takes the alt of a raw img tag from its alt attribute', () => {
    assert.equal(stripImages('<img src="x.png" alt="Diagram">'), '*Diagram*');
    assert.equal(stripImages("<img src='x.png' alt='Diagram'>"), '*Diagram*');
  });

  it('removes a raw img tag that has no alt', () => {
    assert.equal(
      stripImages('Before\n\n<img src="x.png">\n\nAfter'),
      'Before\n\nAfter',
    );
  });

  it('leaves images inside code untouched', () => {
    const fenced = '```\n![a](d.png)\n```';
    assert.equal(stripImages(fenced), fenced);
    const inline = 'Write `![a](d.png)` for an image.';
    assert.equal(stripImages(inline), inline);
  });

  it('drops all sources, remote ones included', () => {
    const out = stripImages('![Chart](https://example.com/c.png)');
    assert.equal(out, '*Chart*');
  });
});

describe('stripHtmlComments', () => {
  it('removes a single-line comment and the gap it leaves', () => {
    assert.equal(stripHtmlComments('A\n\n<!-- note -->\n\nB'), 'A\n\nB');
    assert.equal(stripHtmlComments('A\n<!-- note -->\nB'), 'A\nB');
  });

  it('removes a multi-line comment without piling up blank lines', () => {
    assert.equal(
      stripHtmlComments('A\n\n<!--\nTODO: draw this\nand that\n-->\n\nB'),
      'A\n\nB',
    );
  });

  it('leaves a comment inside a fence untouched', () => {
    const fenced = '```html\n<!-- keep me -->\n```';
    assert.equal(stripHtmlComments(fenced), fenced);
  });

  it('removes an inline comment and keeps the text around it', () => {
    assert.equal(stripHtmlComments('Some <!-- note --> text.'), 'Some text.');
  });
});

describe('unlinkLocalLinks', () => {
  it('unlinks every target the pack cannot follow', () => {
    assert.equal(unlinkLocalLinks('[x](./other.md)'), 'x');
    assert.equal(unlinkLocalLinks('[x](#frag)'), 'x');
    assert.equal(unlinkLocalLinks('[x](../_files/a.zip)'), 'x');
    assert.equal(unlinkLocalLinks('[x](/abs/path)'), 'x');
  });

  it('keeps web and mailto links verbatim', () => {
    const input =
      '[a](https://x.com) [b](http://x.com) [c](//x.com) [d](mailto:a@b.com)';
    assert.equal(unlinkLocalLinks(input), input);
  });

  it('leaves a link inside inline code untouched', () => {
    const input = 'Write `[x](./other.md)` for a cross-link.';
    assert.equal(unlinkLocalLinks(input), input);
  });
});

describe('preprocessPlainItem', () => {
  const item = page('01-a/01-one.md', 'One');

  it('strips the frontmatter', () => {
    const out = preprocessPlainItem(
      '---\ntitle: One\ncanvas_type: page\n---\n\nBody.\n',
      item,
      ctx,
    );
    assert.equal(out, 'Body.');
    assert.doesNotMatch(out, /canvas_type/);
  });

  it('keeps a GFM alert verbatim, quote markers and all', () => {
    const out = preprocessPlainItem('> [!NOTE]\n>\n> Mind this.\n', item, ctx);
    assert.equal(out, '> [!NOTE]\n>\n> Mind this.');
    assert.doesNotMatch(out, /:::/);
  });

  it('shifts headings by ctx.headingShift', () => {
    const out = preprocessPlainItem('# One\n\n## Sub\n', item, {
      ...ctx,
      headingShift: 1,
    });
    assert.equal(out, '## One\n\n### Sub');
  });

  it('runs comments before images and images before links', () => {
    const out = preprocessPlainItem(
      '<!-- ![Hidden](h.png) -->\n\n[![Chart](c.png)](./other.md)\n',
      item,
      ctx,
    );
    assert.equal(out, '*Chart*');
  });
});

describe('buildPlainHeader', () => {
  it('returns nothing without a title', () => {
    assert.equal(buildPlainHeader({}), '');
    assert.equal(buildPlainHeader({ course: 'C', date: '2026-01-01' }), '');
  });

  it('emits the title alone when nothing else is set', () => {
    assert.equal(buildPlainHeader({ title: 'T' }), '# T');
  });

  it('joins subtitle and course into one italic line', () => {
    assert.equal(
      buildPlainHeader({ title: 'T', subtitle: 'Sub', course: 'Course' }),
      '# T\n\n*Sub · Course*',
    );
  });

  it('emits only the part that is set', () => {
    assert.equal(
      buildPlainHeader({ title: 'T', course: 'Course' }),
      '# T\n\n*Course*',
    );
    assert.equal(
      buildPlainHeader({ title: 'T', subtitle: 'Sub' }),
      '# T\n\n*Sub*',
    );
  });

  it('adds the date on its own line when set', () => {
    assert.equal(
      buildPlainHeader({ title: 'T', date: '2026-08-29' }),
      '# T\n\n2026-08-29',
    );
  });
});

describe('prependTitleHeading', () => {
  it('heads the body with the title at the requested level', () => {
    const out = prependTitleHeading('Just body', page('m/p.md', 'Title'), 2);
    assert.equal(out, '## Title\n\nJust body');
  });

  it('uses the frontmatter title even when the body opens with a heading', () => {
    const out = prependTitleHeading(
      '# Other\n\nBody',
      page('m/p.md', 'Title'),
      1,
    );
    assert.equal(out, '# Title\n\n# Other\n\nBody');
  });

  it('keeps an emoji in the title intact', () => {
    const out = prependTitleHeading('Body', page('m/p.md', '📘 Alerts'), 1);
    assert.equal(out, '# 📘 Alerts\n\nBody');
  });

  it('yields the heading alone for an empty body', () => {
    const out = prependTitleHeading('\n\n', page('m/p.md', 'Title'), 1);
    assert.equal(out, '# Title');
  });
});

describe('buildPlainMarkdown', () => {
  const groupA = {
    moduleTitle: 'Module A',
    moduleFolder: '01-a',
    items: [page('01-a/01-one.md', 'One', 'Body one.')],
  };

  it('flat regime: items are H1, no module heading, no header', () => {
    const md = buildPlainMarkdown([groupA], { regime: 'flat' }, ctx);
    assert.equal(md, '# One\n\nBody one.\n');
  });

  it('course regime: module is H1, item is H2, body shifted +1', () => {
    const md = buildPlainMarkdown(
      [
        {
          moduleTitle: 'Module A',
          moduleFolder: '01-a',
          items: [page('01-a/01-one.md', 'One', '## Sub\n\nBody.')],
        },
      ],
      { regime: 'course' },
      ctx,
    );
    assert.match(md, /^# Module A$/m);
    assert.match(md, /^## One$/m);
    assert.match(md, /^### Sub$/m);
  });

  it('bare regime: body untouched, header only when the caller titles it', () => {
    const md = buildPlainMarkdown(
      [groupA],
      { regime: 'bare', title: 'Ignored' },
      ctx,
    );
    assert.equal(md, '# Ignored\n\n# One\n\nBody one.\n');
  });

  it('leads with the header when the export has a title', () => {
    const md = buildPlainMarkdown(
      [groupA],
      { regime: 'flat', title: 'My Course', course: 'C', date: '2026-08-29' },
      ctx,
    );
    assert.match(md, /^# My Course\n\n\*C\*\n\n2026-08-29\n\n# One/);
  });

  it('nests subheader children one level deeper', () => {
    const groups = [
      {
        moduleTitle: 'A',
        moduleFolder: '01-a',
        items: [
          {
            type: 'subheader',
            folderName: '02-sub',
            title: 'Sub Section',
            items: [
              {
                ...page('01-a/02-sub/01-c.md', 'Child', 'c.'),
                indent: 1,
              },
            ],
          },
        ],
      },
    ];
    const md = buildPlainMarkdown(groups, { regime: 'course' }, ctx);
    assert.match(md, /^## Sub Section$/m); // subheader at item level (H2)
    assert.match(md, /^### Child$/m); // child one deeper (H3)
  });

  it('renders a file item as its attachment label plus the basename', () => {
    const md = render(
      bodyless('file', '01-a/03-diagram.md', 'Diagram', {
        file_ref: '_files/workflow.svg',
      }),
      { lang: 'en' },
    );
    assert.equal(md, '# Diagram\n\nAttachment: workflow.svg\n');
  });

  it('falls back to the item file when there is no file_ref', () => {
    const md = render(bodyless('file', '01-a/03-diagram.md', 'Diagram'));
    assert.match(md, /^Attachment: 03-diagram\.md$/m);
  });

  it('renders an external_url item as a bare URL line', () => {
    const md = render(
      bodyless('external_url', '01-a/02-link.md', 'A Link', {
        external_url: 'https://example.com',
      }),
    );
    assert.equal(md, '# A Link\n\nhttps://example.com\n');
  });

  it('renders an external_url item without a URL as the heading alone', () => {
    const md = render(
      bodyless('external_url', '01-a/02-link.md', 'A Link', {
        external_url: '   ',
      }),
    );
    assert.equal(md, '# A Link\n');
  });

  it('renders quiz and external tool items as the reference notice', () => {
    const notice = getLabels('en').reference.notice;
    for (const type of ['quiz', 'external_tool']) {
      const md = render(bodyless(type, `01-a/04-${type}.md`, 'Ref'));
      assert.equal(md, `# Ref\n\n*${notice}*\n`);
    }
  });

  it('follows the document language', () => {
    const md = render(bodyless('quiz', '01-a/05-test.md', 'Test'), {
      lang: 'nl',
    });
    assert.match(md, new RegExp(getLabels('nl').reference.notice.slice(0, 40)));
  });

  it('prefers labels supplied by the caller over the language', () => {
    const md = render(
      bodyless('quiz', '01-a/05-test.md', 'Test'),
      { lang: 'nl' },
      { ...ctx, labels: { reference: { notice: 'Staat in Canvas.' } } },
    );
    assert.equal(md, '# Test\n\n*Staat in Canvas.*\n');
  });
});

// One page carrying every construct the plain flavour has to answer for. The
// point is the whole document: nothing pandoc-only survives into a file a
// student hands to a chatbot.
describe('buildPlainMarkdown: the plain contract', () => {
  const body = [
    '<!-- TODO: replace the placeholder -->',
    '',
    '> [!NOTE]',
    '> Read this first.',
    '',
    '![The workflow](_files/workflow.png)',
    '',
    'See [the next page](02-next.md), grab [the starter](_files/start.zip),',
    'and read [the docs](https://example.com/docs).',
  ].join('\n');

  const md = buildPlainMarkdown(
    [
      {
        moduleTitle: 'Module A',
        moduleFolder: '01-a',
        items: [page('01-a/01-one.md', 'One', body)],
      },
    ],
    { regime: 'course', title: 'My Course', lang: 'en' },
    ctx,
  );

  it('emits no pandoc-only syntax, no anchors, no YAML and no comments', () => {
    assert.doesNotMatch(md, /:::|\{#|^---|\/course\/|<!--/m);
  });

  it('keeps the alert as a GFM blockquote', () => {
    assert.match(md, /> \[!NOTE\]/);
    assert.match(md, /> Read this first\./);
  });

  it('keeps the web link and unlinks the local ones', () => {
    assert.match(md, /\[the docs\]\(https:\/\/example\.com\/docs\)/);
    assert.match(md, /See the next page, grab the starter,/);
    assert.doesNotMatch(md, /start\.zip/);
    assert.doesNotMatch(md, /02-next\.md/);
  });

  it('reduces the image to its alt text', () => {
    assert.match(md, /^\*The workflow\*$/m);
    assert.doesNotMatch(md, /workflow\.png/);
  });
});
