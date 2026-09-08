const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  buildCombinedMarkdown,
  buildMetaBlock,
  prependTitleHeading,
  anchorFor,
} = require('../../lib/export/assemble');
const {
  scanCourse,
  flattenItems,
} = require('../../lib/convert/course-scanner');
const { toPosixPath } = require('../../lib/sync/state');

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

const ctx = { courseDir: '/course', includedPaths: new Set() };

describe('anchorFor', () => {
  it('is deterministic and strips the .md extension', () => {
    assert.equal(anchorFor('01-mod/02-page.md'), 'sec-01-mod-02-page');
  });
});

describe('buildMetaBlock', () => {
  it('emits only the fields that are set, plus lang', () => {
    const block = buildMetaBlock({ title: 'T', lang: 'nl', toc: true });
    assert.match(block, /^---\n/);
    assert.match(block, /title: "T"/);
    assert.match(block, /lang: nl/);
    assert.match(block, /toc: true/);
    assert.doesNotMatch(block, /subtitle/);
  });

  it('defaults lang to en', () => {
    assert.match(buildMetaBlock({ title: 'T' }), /lang: en/);
  });

  it('escapes double quotes in values', () => {
    assert.match(buildMetaBlock({ title: 'a "b"' }), /title: "a \\"b\\""/);
  });

  it('emits a labels block when meta.labels is set', () => {
    const block = buildMetaBlock({
      labels: { note: 'Info', attachment: 'Bijlage:' },
    });
    assert.match(
      block,
      /labels:\n {2}note: "Info"\n {2}attachment: "Bijlage:"/,
    );
  });

  it('escapes quotes in label values', () => {
    const block = buildMetaBlock({ labels: { note: 'zeg "hallo"' } });
    assert.match(block, /note: "zeg \\"hallo\\""/);
  });

  it('omits the labels block when meta.labels is absent or empty', () => {
    assert.doesNotMatch(buildMetaBlock({ title: 'T' }), /labels:/);
    assert.doesNotMatch(buildMetaBlock({ labels: {} }), /labels:/);
  });
});

describe('prependTitleHeading', () => {
  it('heads the body with the title at the requested level, anchored', () => {
    const out = prependTitleHeading(
      'Just body',
      page('m/p.md', 'Title'),
      2,
      'sec-x',
    );
    assert.equal(out, '## Title {#sec-x}\n\nJust body');
  });

  it('uses the frontmatter title even when the body opens with a heading', () => {
    const out = prependTitleHeading(
      '# Other\n\nBody',
      page('m/p.md', 'Title'),
      1,
      'sec-x',
    );
    assert.equal(out, '# Title {#sec-x}\n\n# Other\n\nBody');
  });

  it('keeps an emoji in the title intact', () => {
    const out = prependTitleHeading(
      'Body',
      page('m/p.md', '📘 Alerts'),
      1,
      'sec-x',
    );
    assert.equal(out, '# 📘 Alerts {#sec-x}\n\nBody');
  });

  it('yields the heading alone for an empty body', () => {
    const out = prependTitleHeading(
      '\n\n',
      page('m/p.md', 'Title'),
      1,
      'sec-x',
    );
    assert.equal(out, '# Title {#sec-x}');
  });
});

describe('buildCombinedMarkdown', () => {
  const groupA = {
    moduleTitle: 'Module A',
    moduleFolder: '01-a',
    items: [page('01-a/01-one.md', 'One', 'Body one.')],
  };

  it('flat regime: items are H1, no module heading', () => {
    const md = buildCombinedMarkdown(
      [groupA],
      { regime: 'flat', toc: true, title: 'X' },
      ctx,
    );
    assert.match(md, /# One \{#sec-01-a-01-one\}/);
    assert.doesNotMatch(md, /# Module A/);
    assert.match(md, /toc: true/);
  });

  it('course regime: module is H1, item is H2 (body shifted +1)', () => {
    const md = buildCombinedMarkdown(
      [
        {
          moduleTitle: 'Module A',
          moduleFolder: '01-a',
          items: [page('01-a/01-one.md', 'One', '## Sub\n\nBody.')],
        },
      ],
      { regime: 'course', toc: true },
      ctx,
    );
    assert.match(md, /# Module A \{#sec-01-a\}/);
    assert.match(md, /## One \{#sec-01-a-01-one\}/);
    assert.match(md, /### Sub/); // body H2 shifted to H3
  });

  it('bare regime: no title page, the item title as H1', () => {
    const md = buildCombinedMarkdown([groupA], { regime: 'bare' }, ctx);
    assert.doesNotMatch(md, /title:/);
    assert.doesNotMatch(md, /toc: true/);
    assert.match(md, /^# One \{#sec-01-a-01-one\}$/m);
    assert.match(md, /Body one\./);
  });

  it('renders external_url items as link cards', () => {
    const ext = {
      type: 'item',
      canvasType: 'external_url',
      relativePath: '01-a/02-link.md',
      title: 'A Link',
      frontmatter: { external_url: 'https://example.com' },
      indent: 0,
    };
    const md = buildCombinedMarkdown(
      [{ moduleTitle: 'A', moduleFolder: '01-a', items: [ext] }],
      { regime: 'flat' },
      ctx,
    );
    assert.match(md, /# A Link \{#sec-01-a-02-link\}/);
    assert.match(
      md,
      /::: \{\.link-card title="A Link" url="https:\/\/example\.com"\}/,
    );
  });

  it('renders file items as attachments using the referenced basename', () => {
    const file = {
      type: 'item',
      canvasType: 'file',
      relativePath: '01-a/03-diagram.md',
      title: 'Diagram',
      file: '03-diagram.md',
      frontmatter: { file_ref: '_files/workflow.svg' },
      indent: 0,
    };
    const md = buildCombinedMarkdown(
      [{ moduleTitle: 'A', moduleFolder: '01-a', items: [file] }],
      { regime: 'flat' },
      ctx,
    );
    assert.match(md, /::: \{\.attachment name="workflow\.svg"\}/);
  });

  // Image file items embed above their attachment block, so the export shows
  // the picture and not just the filename. Only when the binary exists: the
  // tests run against a real fixture course dir.
  describe('file item image embeds', () => {
    let fixtureCourseDir;

    before(() => {
      fixtureCourseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'assemble-'));
      fs.mkdirSync(path.join(fixtureCourseDir, '01-a', '_files'), {
        recursive: true,
      });
      for (const name of ['pic.png', 'clip.mp4', 'photo.webp']) {
        fs.writeFileSync(
          path.join(fixtureCourseDir, '01-a', '_files', name),
          'x',
        );
      }
    });

    after(() => {
      fs.rmSync(fixtureCourseDir, { recursive: true, force: true });
    });

    /** Build a file item in module 01-a referencing _files/<name>. */
    function fileItem(name) {
      return {
        type: 'item',
        canvasType: 'file',
        relativePath: '01-a/03-media.md',
        title: 'Media',
        file: '03-media.md',
        frontmatter: { file_ref: `_files/${name}` },
        indent: 0,
      };
    }

    /** Render one file item with the fixture course dir. */
    function render(name) {
      return buildCombinedMarkdown(
        [{ moduleTitle: 'A', moduleFolder: '01-a', items: [fileItem(name)] }],
        { regime: 'flat' },
        { courseDir: fixtureCourseDir, includedPaths: new Set() },
      );
    }

    it('embeds an existing image above the attachment block', () => {
      const md = render('pic.png');
      const image = md.indexOf('![](<');
      const attachment = md.indexOf('::: {.attachment name="pic.png"}');
      assert.match(md, /!\[\]\(<.*pic\.png>\)/);
      assert.ok(image !== -1 && attachment !== -1 && image < attachment);
    });

    it('renders the attachment alone when the binary is missing', () => {
      const md = render('gone.png');
      assert.doesNotMatch(md, /!\[/);
      assert.match(md, /::: \{\.attachment name="gone\.png"\}/);
    });

    it('renders the attachment alone for video', () => {
      const md = render('clip.mp4');
      assert.doesNotMatch(md, /!\[/);
      assert.match(md, /::: \{\.attachment name="clip\.mp4"\}/);
    });

    it('renders the attachment alone for formats outside the print allowlist', () => {
      const md = render('photo.webp');
      assert.doesNotMatch(md, /!\[/);
      assert.match(md, /::: \{\.attachment name="photo\.webp"\}/);
    });
  });

  // Reference items (quiz, external_tool) have no body of their own: rendering
  // them must never reach the filesystem, which `ctx` guarantees by pointing at
  // a course dir that does not exist.
  describe('reference items', () => {
    /** Build a quiz / external tool item with the given frontmatter. */
    function reference(canvasType, relativePath, title, frontmatter = {}) {
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

    /** Render one item as a single-module flat export. */
    function render(item, meta = {}, context = ctx) {
      return buildCombinedMarkdown(
        [{ moduleTitle: 'A', moduleFolder: '01-a', items: [item] }],
        { regime: 'flat', ...meta },
        context,
      );
    }

    it('renders an external tool as a link card labelled by type', () => {
      const md = render(
        reference('external_tool', '01-a/04-tool.md', 'Coding Lab', {
          external_url: 'https://lti.example.com/launch',
          new_tab: true,
        }),
      );
      assert.match(md, /# Coding Lab \{#sec-01-a-04-tool\}/);
      assert.match(
        md,
        /::: \{\.link-card title="External tool" url="https:\/\/lti\.example\.com\/launch"\}/,
      );
      assert.match(md, /\*This item is managed in Canvas\./);
    });

    it('renders a quiz as a bare type label, with no empty link card', () => {
      const md = render(
        reference('quiz', '01-a/05-test.md', 'Week 1 Test', {
          canvas_id: 77,
          quiz_ref: 'quizzes/01-week.zip',
        }),
      );
      assert.match(md, /# Week 1 Test \{#sec-01-a-05-test\}/);
      assert.match(md, /\*\*Quiz\*\*/);
      assert.doesNotMatch(md, /link-card/);
      assert.match(md, /managed in Canvas/);
    });

    it('falls back to the label when a tool has no launch URL', () => {
      const md = render(
        reference('external_tool', '01-a/04-tool.md', 'Coding Lab', {
          external_url: '   ',
        }),
      );
      assert.match(md, /\*\*External tool\*\*/);
      assert.doesNotMatch(md, /link-card/);
    });

    it('follows the document language', () => {
      const md = render(
        reference('external_tool', '01-a/04-tool.md', 'Coding Lab', {
          external_url: 'https://lti.example.com/launch',
        }),
        { lang: 'nl' },
      );
      assert.match(md, /title="Externe tool"/);
      assert.match(md, /\*Dit item wordt beheerd in Canvas\./);
    });

    it('prefers labels supplied by the caller, escaping them for the card', () => {
      const md = render(
        reference('quiz', '01-a/05-test.md', 'Week 1 Test'),
        { lang: 'nl' },
        {
          ...ctx,
          labels: {
            cards: { quiz: 'Toets' },
            reference: { notice: 'Staat in Canvas.' },
          },
        },
      );
      assert.match(md, /\*\*Toets\*\*/);
      assert.match(md, /\*Staat in Canvas\.\*/);

      const tool = render(
        reference('external_tool', '01-a/04-tool.md', 'Lab', {
          external_url: 'https://lti.example.com/launch',
        }),
        {},
        {
          ...ctx,
          labels: {
            cards: { external_tool: 'The "tool"' },
            reference: { notice: 'n' },
          },
        },
      );
      assert.match(tool, /title="The \\"tool\\""/);
    });
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
    const md = buildCombinedMarkdown(groups, { regime: 'course' }, ctx);
    assert.match(md, /## Sub Section \{#sec-01-a-02-sub\}/); // subheader at item level (H2)
    assert.match(md, /### Child \{#sec-01-a-02-sub-01-c\}/); // child one deeper (H3)
  });
});

// Every other test here hands buildCombinedMarkdown an item literal, and each
// one spells relativePath the way the scanner is supposed to. That is the one
// thing they cannot check. This one scans a real course tree and exports what
// comes back, which is the seam an image path and a cross-link are resolved
// across: `preprocess` resolves both with `path.posix` from the item's own
// relativePath, so a native separator would leave every image resolving from
// the course root and every cross-link matching nothing in `includedPaths`.
// On POSIX the two spellings coincide and this only guards the wiring; on
// Windows it is the whole defect.
describe('buildCombinedMarkdown — items straight from the scanner', () => {
  let courseDir;

  before(() => {
    courseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-assemble-scan-'));
    const mod = path.join(courseDir, '01-a');
    fs.mkdirSync(path.join(mod, '_files'), { recursive: true });
    fs.writeFileSync(path.join(mod, '_files', 'd.png'), 'binary');
    fs.writeFileSync(
      path.join(mod, '01-page.md'),
      '---\ntitle: Page\n---\n\n![Diagram](_files/d.png)\n\nSee [next](02-next.md).\n',
    );
    fs.writeFileSync(
      path.join(mod, '02-next.md'),
      '---\ntitle: Next\n---\n\nNext.\n',
    );
  });

  after(() => {
    fs.rmSync(courseDir, { recursive: true, force: true });
  });

  it('resolves images and cross-links from the item folder', () => {
    const modules = scanCourse(courseDir);
    const items = flattenItems(modules[0].items);
    const includedPaths = new Set(
      items.map((node) => toPosixPath(node.relativePath)),
    );

    const md = buildCombinedMarkdown(
      [{ moduleTitle: 'A', moduleFolder: '01-a', items: modules[0].items }],
      { regime: 'flat' },
      { courseDir, includedPaths },
    );

    assert.ok(
      md.includes(
        `![Diagram](${path.join(courseDir, '01-a', '_files', 'd.png')})`,
      ),
      `image not resolved from the item folder:\n${md}`,
    );
    assert.match(md, /See \[next\]\(#sec-01-a-02-next\)/);
  });
});
