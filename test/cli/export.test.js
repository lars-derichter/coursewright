const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  buildLinkContext,
  exportSlug,
  parseFormat,
  resolveMarkdownOutput,
  resolveMode,
} = require('../../cli/export');
const { flattenItems } = require('../../lib/convert/course-scanner');
const { getLabels } = require('../../lib/config/labels');
const { buildPlainMarkdown } = require('../../lib/export/plain-markdown');
const { rewriteCrossLinks } = require('../../lib/export/preprocess');
const { SCHEMA_VERSION } = require('../../lib/sync/state');

const CLI = path.join(__dirname, '..', '..', 'cli', 'index.js');

describe('exportSlug', () => {
  const labels = getLabels('en');

  it('slugs a course title', () => {
    assert.equal(
      exportSlug('Programming Fundamentals', labels),
      'programming-fundamentals',
    );
  });

  it('strips accents and punctuation', () => {
    assert.equal(
      exportSlug('Résumé du cours (2526)', labels),
      'resume-du-cours-2526',
    );
  });

  it('falls back to the course label when the title slugs to nothing', () => {
    // slugify keeps only [a-z0-9], so a non-Latin title has nothing to keep.
    assert.equal(exportSlug('数据结构', labels), 'course');
    assert.equal(exportSlug('🎓', getLabels('nl')), 'cursus');
  });

  it('falls back to a literal when the label is overridden to nothing', () => {
    const odd = getLabels('en', { export: { course_title: '📘' } });
    assert.equal(exportSlug('🎓', odd), 'course');
  });

  it('caps a long title without leaving a trailing hyphen', () => {
    const slug = exportSlug('word '.repeat(100), labels);
    assert.ok(slug.length <= 100, `too long: ${slug.length}`);
    assert.doesNotMatch(slug, /-$/);
  });
});

describe('parseFormat', () => {
  it('accepts md', () => {
    assert.equal(parseFormat('md'), 'md');
  });

  it('is case-insensitive', () => {
    assert.equal(parseFormat('MD'), 'md');
    assert.equal(parseFormat('Docx'), 'docx');
  });

  it('defaults to pdf when nothing was asked for', () => {
    assert.equal(parseFormat(undefined), 'pdf');
    assert.equal(parseFormat(''), 'pdf');
  });

  it('names the three formats when it refuses one', () => {
    assert.throws(() => parseFormat('epub'), /pdf, docx or md/);
  });
});

describe('resolveMarkdownOutput', () => {
  const exportsDir = path.join(os.tmpdir(), 'cw-exports-fixed');

  it('defaults to <exportsDir>/<slug>.md', () => {
    assert.equal(
      resolveMarkdownOutput('01-getting-started', {}, exportsDir),
      path.join(exportsDir, '01-getting-started.md'),
    );
  });

  it('lets -o win, resolved absolute', () => {
    assert.equal(
      resolveMarkdownOutput('toc', { output: 'pack.md' }, exportsDir),
      path.resolve('pack.md'),
    );
  });

  it('refuses to write over the TOC file it just read', () => {
    // `--toc exports/toc.md` slugs to `toc`, so the default output is the very
    // file the run read its item list from.
    assert.throws(
      () =>
        resolveMarkdownOutput(
          'toc',
          { toc: path.join(exportsDir, 'toc.md') },
          exportsDir,
        ),
      /would overwrite the TOC file/,
    );
  });

  it('refuses it however the TOC path was spelled', () => {
    const relative = path.relative(
      process.cwd(),
      path.join(exportsDir, 'toc.md'),
    );
    assert.throws(
      () => resolveMarkdownOutput('toc', { toc: relative }, exportsDir),
      /would overwrite the TOC file/,
    );
  });

  it('allows a TOC export once -o points elsewhere', () => {
    assert.equal(
      resolveMarkdownOutput(
        'toc',
        { toc: path.join(exportsDir, 'toc.md'), output: 'pack.md' },
        exportsDir,
      ),
      path.resolve('pack.md'),
    );
  });
});

describe('export label wiring', () => {
  // buildCombinedMarkdown falls back to getLabels(meta.lang) when the caller
  // passes no label set, which resolves the language but silently drops any
  // per-label override from course.config.yml. Overrides then show in the
  // preview and not in the PDF. Running the real export needs pandoc, so pin
  // the wiring at the source, as the VS Code extension tests do.
  const source = fs.readFileSync(
    path.join(__dirname, '..', '..', 'cli', 'export.js'),
    'utf8',
  );

  it('hands the resolved labels to buildCombinedMarkdown', () => {
    const call = source.slice(
      source.indexOf('buildCombinedMarkdown(mode.groups'),
    );
    const ctx = call.slice(0, call.indexOf('});'));
    assert.match(ctx, /^\s*labels,$/m);
  });

  it('hands them to buildPlainMarkdown too', () => {
    // Same drop, same symptom, in the markdown flavour: without this the pack
    // takes getLabels(meta.lang) and every per-label override is lost.
    const call = source.slice(source.indexOf('buildPlainMarkdown(mode.groups'));
    const ctx = call.slice(0, call.indexOf('});'));
    assert.match(ctx, /^\s*labels,$/m);
  });

  it('dispatches to markdown before the pandoc preflight', () => {
    // -f md needs no pandoc and no typst, so the preflight must never see it.
    const body = source.slice(source.indexOf('async function exportCmd'));
    assert.ok(
      body.indexOf('exportMarkdown(') < body.indexOf('preflight('),
      'the md dispatch has to sit above the preflight call',
    );
  });
});

describe('buildLinkContext', () => {
  // Export reads .canvas-sync.json for one thing: the Canvas id of every item,
  // so a cross-link whose target falls outside the export can be footnoted with
  // a URL instead of silently going flat. It writes nothing to Canvas.
  const BASE_URL = 'https://school.instructure.com';
  const state = (courseId) => ({
    schema_version: SCHEMA_VERSION,
    canvas_base_url: BASE_URL,
    course_id: courseId,
    last_sync: null,
    modules: {
      '01-intro': {
        canvas_module_id: 9,
        name: 'Intro',
        position: 1,
        item_order: ['01-intro/01-welcome.md'],
        items: {
          '01-intro/01-welcome.md': { canvas_type: 'page', canvas_id: 77 },
        },
      },
    },
    icons: {},
    files: {},
  });

  let dir;
  let file;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-export-'));
    file = path.join(dir, '.canvas-sync.json');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function write(data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
  }

  it('builds the link map from a matching state', () => {
    write(state(4242));
    const ctx = buildLinkContext({
      file,
      env: { CANVAS_COURSE_ID: '4242', CANVAS_API_URL: BASE_URL },
    });
    assert.equal(ctx.courseId, 4242);
    assert.deepEqual(ctx.linkMap.get('01-intro/01-welcome.md'), {
      canvasType: 'page',
      canvasId: 77,
    });
  });

  it('builds it just the same when `.env` names another course', () => {
    // loadState refuses a state describing a different Canvas course, because
    // the ids in it would let a push delete objects in the course they came
    // from. Export makes no writes, so that refusal is not its to inherit —
    // and being caught rather than skipped, it used to turn an export into one
    // with every cross-link quietly unresolved rather than either working or
    // saying anything.
    write(state(4242));
    const ctx = buildLinkContext({
      file,
      env: { CANVAS_COURSE_ID: '9999', CANVAS_API_URL: BASE_URL },
    });
    assert.ok(ctx.linkMap, 'A mismatched `.env` emptied the link map');
    assert.deepEqual(ctx.linkMap.get('01-intro/01-welcome.md'), {
      canvasType: 'page',
      canvasId: 77,
    });
  });

  it('takes the course id from the state, not the environment', () => {
    // Which id the footnote URL is built from decides whether it resolves at
    // all: `canvas_id` 77 is a page in course 4242 and means nothing in 9999,
    // so the two halves of /courses/:id/pages/:id have to come from one place.
    write(state(4242));
    const ctx = buildLinkContext({
      file,
      env: { CANVAS_COURSE_ID: '9999', CANVAS_API_URL: BASE_URL },
    });
    assert.equal(ctx.courseId, 4242);
  });

  it('hands out no course id when the state claims no course', () => {
    // `course_id: 0` is how the state spells "no course named" — emptyState
    // writes it when CANVAS_COURSE_ID is unset, and a hand-repaired file is a
    // documented way to arrive at one. Until export skipped the env check,
    // assertStateMatchesEnv stamped the environment's id on the way through and
    // this shape never reached the link map.
    write(state(0));
    const ctx = buildLinkContext({
      file,
      env: { CANVAS_COURSE_ID: '4242', CANVAS_API_URL: BASE_URL },
    });
    assert.equal(
      ctx.courseId,
      undefined,
      'A course id of 0 footnotes /courses/0/… , which resolves nowhere',
    );
    // The rows themselves are still known; it is only the course that is not.
    assert.ok(ctx.linkMap.get('01-intro/01-welcome.md'));
  });

  it('degrades to plain text rather than footnoting a course-less URL', () => {
    // The consequence the guard above exists for, through the real consumer:
    // no course id means rewriteCrossLinks unlinks the target, exactly as it
    // does for one the link map has never heard of.
    write(state(0));
    const ctx = buildLinkContext({
      file,
      env: { CANVAS_COURSE_ID: '4242', CANVAS_API_URL: BASE_URL },
    });
    const out = rewriteCrossLinks('[Welcome](01-welcome.md)', '01-intro/x.md', {
      includedPaths: new Set(),
      anchorFor: (p) => p,
      linkMap: ctx.linkMap,
      courseId: ctx.courseId,
    });
    assert.equal(out, 'Welcome');
    assert.doesNotMatch(out, /courses\/0\//);
  });

  it('still swallows a state file this version cannot read', () => {
    // What the try/catch was always for. An export is worth finishing without
    // footnotes; it is not worth failing over a schema it cannot parse.
    write({ ...state(4242), schema_version: SCHEMA_VERSION + 1 });
    assert.deepEqual(
      buildLinkContext({ file, env: { CANVAS_COURSE_ID: '4242' } }),
      {},
    );
  });

  it('returns empty context when nothing has been synced', () => {
    assert.deepEqual(
      buildLinkContext({ file, env: { CANVAS_COURSE_ID: '4242' } }),
      {},
    );
  });
});

/** A scanned page node, in the shape scanCourse returns one. */
function pageNode(relativePath, title, indent = 0) {
  return {
    type: 'item',
    canvasType: 'page',
    relativePath,
    file: path.posix.basename(relativePath),
    title,
    rawMd: `${title} body.\n`,
    frontmatter: { export: true },
    indent,
  };
}

/**
 * The index indexCourse builds, for two modules: `01-a` holds a loose page and
 * a subfolder `02-sub` with one page in it, `02-b` one loose page. Every page
 * is flagged, so `--flagged` keeps them all.
 */
function subfolderIndex() {
  const deep = pageNode('01-a/02-sub/01-deep.md', 'Deep', 1);
  const modules = [
    {
      folderName: '01-a',
      moduleName: 'A',
      items: [
        pageNode('01-a/01-loose.md', 'Loose'),
        {
          type: 'subheader',
          folderName: '02-sub',
          title: 'Sub',
          items: [deep],
        },
      ],
    },
    {
      folderName: '02-b',
      moduleName: 'B',
      items: [pageNode('02-b/01-other.md', 'Other')],
    },
  ];
  const byPath = new Map();
  for (const mod of modules) {
    for (const node of flattenItems(mod.items)) {
      if (node.type !== 'item') continue;
      byPath.set(node.relativePath, {
        item: node,
        moduleFolder: mod.folderName,
        moduleName: mod.moduleName,
      });
    }
  }
  return { index: { modules, byPath }, deep };
}

/** Every node a resolved mode will hand the builders, subheaders included. */
function nodesOf(mode) {
  return mode.groups.flatMap((g) => flattenItems(g.items));
}

describe('resolveMode with a subfolder page', () => {
  // A selection flattens the course to items and so drops the subfolder's
  // heading. The page under it used to keep its `indent: 1` all the same, and
  // came out one level deeper than its neighbours under a heading that was
  // never emitted: an H3 straight after the module's H1 in a course export.
  // `/study-pack-build` pairs pages by H2, so that page escaped its check.
  let dir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-export-mode-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function assertItemLevel(mode) {
    const nodes = nodesOf(mode);
    assert.ok(
      nodes.every((n) => n.type === 'item'),
      'A selection carries no subheader',
    );
    assert.ok(
      nodes.some((n) => n.relativePath === '01-a/02-sub/01-deep.md'),
      'The subfolder page is in the selection',
    );
    for (const n of nodes) assert.equal(n.indent, 0, n.relativePath);
  }

  it('puts a --toc selection at item level', () => {
    const { index } = subfolderIndex();
    const toc = path.join(dir, 'toc.md');
    fs.writeFileSync(
      toc,
      '- 01-a/01-loose.md\n- 01-a/02-sub/01-deep.md\n- 02-b/01-other.md\n',
      'utf8',
    );
    assertItemLevel(resolveMode([], { toc }, index));
  });

  it('puts --flagged on the whole course at item level', () => {
    const { index } = subfolderIndex();
    assertItemLevel(resolveMode([], { flagged: true }, index));
  });

  it('puts -m --flagged at item level', () => {
    const { index } = subfolderIndex();
    assertItemLevel(resolveMode([], { module: '01-a', flagged: true }, index));
  });

  it('leaves the scanned node as it was', () => {
    // byPath and the scanned modules share the node, and a whole-module export
    // later in the same process would read the indent this one zeroed.
    const { index, deep } = subfolderIndex();
    resolveMode([], { flagged: true }, index);
    resolveMode([], { module: '01-a', flagged: true }, index);
    assert.equal(deep.indent, 1);
    assert.equal(index.byPath.get('01-a/02-sub/01-deep.md').item, deep);
  });

  it('keeps the subheader and its indent in a whole-module export', () => {
    const { index } = subfolderIndex();
    const nodes = nodesOf(resolveMode([], { module: '01-a' }, index));
    assert.ok(nodes.some((n) => n.type === 'subheader' && n.title === 'Sub'));
    const deep = nodes.find((n) => n.relativePath === '01-a/02-sub/01-deep.md');
    assert.equal(deep.indent, 1);
  });

  it('renders the subfolder page as H2 in a course-regime selection', () => {
    // The symptom itself: module H1, every page H2, no H3 anywhere.
    const { index } = subfolderIndex();
    const mode = resolveMode([], { flagged: true }, index);
    assert.equal(mode.regime, 'course');
    const md = buildPlainMarkdown(
      mode.groups,
      { regime: mode.regime },
      { courseDir: dir },
    );
    assert.match(md, /^## Deep$/m);
    assert.doesNotMatch(md, /^###/m);
    assert.doesNotMatch(md, /^## Sub$/m);
  });
});

describe('npx course export -f md with a subfolder page', () => {
  // The path list resolves each argument against COURSE_DIR, a module-level
  // constant built from `process.cwd()` at require time, so it can only be
  // driven from a project of its own, in a child process, the way
  // `test/cli/move-item.test.js` does it.
  let dir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-export-md-'));
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      '{ "name": "fixture", "private": true }\n',
      'utf8',
    );
    const files = {
      '01-a/01-loose.md': 'Loose',
      '01-a/02-sub/01-deep.md': 'Deep',
      '02-b/01-other.md': 'Other',
    };
    for (const [rel, title] of Object.entries(files)) {
      const file = path.join(dir, 'course', rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(
        file,
        `---\ntitle: ${title}\nexport: true\n---\n\n${title} body.\n`,
        'utf8',
      );
    }
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function exportMd(args) {
    const out = path.join(dir, 'out.md');
    const run = spawnSync(
      process.execPath,
      [CLI, 'export', '-f', 'md', ...args, '-o', out],
      { cwd: dir, input: '', encoding: 'utf8', timeout: 30000 },
    );
    assert.equal(run.status, 0, run.stderr);
    return fs
      .readFileSync(out, 'utf8')
      .split('\n')
      .filter((line) => /^#+ /.test(line));
  }

  it('puts every page of a path list at H2 under its module', () => {
    const headings = exportMd([
      'course/01-a/01-loose.md',
      'course/01-a/02-sub/01-deep.md',
      'course/02-b/01-other.md',
    ]);
    // The document's own title line first, then module H1s and page H2s.
    assert.deepEqual(headings.slice(1), [
      '# A',
      '## Loose',
      '## Deep',
      '# B',
      '## Other',
    ]);
  });
});
