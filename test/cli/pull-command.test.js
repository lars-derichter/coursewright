const { describe, it, mock, afterEach, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { mockCanvas, silence } = require('../helpers/canvas-mock');
const log = require('../../cli/logger');

process.env.CANVAS_API_URL = 'https://canvas.example.com';
process.env.CANVAS_API_TOKEN = 'test-token-123';
process.env.CANVAS_COURSE_ID = '4242';

const pull = require('../../cli/pull');

const COURSE_ID = '4242';

// Pull asks git what it holds, and a temp course directory is in no repository
// at all. The answer is handed in so a test says the same thing wherever the
// checkout it runs in happens to be.
//
// `files` is the half of that answer without the ancestor directories `paths`
// carries, and it is what `--force` counts before it asks its question. Every
// fixture here sets both, because an answer that carried one and not the other
// would be one `gitDirtyPaths` never produces.
const CLEAN = {
  available: true,
  paths: new Set(),
  files: new Set(),
  reason: null,
};

/** What git answers where it cannot answer: every file counts as dirty. */
const NO_GIT = {
  available: false,
  paths: new Set(),
  files: new Set(),
  reason: 'the tree is not inside a git repository',
};

// The command reports its verdict through `process.exitCode` rather than
// `process.exit`, so a test can read it — and has to put it back afterwards,
// or the first run that legitimately fails would fail the whole suite.
beforeEach(() => {
  process.exitCode = 0;
});
afterEach(() => {
  mock.restoreAll();
  process.exitCode = 0;
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function tempDir(tree = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pull-cli-test-'));
  for (const [relative, contents] of Object.entries(tree)) {
    const full = path.join(dir, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents, 'utf8');
  }
  return dir;
}

/** A sync state on disk, so the command's own load/save path is exercised. */
function stateFile(state) {
  const file = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'pull-state-')),
    '.canvas-sync.json',
  );
  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        schema_version: 4,
        canvas_base_url: 'https://canvas.example.com',
        course_id: Number(COURSE_ID),
        last_sync: null,
        modules: {},
        icons: {},
        files: {},
        ...state,
      },
      null,
      2,
    ),
    'utf8',
  );
  return file;
}

const PAGE = {
  page_id: 501,
  url: 'welcome',
  title: 'Welcome',
  body: '<p>Hello there.</p>',
  updated_at: '2026-08-20T11:00:00.000Z',
};
const ITEM = {
  id: 91,
  type: 'Page',
  title: 'Welcome',
  page_url: 'welcome',
  content_id: 501,
  position: 1,
  indent: 0,
};

/** A page listing row, which is all the pre-filter reads. */
function pageRow(page) {
  return {
    page_id: page.page_id,
    url: page.url,
    title: page.title,
    updated_at: page.updated_at,
  };
}

/**
 * The reads a page-only course answers, in the order routes must be tried:
 * `/modules` is a substring of `/modules/10/items`, so the longer path first.
 *
 * `fetch` is opt-in on purpose. `GET /pages/:url` is the one request the
 * `updated_at` pre-filter exists to avoid, so a table that leaves it out is the
 * assertion that an unchanged page is never fetched: the mock answers an
 * unrouted request with a 400, which fails the run rather than passing quietly.
 */
function readRoutes({ items = [ITEM], pages = [PAGE], fetch = [] } = {}) {
  return [
    { method: 'GET', path: '/modules/10/items', body: items },
    {
      method: 'GET',
      path: '/modules',
      body: [{ id: 10, name: 'Intro', position: 1 }],
    },
    ...fetch.map((page) => ({
      method: 'GET',
      path: `/pages/${page.url}`,
      body: page,
    })),
    { method: 'GET', path: '/pages', body: pages.map(pageRow) },
  ];
}

/** The sync row a synced page has, with both fingerprints as they stand. */
function pageRowState(courseDir, itemPath, item, content) {
  const {
    hashLocalFile,
    canvasFingerprint,
  } = require('../../lib/sync/fingerprint');
  return {
    canvas_type: 'page',
    canvas_id: content.page_id,
    page_url: content.url,
    module_item_id: item.id,
    title: content.title,
    local_hash: hashLocalFile(path.join(courseDir, itemPath)),
    canvas_hash: canvasFingerprint({ item, content }, 'page'),
    canvas_updated_at: content.updated_at,
    synced_at: '2026-08-20T09:00:00.000Z',
  };
}

/**
 * A synced course: the tree, the state and the Canvas side all agreeing, which
 * is what every "does this write anything" test starts from.
 */
function syncedFixture({ localBody = 'Hello there.\n' } = {}) {
  const courseDir = tempDir({
    '01-intro/_category_.json': '{ "label": "Intro", "position": 1 }\n',
    '01-intro/01-welcome.md': `---\ntitle: Welcome\ncanvas_type: page\n---\n\n${localBody}`,
  });
  const file = stateFile({
    modules: {
      '01-intro': {
        canvas_module_id: 10,
        name: 'Intro',
        position: 1,
        item_order: ['01-intro/01-welcome.md'],
        items: {
          '01-intro/01-welcome.md': pageRowState(
            courseDir,
            '01-intro/01-welcome.md',
            ITEM,
            PAGE,
          ),
        },
      },
    },
  });
  return { courseDir, file };
}

function readState(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writes(calls) {
  return calls.filter((call) => call.method !== 'GET');
}

function printed(out) {
  return out.log.mock.calls.map((call) => call.arguments.join(' ')).join('\n');
}

function errored(out) {
  return out.error.mock.calls
    .map((call) => call.arguments.join(' '))
    .join('\n');
}

/** Everything under a directory, relative and sorted, so a tree can be compared. */
function tree(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { recursive: true })
    .map((entry) => String(entry).split(path.sep).join('/'))
    .sort();
}

function read(courseDir, relative) {
  return fs.readFileSync(path.join(courseDir, relative), 'utf8');
}

/**
 * Run `fn` with `process.stdin` replaced by a fake holding the answers, so a
 * readline prompt resolves without a terminal.
 *
 * A string is one stream for the whole run, which answers one question. **An
 * array is one stream per question**, and it has to be: `readline` drains
 * whatever it is attached to the moment it is asked, so two lines on one stream
 * both reach the first `createRL` and the second one attaches to a spent stream
 * that will never emit `'close'` — the run stops mid-question with the event
 * loop drained rather than failing. Handing each `createRL` its own stream is
 * what lets a run be asked twice, which `--force --prune-local` over a dirty
 * tree now is: once about overwriting, once about deleting.
 *
 * An array that runs out answers the rest with an empty stream, which is EOF —
 * a cancelled run and a failed assertion, rather than a hang.
 */
async function withStdin(input, fn) {
  const { Readable } = require('stream');
  const answers = Array.isArray(input) ? [...input] : null;
  const original = Object.getOwnPropertyDescriptor(process, 'stdin');
  const make = (text) => {
    const fake = Readable.from([text]);
    fake.isTTY = false;
    return fake;
  };
  Object.defineProperty(
    process,
    'stdin',
    answers
      ? { configurable: true, get: () => make(answers.shift() ?? '') }
      : { value: make(input), configurable: true },
  );
  try {
    return await fn();
  } finally {
    Object.defineProperty(process, 'stdin', original);
  }
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

describe('npx course pull', () => {
  it('writes nothing at all when the tree already matches Canvas', async () => {
    silence();
    const { courseDir, file } = syncedFixture();
    const before = read(courseDir, '01-intro/01-welcome.md');
    const calls = mockCanvas(readRoutes());

    await pull({ courseDir, syncFile: file, gitDirty: CLEAN });

    assert.deepEqual(writes(calls), [], 'a no-op pull must issue no write');
    assert.equal(
      read(courseDir, '01-intro/01-welcome.md'),
      before,
      'and must not touch the working tree either',
    );
    assert.deepEqual(tree(courseDir), [
      '01-intro',
      '01-intro/01-welcome.md',
      '01-intro/_category_.json',
    ]);
    assert.equal(process.exitCode, 0);
  });

  it('pulls a Canvas edit, and only that', async () => {
    silence();
    const { courseDir, file } = syncedFixture();
    const movedPage = {
      ...PAGE,
      body: '<p>Edited in Canvas.</p>',
      updated_at: '2026-08-20T13:00:00.000Z',
    };
    mockCanvas(readRoutes({ pages: [movedPage], fetch: [movedPage] }));

    await pull({ courseDir, syncFile: file, gitDirty: CLEAN });

    const written = read(courseDir, '01-intro/01-welcome.md');
    assert.match(written, /Edited in Canvas/);
    assert.match(written, /^title: Welcome$/m);
    assert.deepEqual(tree(courseDir), [
      '01-intro',
      '01-intro/01-welcome.md',
      '01-intro/_category_.json',
    ]);
    assert.equal(process.exitCode, 0);
  });

  it('does not report a run in sync when its only action failed', async () => {
    const out = silence();
    // The same bare-report claim `push` used to make, from the other side. The
    // module already exists on both sides, so the quiz item Canvas has gained
    // is the run's only action — and a Quiz module item carrying no content_id
    // names no quiz, so writing the reference file is refused.
    const { courseDir, file } = syncedFixture();
    mockCanvas(
      readRoutes({
        items: [
          ITEM,
          {
            id: 92,
            type: 'Quiz',
            title: 'Test 1',
            content_id: null,
            position: 2,
            indent: 0,
          },
        ],
      }),
    );

    await pull({ courseDir, syncFile: file, gitDirty: CLEAN });

    assert.deepEqual(tree(courseDir), [
      '01-intro',
      '01-intro/01-welcome.md',
      '01-intro/_category_.json',
    ]);
    assert.doesNotMatch(printed(out), /already holds everything/);
    assert.match(printed(out), /Nothing was applied\. See the errors below\./);
    assert.match(errored(out), /names no content_id/);
    assert.equal(process.exitCode, 1);
  });

  it('writes the Canvas version over a local edit rather than pushing it', async () => {
    // conflict: 'canvas' is pinned, so a page that moved on both sides comes
    // down. Push, three commits ago, resolved the same case the other way.
    silence();
    const { courseDir, file } = syncedFixture();
    fs.writeFileSync(
      path.join(courseDir, '01-intro/01-welcome.md'),
      '---\ntitle: Welcome\ncanvas_type: page\n---\n\nEdited here.\n',
      'utf8',
    );
    const movedPage = {
      ...PAGE,
      body: '<p>Edited in Canvas.</p>',
      updated_at: '2026-08-20T13:00:00.000Z',
    };
    const calls = mockCanvas(
      readRoutes({ pages: [movedPage], fetch: [movedPage] }),
    );

    await pull({ courseDir, syncFile: file, gitDirty: CLEAN });

    assert.deepEqual(writes(calls), [], 'pull never writes to Canvas');
    assert.match(read(courseDir, '01-intro/01-welcome.md'), /Edited in Canvas/);
  });

  it('leaves a local-only edit alone and says which side it left', async () => {
    const out = silence();
    const { courseDir, file } = syncedFixture();
    fs.writeFileSync(
      path.join(courseDir, '01-intro/01-welcome.md'),
      '---\ntitle: Welcome\ncanvas_type: page\n---\n\nEdited here.\n',
      'utf8',
    );
    const calls = mockCanvas(readRoutes());

    await pull({ courseDir, syncFile: file, gitDirty: CLEAN });

    assert.deepEqual(writes(calls), []);
    assert.match(
      read(courseDir, '01-intro/01-welcome.md'),
      /Edited here/,
      'the local edit is not reverted either',
    );
    assert.match(printed(out), /Left alone \(this command does not write/);
    assert.equal(process.exitCode, 0);
  });

  it('creates the module and the file on a first import', async () => {
    silence();
    const courseDir = tempDir({});
    const file = stateFile({});
    mockCanvas(readRoutes({ fetch: [PAGE] }));

    await pull({ courseDir, syncFile: file, gitDirty: CLEAN });

    assert.deepEqual(tree(courseDir), [
      '01-intro',
      '01-intro/01-welcome.md',
      '01-intro/_category_.json',
    ]);
    assert.match(read(courseDir, '01-intro/01-welcome.md'), /Hello there/);
    const state = readState(file);
    assert.equal(state.modules['01-intro'].canvas_module_id, 10);
    assert.equal(
      state.modules['01-intro'].items['01-intro/01-welcome.md'].canvas_id,
      501,
    );
  });

  it('leaves the second pull with nothing to do', async () => {
    // The invariant, and the reason it is worth its own test: the second pass
    // reasons from the state the executor actually wrote, not from one the test
    // hand-built. A fingerprint the writer records differently from the way the
    // gather recomputes it makes every run rewrite the same file for ever, and
    // a hand-built base hides it.
    silence();
    const courseDir = tempDir({});
    const file = stateFile({});
    mockCanvas(readRoutes({ fetch: [PAGE] }));
    await pull({ courseDir, syncFile: file, gitDirty: CLEAN });
    const afterFirst = read(courseDir, '01-intro/01-welcome.md');

    mock.restoreAll();
    const out = silence();
    // No `/pages/welcome` route: an unchanged page must be settled by the
    // listing alone, and no local write may be planned from it.
    const calls = mockCanvas(readRoutes());

    await pull({ courseDir, syncFile: file, gitDirty: CLEAN });

    assert.deepEqual(writes(calls), [], 'the second pull writes nothing');
    assert.equal(
      read(courseDir, '01-intro/01-welcome.md'),
      afterFirst,
      'and rewrites no file',
    );
    assert.match(printed(out), /already holds everything in Canvas/);
    assert.doesNotMatch(printed(out), /Orphaned/);
    assert.equal(process.exitCode, 0);
  });

  it('--dry-run writes nothing and reports the plan as a preview', async () => {
    const out = silence();
    const courseDir = tempDir({});
    const file = stateFile({});
    const calls = mockCanvas(readRoutes({ fetch: [PAGE] }));

    await pull({ courseDir, syncFile: file, gitDirty: CLEAN, dryRun: true });

    assert.deepEqual(writes(calls), []);
    assert.deepEqual(tree(courseDir), [], 'not one file is created');
    assert.equal(readState(file).last_sync, null, 'a dry run saves nothing');
    assert.match(printed(out), /^Would apply$/m);
    assert.doesNotMatch(printed(out), /^Applied$/m);
  });
});

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

describe('npx course pull, when a module was reordered', () => {
  const SECOND_PAGE = {
    page_id: 502,
    url: 'second',
    title: 'Second',
    body: '<p>Second page.</p>',
    updated_at: '2026-08-20T11:00:00.000Z',
  };
  const SECOND_ITEM = {
    id: 92,
    type: 'Page',
    title: 'Second',
    page_url: 'second',
    content_id: 502,
    position: 2,
    indent: 0,
  };

  /**
   * Two synced pages, with `baseOrder` naming the order the last sync recorded.
   * Local file names always run 01-welcome, 02-second; which side "moved" is
   * decided by what the base and Canvas say about that.
   */
  function twoPages(baseOrder, canvasItems) {
    const courseDir = tempDir({
      '01-intro/_category_.json': '{ "label": "Intro", "position": 1 }\n',
      '01-intro/01-welcome.md':
        '---\ntitle: Welcome\ncanvas_type: page\n---\n\nHello there.\n',
      '01-intro/02-second.md':
        '---\ntitle: Second\ncanvas_type: page\n---\n\nSecond page.\n',
    });
    const file = stateFile({
      modules: {
        '01-intro': {
          canvas_module_id: 10,
          name: 'Intro',
          position: 1,
          item_order: baseOrder,
          items: {
            '01-intro/01-welcome.md': pageRowState(
              courseDir,
              '01-intro/01-welcome.md',
              ITEM,
              PAGE,
            ),
            '01-intro/02-second.md': pageRowState(
              courseDir,
              '01-intro/02-second.md',
              SECOND_ITEM,
              SECOND_PAGE,
            ),
          },
        },
      },
    });
    return {
      courseDir,
      file,
      routes: readRoutes({
        items: canvasItems,
        pages: [PAGE, SECOND_PAGE],
      }),
    };
  }

  it('renumbers the local files when only Canvas reordered', async () => {
    // Two files swapping slots is the case a plain rename cannot do: the second
    // would land on the first. `reorderLocalModule` parks each file under a
    // temporary name before it moves any of them to its target, which is the
    // engine's own version of the dance old pull did with `__pull_temp_`.
    silence();
    const { courseDir, file, routes } = twoPages(
      ['01-intro/01-welcome.md', '01-intro/02-second.md'],
      [
        { ...SECOND_ITEM, position: 1 },
        { ...ITEM, position: 2 },
      ],
    );
    mockCanvas(routes);

    await pull({ courseDir, syncFile: file, gitDirty: CLEAN });

    assert.deepEqual(tree(courseDir), [
      '01-intro',
      '01-intro/01-second.md',
      '01-intro/02-welcome.md',
      '01-intro/_category_.json',
    ]);
    assert.match(read(courseDir, '01-intro/01-second.md'), /Second page/);
    assert.match(read(courseDir, '01-intro/02-welcome.md'), /Hello there/);
    assert.deepEqual(readState(file).modules['01-intro'].item_order, [
      '01-intro/01-second.md',
      '01-intro/02-welcome.md',
    ]);
  });

  it('leaves the pull after a reorder with nothing to do', async () => {
    // The same invariant as the first import, over the one action that renames
    // rows rather than writing files: the second pass has to recognise the
    // paths the executor re-keyed, or it plans the swap all over again.
    silence();
    const { courseDir, file, routes } = twoPages(
      ['01-intro/01-welcome.md', '01-intro/02-second.md'],
      [
        { ...SECOND_ITEM, position: 1 },
        { ...ITEM, position: 2 },
      ],
    );
    mockCanvas(routes);
    await pull({ courseDir, syncFile: file, gitDirty: CLEAN });

    mock.restoreAll();
    const out = silence();
    const calls = mockCanvas(
      readRoutes({
        items: [
          { ...SECOND_ITEM, position: 1 },
          { ...ITEM, position: 2 },
        ],
        pages: [PAGE, SECOND_PAGE],
      }),
    );

    await pull({ courseDir, syncFile: file, gitDirty: CLEAN });

    assert.deepEqual(writes(calls), []);
    assert.deepEqual(tree(courseDir), [
      '01-intro',
      '01-intro/01-second.md',
      '01-intro/02-welcome.md',
      '01-intro/_category_.json',
    ]);
    assert.match(printed(out), /already holds everything in Canvas/);
    assert.equal(process.exitCode, 0);
  });

  it('leaves the local order as it is, and reports what it did not do', async () => {
    // The mirror of push's Canvas-only reorder: pushing the local order up is a
    // Canvas write, which this command withholds. Settling it is sync's job.
    const out = silence();
    const { courseDir, file, routes } = twoPages(
      // The last sync recorded second-then-welcome, and Canvas still holds
      // that; only the local numbering says otherwise.
      ['01-intro/02-second.md', '01-intro/01-welcome.md'],
      [
        { ...SECOND_ITEM, position: 1 },
        { ...ITEM, position: 2 },
      ],
    );
    const calls = mockCanvas(routes);

    await pull({ courseDir, syncFile: file, gitDirty: CLEAN });

    assert.deepEqual(writes(calls), [], 'a reorder on one side is not a write');
    assert.deepEqual(
      tree(courseDir),
      [
        '01-intro',
        '01-intro/01-welcome.md',
        '01-intro/02-second.md',
        '01-intro/_category_.json',
      ],
      'no file is renumbered',
    );
    assert.match(
      printed(out),
      /01-intro: would have taken the local order \(only this side reordered\), but this command does not write to Canvas/,
    );
  });
});

// ---------------------------------------------------------------------------
// Adoption
// ---------------------------------------------------------------------------

describe('npx course pull, onto a tree that already holds the file', () => {
  /** The same page on both sides, with nothing in the state linking them. */
  function populated() {
    const courseDir = tempDir({
      '01-intro/_category_.json': '{ "label": "Intro", "position": 1 }\n',
      '01-intro/01-welcome.md':
        '---\ntitle: Welcome\ncanvas_type: page\n---\n\nLocal copy.\n',
    });
    return { courseDir, file: stateFile({}) };
  }

  it('claims the local file instead of writing a second one beside it', async () => {
    const out = silence();
    const { courseDir, file } = populated();
    mockCanvas(readRoutes({ fetch: [PAGE] }));

    await pull({ courseDir, syncFile: file, gitDirty: CLEAN });

    assert.deepEqual(
      tree(courseDir),
      ['01-intro', '01-intro/01-welcome.md', '01-intro/_category_.json'],
      'no second copy of the page is created',
    );
    assert.match(read(courseDir, '01-intro/01-welcome.md'), /Hello there/);
    assert.match(printed(out), /Adopted \(matched to something already/);
    assert.match(printed(out), /01-intro\/01-welcome\.md: page "Welcome"/);

    const row =
      readState(file).modules['01-intro'].items['01-intro/01-welcome.md'];
    assert.equal(row.canvas_id, 501, 'the row now names the Canvas page');
    assert.equal(row.module_item_id, 91);
  });

  it('leaves the pull that follows an adoption with nothing to do', async () => {
    silence();
    const { courseDir, file } = populated();
    mockCanvas(readRoutes({ fetch: [PAGE] }));
    await pull({ courseDir, syncFile: file, gitDirty: CLEAN });

    assert.equal(
      readState(file).modules['01-intro'].canvas_module_id,
      10,
      'the first pull has to leave the folder linked to its Canvas module',
    );

    mock.restoreAll();
    const out = silence();
    const calls = mockCanvas(readRoutes());
    await pull({ courseDir, syncFile: file, gitDirty: CLEAN });

    assert.deepEqual(writes(calls), [], 'the second pull writes nothing');
    assert.doesNotMatch(printed(out), /Orphaned/);
    assert.equal(process.exitCode, 0);
  });
});

// ---------------------------------------------------------------------------
// The git guard, and --force
// ---------------------------------------------------------------------------

describe('npx course pull, over uncommitted work', () => {
  /** A synced course whose page Canvas has since edited. */
  function canvasMovedOn() {
    const fixture = syncedFixture();
    const movedPage = {
      ...PAGE,
      body: '<p>Edited in Canvas.</p>',
      updated_at: '2026-08-20T13:00:00.000Z',
    };
    return {
      ...fixture,
      routes: readRoutes({ pages: [movedPage], fetch: [movedPage] }),
    };
  }

  const DIRTY = {
    available: true,
    paths: new Set(['01-intro/01-welcome.md']),
    files: new Set(['01-intro/01-welcome.md']),
    reason: null,
  };

  // The same rule, for the one write the planner cannot guard: the binary
  // behind an embedded image. Its destination is the Canvas file's
  // `display_name` under the module's `_files/`, which is not known until
  // Canvas has answered, and `_files/` is a folder the course scanner never
  // descends into — so no item's `dirty` speaks for it and the git answer has
  // to reach the executor itself.
  const EMBED_FILE_ID = 777;
  const EMBEDDED_REF = '01-intro/_files/diagram.png';

  /** What `gitDirtyPaths` returns for that binary alone: ancestors included. */
  const DIRTY_BINARY = {
    available: true,
    paths: new Set(['01-intro', '01-intro/_files', EMBEDDED_REF]),
    // Git named one path; the other two are ancestors this added.
    files: new Set([EMBEDDED_REF]),
    reason: null,
  };

  /** A synced course whose Canvas page now embeds an image the tree collides with. */
  function canvasEmbedsAnImage() {
    const fixture = syncedFixture();
    const destination = path.join(fixture.courseDir, EMBEDDED_REF);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, 'MY-OWN-DIAGRAM', 'utf8');

    const embedding = {
      ...PAGE,
      body: `<p><img src="/courses/${COURSE_ID}/files/${EMBED_FILE_ID}/preview" alt="Diagram"></p>`,
      updated_at: '2026-08-20T13:00:00.000Z',
    };
    const meta = {
      id: EMBED_FILE_ID,
      display_name: 'diagram.png',
      url: `https://files.example.com/blob/${EMBED_FILE_ID}`,
    };
    return {
      ...fixture,
      routes: [
        ...readRoutes({ pages: [embedding], fetch: [embedding] }),
        // Two metadata reads: one to name the destination, one inside
        // `downloadFile` to find the bytes. Then the bytes.
        { method: 'GET', path: `/api/v1/files/${EMBED_FILE_ID}`, body: meta },
        { method: 'GET', path: `/api/v1/files/${EMBED_FILE_ID}`, body: meta },
        {
          method: 'GET',
          path: `/blob/${EMBED_FILE_ID}`,
          body: 'CANVAS-DIAGRAM',
        },
      ],
    };
  }

  it('refuses to download over an untracked binary in _files/', async () => {
    const out = silence();
    const { courseDir, file, routes } = canvasEmbedsAnImage();
    mockCanvas(routes);

    await pull({ courseDir, syncFile: file, gitDirty: DIRTY_BINARY });

    assert.equal(
      read(courseDir, EMBEDDED_REF),
      'MY-OWN-DIAGRAM',
      'an untracked image is the case where the local copy is the only copy',
    );
    assert.match(printed(out), /Skipped/);
    assert.match(printed(out), /_files\/diagram\.png \(git-dirty\)/);
    assert.match(printed(out), /Commit or stash/);
    assert.equal(process.exitCode, 1, 'a refusal the author must act on');

    // The page is still written — only the download was refused — and it points
    // at Canvas rather than at a local binary that is not what Canvas shows.
    const markdown = read(courseDir, '01-intro/01-welcome.md');
    assert.match(markdown, /\/courses\/4242\/files\/777\/preview/);
    assert.doesNotMatch(markdown, /_files\/diagram\.png/);

    // And no row claiming the file id, or a hash, for bytes never written.
    assert.deepEqual(readState(file).files, {});
  });

  it('--force downloads over it, and records the row', async () => {
    // Behind `withStdin` because the question is asked: `confirmForcedPull`
    // counts what git named, and git named this binary even though the scanner
    // never sees it.
    silence();
    const { courseDir, file, routes } = canvasEmbedsAnImage();
    mockCanvas(routes);

    await withStdin('y\n', () =>
      pull({ courseDir, syncFile: file, gitDirty: DIRTY_BINARY, force: true }),
    );

    assert.equal(read(courseDir, EMBEDDED_REF), 'CANVAS-DIAGRAM');
    assert.match(read(courseDir, '01-intro/01-welcome.md'), /_files\/diagram/);
    assert.equal(
      readState(file).files[EMBEDDED_REF].canvas_file_id,
      EMBED_FILE_ID,
    );
    assert.equal(process.exitCode, 0);
  });

  it('refuses to write over a file holding uncommitted work', async () => {
    const out = silence();
    const { courseDir, file, routes } = canvasMovedOn();
    mockCanvas(routes);

    await pull({ courseDir, syncFile: file, gitDirty: DIRTY });

    assert.match(read(courseDir, '01-intro/01-welcome.md'), /Hello there/);
    assert.match(printed(out), /Skipped/);
    assert.match(printed(out), /git-dirty/);
    assert.match(printed(out), /Commit or stash/);
    assert.equal(process.exitCode, 1, 'a refusal the author must act on');
  });

  it('--force writes over it, once the question is answered', async () => {
    silence();
    const { courseDir, file, routes } = canvasMovedOn();
    mockCanvas(routes);

    await withStdin('y\n', () =>
      pull({ courseDir, syncFile: file, gitDirty: DIRTY, force: true }),
    );

    assert.match(read(courseDir, '01-intro/01-welcome.md'), /Edited in Canvas/);
    assert.equal(process.exitCode, 0);
  });

  it('--force asks before it reads Canvas at all, and a no costs nothing', async () => {
    const out = silence();
    const { courseDir, file, routes } = canvasMovedOn();
    const calls = mockCanvas(routes);

    await withStdin('n\n', () =>
      pull({ courseDir, syncFile: file, gitDirty: DIRTY, force: true }),
    );

    assert.deepEqual(calls, [], 'a cancelled run must not read the course');
    assert.match(read(courseDir, '01-intro/01-welcome.md'), /Hello there/);
    assert.match(printed(out), /Cancelled/);
    assert.equal(
      process.exitCode,
      1,
      'a pull that pulled nothing must not report success to its caller',
    );
  });

  it('--dry-run --force previews without asking', async () => {
    // No stdin behind this: a preview that stopped for permission would hang
    // the test, and would strand a scripted run with no terminal to answer it.
    const out = silence();
    const { courseDir, file, routes } = canvasMovedOn();
    mockCanvas(routes);

    await pull({
      courseDir,
      syncFile: file,
      gitDirty: DIRTY,
      force: true,
      dryRun: true,
    });

    assert.match(read(courseDir, '01-intro/01-welcome.md'), /Hello there/);
    assert.match(printed(out), /^Would apply$/m);
    assert.doesNotMatch(printed(out), /Skipped/);
  });

  it('does not ask when --force has nothing to force', async () => {
    // No stdin behind this: a question here would hang the test rather than
    // fail it, which is the point — a clean tree keeps `pull --force`
    // scriptable.
    silence();
    const { courseDir, file, routes } = canvasMovedOn();
    mockCanvas(routes);

    await pull({ courseDir, syncFile: file, gitDirty: CLEAN, force: true });

    assert.match(read(courseDir, '01-intro/01-welcome.md'), /Edited in Canvas/);
  });

  it('writes nothing outside a git checkout, and says --force is the way in', async () => {
    const out = silence();
    const { courseDir, file, routes } = canvasMovedOn();
    mockCanvas(routes);

    await pull({ courseDir, syncFile: file, gitDirty: NO_GIT });

    assert.match(read(courseDir, '01-intro/01-welcome.md'), /Hello there/);
    const warned = out.warn.mock.calls
      .map((call) => call.arguments.join(' '))
      .join('\n');
    assert.match(warned, /not inside a git repository/);
    assert.match(warned, /--force overrides that/);
    assert.equal(process.exitCode, 1);
  });

  it('still says why it wrote nothing under --quiet', async () => {
    // `--quiet` silences chatter, and the git guard is not chatter: it is the
    // reason this run wrote nothing at all. On `log.warn` the whole of a
    // `pull --quiet` outside a checkout was a silent non-zero exit — no line
    // anywhere naming the guard that stopped it — which is exactly the state a
    // scheduled job reads as "there was nothing to pull".
    const out = silence();
    const { courseDir, file, routes } = canvasMovedOn();
    mockCanvas(routes);

    log.configure({ quiet: true });
    try {
      await pull({ courseDir, syncFile: file, gitDirty: NO_GIT });
    } finally {
      log.configure({ quiet: false });
    }

    const warned = out.warn.mock.calls
      .map((call) => call.arguments.join(' '))
      .join('\n');
    assert.match(warned, /not inside a git repository/);
    assert.match(warned, /--force overrides that/);
    assert.match(read(courseDir, '01-intro/01-welcome.md'), /Hello there/);
  });

  it('--force is what makes a pull outside a git checkout write anything', async () => {
    silence();
    const { courseDir, file, routes } = canvasMovedOn();
    mockCanvas(routes);

    await withStdin('y\n', () =>
      pull({ courseDir, syncFile: file, gitDirty: NO_GIT, force: true }),
    );

    assert.match(read(courseDir, '01-intro/01-welcome.md'), /Edited in Canvas/);
    assert.equal(process.exitCode, 0);
  });

  // -------------------------------------------------------------------------
  // The module label, which lives in a file no item stands for
  // -------------------------------------------------------------------------

  /** A synced course whose Canvas module has been renamed since. */
  function canvasRenamedTheModule() {
    const fixture = syncedFixture();
    return {
      ...fixture,
      routes: [
        { method: 'GET', path: '/modules/10/items', body: [ITEM] },
        {
          method: 'GET',
          path: '/modules',
          body: [{ id: 10, name: 'Renamed In Canvas', position: 1 }],
        },
        { method: 'GET', path: '/pages', body: [pageRow(PAGE)] },
      ],
    };
  }

  /** What `gitDirtyPaths` returns for an edited `_category_.json`. */
  const DIRTY_CATEGORY = {
    available: true,
    paths: new Set(['01-intro', '01-intro/_category_.json']),
    files: new Set(['01-intro/_category_.json']),
    reason: null,
  };

  it('refuses to write the Canvas label over an uncommitted _category_.json', async () => {
    const out = silence();
    const { courseDir, file, routes } = canvasRenamedTheModule();
    mockCanvas(routes);

    await pull({ courseDir, syncFile: file, gitDirty: DIRTY_CATEGORY });

    assert.match(read(courseDir, '01-intro/_category_.json'), /"Intro"/);
    // A module-level skip is filed under the folder; the remedy is what names
    // the one file it is about.
    assert.match(printed(out), /01-intro \(git-dirty\).*_category_\.json/);
    assert.match(printed(out), /Commit or stash/);
    assert.equal(process.exitCode, 1, 'a refusal the author must act on');
  });

  it('writes it when that file is clean, dirty lesson beside it and all', async () => {
    // The fence in the shape that matters: `gitDirtyPaths` adds every ancestor,
    // so `01-intro` reads dirty for the lesson under it. A guard reading the
    // folder instead of the file would refuse every relabel from here on, and
    // the refusal above would pass just as well.
    silence();
    const { courseDir, file, routes } = canvasRenamedTheModule();
    mockCanvas(routes);

    await pull({
      courseDir,
      syncFile: file,
      gitDirty: {
        available: true,
        paths: new Set(['01-intro', '01-intro/01-welcome.md']),
        files: new Set(['01-intro/01-welcome.md']),
        reason: null,
      },
    });

    assert.match(
      read(courseDir, '01-intro/_category_.json'),
      /"Renamed In Canvas"/,
    );
    assert.equal(readState(file).modules['01-intro'].name, 'Renamed In Canvas');
  });

  it('--force takes the Canvas label over it, once asked', async () => {
    silence();
    const { courseDir, file, routes } = canvasRenamedTheModule();
    mockCanvas(routes);

    await withStdin('y\n', () =>
      pull({
        courseDir,
        syncFile: file,
        gitDirty: DIRTY_CATEGORY,
        force: true,
      }),
    );

    assert.match(
      read(courseDir, '01-intro/_category_.json'),
      /"Renamed In Canvas"/,
    );
    assert.equal(process.exitCode, 0);
  });

  it('keeps the folder’s own slot when it writes the label', async () => {
    // `writeCategoryFile` rewrites `position` whatever it is handed, so the
    // number has to come from the folder. Taken from the state row it was a
    // record of the last run, and a row with no `position` wrote `0`.
    silence();
    const { courseDir, routes } = canvasRenamedTheModule();
    const file = stateFile({
      modules: {
        '01-intro': {
          canvas_module_id: 10,
          name: 'Intro',
          item_order: ['01-intro/01-welcome.md'],
          items: {
            '01-intro/01-welcome.md': pageRowState(
              courseDir,
              '01-intro/01-welcome.md',
              ITEM,
              PAGE,
            ),
          },
        },
      },
    });
    mockCanvas(routes);

    // Pull already pins `conflict: 'canvas'`, which is what settles the clash
    // between the folder's slot and the row that does not name one.
    await pull({ courseDir, syncFile: file, gitDirty: CLEAN });

    const category = JSON.parse(read(courseDir, '01-intro/_category_.json'));
    assert.equal(category.label, 'Renamed In Canvas');
    assert.equal(category.position, 1, 'the folder is 01-, not 00-');
  });

  // -------------------------------------------------------------------------
  // What --force counts before it asks
  // -------------------------------------------------------------------------

  it('asks before --force overrides a tree dirty only under _files/', async () => {
    // The count used to be of scanned items, and `scanCourse` never descends
    // into a `_`-prefixed folder — so a tree whose only uncommitted work was a
    // binary counted zero, and `--force` overrode all three guards with no
    // question at all. Answering no is what proves the question was asked: an
    // unanswered one would have hung, and an unasked one would have pulled.
    const out = silence();
    const { courseDir, file, routes } = canvasEmbedsAnImage();
    const calls = mockCanvas(routes);

    await withStdin('n\n', () =>
      pull({ courseDir, syncFile: file, gitDirty: DIRTY_BINARY, force: true }),
    );

    assert.deepEqual(calls, [], 'a cancelled run must not read the course');
    assert.equal(read(courseDir, EMBEDDED_REF), 'MY-OWN-DIAGRAM');
    assert.match(printed(out), /--force: 1 local file/);
    assert.match(printed(out), /Cancelled/);
    assert.equal(process.exitCode, 1);
  });

  it('counts the files git named, not the directories on the way to them', async () => {
    // `gitDirtyPaths` adds every ancestor of a dirty path so a folder can be
    // asked the same question as a file; counting those would quote a number
    // three times the truth in the sentence the author is asked to agree to.
    const out = silence();
    const { courseDir, file, routes } = canvasEmbedsAnImage();
    mockCanvas(routes);

    await withStdin('n\n', () =>
      pull({ courseDir, syncFile: file, gitDirty: DIRTY_BINARY, force: true }),
    );

    assert.doesNotMatch(printed(out), /3 local files/);
    assert.equal(DIRTY_BINARY.paths.size, 3, 'the ancestors are still there');
  });

  it('counts the scanned items where git could not answer at all', async () => {
    // The one branch that must not read the file set: `available: false`
    // carries an empty one, so counting it would be counting zero and the
    // question would vanish for the run that most needs it.
    const out = silence();
    const { courseDir, file, routes } = canvasMovedOn();
    mockCanvas(routes);

    await withStdin('n\n', () =>
      pull({ courseDir, syncFile: file, gitDirty: NO_GIT, force: true }),
    );

    // "the 1 local file", not "all 1 local file": the sentence agrees with the
    // count it quotes. What this test is about is the count itself, and one is
    // still what a course of one item comes to here.
    assert.match(printed(out), /the 1 local file under course\//);
    assert.match(printed(out), /Cancelled/);
  });
});

// ---------------------------------------------------------------------------
// --prune-local
// ---------------------------------------------------------------------------

describe('npx course pull --prune-local', () => {
  /** A synced course whose second page is gone from Canvas but still here. */
  function orphaned() {
    const courseDir = tempDir({
      '01-intro/_category_.json': '{ "label": "Intro", "position": 1 }\n',
      '01-intro/01-welcome.md':
        '---\ntitle: Welcome\ncanvas_type: page\n---\n\nHello there.\n',
      '01-intro/02-gone.md':
        '---\ntitle: Gone\ncanvas_type: page\n---\n\nGone from Canvas.\n',
    });
    const { hashLocalFile } = require('../../lib/sync/fingerprint');
    const file = stateFile({
      modules: {
        '01-intro': {
          canvas_module_id: 10,
          name: 'Intro',
          position: 1,
          item_order: ['01-intro/01-welcome.md', '01-intro/02-gone.md'],
          items: {
            '01-intro/01-welcome.md': pageRowState(
              courseDir,
              '01-intro/01-welcome.md',
              ITEM,
              PAGE,
            ),
            '01-intro/02-gone.md': {
              canvas_type: 'page',
              canvas_id: 502,
              page_url: 'gone',
              module_item_id: 92,
              title: 'Gone',
              local_hash: hashLocalFile(
                path.join(courseDir, '01-intro/02-gone.md'),
              ),
              canvas_hash: 'stored-gone-hash',
              canvas_updated_at: '2026-08-20T11:00:00.000Z',
              synced_at: '2026-08-20T09:00:00.000Z',
            },
          },
        },
      },
    });
    return { courseDir, file, routes: readRoutes() };
  }

  it('names the orphan and deletes nothing without the flag', async () => {
    const out = silence();
    const { courseDir, file, routes } = orphaned();
    mockCanvas(routes);

    await pull({ courseDir, syncFile: file, gitDirty: CLEAN });

    assert.ok(fs.existsSync(path.join(courseDir, '01-intro/02-gone.md')));
    assert.match(printed(out), /Orphaned locally/);
    assert.match(printed(out), /`--prune-local` is what deletes these/);
    // A course mid-edit is not a failure.
    assert.equal(process.exitCode, 0);
    assert.ok(readState(file).modules['01-intro'].items['01-intro/02-gone.md']);
  });

  it('deletes only the orphan, once the question is answered', async () => {
    silence();
    const { courseDir, file, routes } = orphaned();
    const calls = mockCanvas(routes);

    await withStdin('y\n', () =>
      pull({
        courseDir,
        syncFile: file,
        gitDirty: CLEAN,
        interactive: true,
        pruneLocal: true,
      }),
    );

    assert.deepEqual(writes(calls), [], 'a local delete is not a Canvas write');
    assert.deepEqual(tree(courseDir), [
      '01-intro',
      '01-intro/01-welcome.md',
      '01-intro/_category_.json',
    ]);
    const state = readState(file);
    assert.equal(
      state.modules['01-intro'].items['01-intro/02-gone.md'],
      undefined,
    );
    assert.ok(state.modules['01-intro'].items['01-intro/01-welcome.md']);
  });

  it('deletes nothing when the question is answered no', async () => {
    const out = silence();
    const { courseDir, file, routes } = orphaned();
    mockCanvas(routes);

    await withStdin('n\n', () =>
      pull({
        courseDir,
        syncFile: file,
        gitDirty: CLEAN,
        interactive: true,
        pruneLocal: true,
      }),
    );

    assert.ok(fs.existsSync(path.join(courseDir, '01-intro/02-gone.md')));
    // Re-planned without the prune, so the orphan is listed as an orphan again
    // rather than as something the run claims to have deleted.
    assert.match(printed(out), /Orphaned locally/);
    assert.match(printed(out), /`--prune-local` is what deletes these/);
  });

  it('deletes nothing when it cannot ask', async () => {
    const out = silence();
    const { courseDir, file, routes } = orphaned();
    mockCanvas(routes);

    await pull({
      courseDir,
      syncFile: file,
      gitDirty: CLEAN,
      interactive: false,
      pruneLocal: true,
    });

    assert.ok(fs.existsSync(path.join(courseDir, '01-intro/02-gone.md')));
    assert.match(printed(out), /Orphaned locally/);
  });

  it('lists what it would delete on a dry run, and asks nothing', async () => {
    const out = silence();
    const { courseDir, file, routes } = orphaned();
    mockCanvas(routes);

    // No stdin behind this: a dry run that asked would hang the test.
    await pull({
      courseDir,
      syncFile: file,
      gitDirty: CLEAN,
      interactive: true,
      pruneLocal: true,
      dryRun: true,
    });

    assert.ok(fs.existsSync(path.join(courseDir, '01-intro/02-gone.md')));
    assert.match(printed(out), /01-intro\/02-gone\.md \(page\)/);
    assert.match(printed(out), /^Would apply$/m);
  });

  it('says the git guard is off when --force is on', async () => {
    // A clean tree, so `--force` holds nothing back and only the prune asks:
    // two prompts on one fake stdin cannot both be answered, and this branch is
    // about what the flag disabled rather than about what it found.
    const out = silence();
    const { courseDir, file, routes } = orphaned();
    mockCanvas(routes);

    await withStdin('y\n', () =>
      pull({
        courseDir,
        syncFile: file,
        gitDirty: CLEAN,
        interactive: true,
        pruneLocal: true,
        force: true,
      }),
    );

    assert.match(printed(out), /--force is on, so the git guard is not/);
    assert.ok(!fs.existsSync(path.join(courseDir, '01-intro/02-gone.md')));
  });

  it('refuses to delete a file holding uncommitted work', async () => {
    const out = silence();
    const { courseDir, file, routes } = orphaned();
    mockCanvas(routes);

    await withStdin('y\n', () =>
      pull({
        courseDir,
        syncFile: file,
        gitDirty: {
          available: true,
          paths: new Set(['01-intro/02-gone.md']),
          files: new Set(['01-intro/02-gone.md']),
          reason: null,
        },
        interactive: true,
        pruneLocal: true,
      }),
    );

    assert.ok(
      fs.existsSync(path.join(courseDir, '01-intro/02-gone.md')),
      'the git guard is the last thing between the file and its deletion',
    );
    assert.match(printed(out), /git-dirty/);
    assert.equal(process.exitCode, 1);
  });

  // -------------------------------------------------------------------------
  // A whole module folder, and the files under it no item can speak for
  // -------------------------------------------------------------------------

  /**
   * A second local module that Canvas no longer holds, with an untracked
   * binary in its `_files/`.
   *
   * `delete-local-module` is a recursive `rmSync` over the folder, and the
   * guard between it and this image used to be `localModule.items.some(dirty)`
   * — which can only ever see what `scanCourse` returned, and the scanner skips
   * every `_`-prefixed folder. So the folder's one piece of uncommitted work
   * was invisible, the module was pruned with nothing skipped, and the image
   * went with it.
   */
  function orphanedModule() {
    const courseDir = tempDir({
      '01-intro/_category_.json': '{ "label": "Intro", "position": 1 }\n',
      '01-intro/01-welcome.md':
        '---\ntitle: Welcome\ncanvas_type: page\n---\n\nHello there.\n',
      '02-loops/_category_.json': '{ "label": "Loops", "position": 2 }\n',
      '02-loops/01-while.md':
        '---\ntitle: While\ncanvas_type: page\n---\n\nRound and round.\n',
      '02-loops/_files/diagram.png': 'MY-ONLY-COPY',
    });
    const { hashLocalFile } = require('../../lib/sync/fingerprint');
    const file = stateFile({
      modules: {
        '01-intro': {
          canvas_module_id: 10,
          name: 'Intro',
          position: 1,
          item_order: ['01-intro/01-welcome.md'],
          items: {
            '01-intro/01-welcome.md': pageRowState(
              courseDir,
              '01-intro/01-welcome.md',
              ITEM,
              PAGE,
            ),
          },
        },
        '02-loops': {
          canvas_module_id: 20,
          name: 'Loops',
          position: 2,
          item_order: ['02-loops/01-while.md'],
          items: {
            '02-loops/01-while.md': {
              canvas_type: 'page',
              canvas_id: 601,
              page_url: 'while',
              module_item_id: 93,
              title: 'While',
              local_hash: hashLocalFile(
                path.join(courseDir, '02-loops/01-while.md'),
              ),
              canvas_hash: 'stored-while-hash',
              canvas_updated_at: '2026-08-20T11:00:00.000Z',
              synced_at: '2026-08-20T09:00:00.000Z',
            },
          },
        },
      },
    });
    return { courseDir, file, routes: readRoutes() };
  }

  /** What `gitDirtyPaths` returns for that binary: the path and its ancestors. */
  const DIRTY_ONLY_IN_FILES = {
    available: true,
    paths: new Set([
      '02-loops',
      '02-loops/_files',
      '02-loops/_files/diagram.png',
    ]),
    files: new Set(['02-loops/_files/diagram.png']),
    reason: null,
  };

  it('deletes a whole orphaned module when nothing in it is dirty', async () => {
    // The fence, first: the folder guard must not become a wall. Without this
    // the refusal below would pass just as well against a guard that never let
    // any module be deleted again.
    silence();
    const { courseDir, file, routes } = orphanedModule();
    mockCanvas(routes);

    await withStdin('y\n', () =>
      pull({
        courseDir,
        syncFile: file,
        gitDirty: CLEAN,
        interactive: true,
        pruneLocal: true,
      }),
    );

    assert.deepEqual(tree(courseDir), [
      '01-intro',
      '01-intro/01-welcome.md',
      '01-intro/_category_.json',
    ]);
    assert.equal(readState(file).modules['02-loops'], undefined);
  });

  it('refuses to delete a module folder over an untracked _files/ binary', async () => {
    const out = silence();
    const { courseDir, file, routes } = orphanedModule();
    mockCanvas(routes);

    await withStdin('y\n', () =>
      pull({
        courseDir,
        syncFile: file,
        gitDirty: DIRTY_ONLY_IN_FILES,
        interactive: true,
        pruneLocal: true,
      }),
    );

    assert.equal(
      read(courseDir, '02-loops/_files/diagram.png'),
      'MY-ONLY-COPY',
      'an untracked image is the case where the local copy is the only copy',
    );
    assert.ok(fs.existsSync(path.join(courseDir, '02-loops/01-while.md')));
    assert.match(printed(out), /02-loops \(git-dirty\)/);
    assert.match(printed(out), /Commit or stash/);
    assert.equal(process.exitCode, 1, 'a refusal the author must act on');
    assert.ok(
      readState(file).modules['02-loops'],
      'the module row is what makes the next run ask again',
    );
  });

  it('--force deletes that folder anyway, image and all', async () => {
    // `--force` is one lever, not two: the flag that lets a pull overwrite an
    // uncommitted file lets `--prune-local` delete one. It clears the module
    // flag as well as the item flags, or it would half work — files
    // overwritten, folders spared.
    //
    // Two answers, because this run is asked twice: `--force` names the one
    // dirty file it is about to override, then the prune names what it is about
    // to delete. It used to be asked only the second — the count behind the
    // first was of scanned items, and the one dirty thing here is a `_files/`
    // binary that is not one.
    silence();
    const { courseDir, file, routes } = orphanedModule();
    mockCanvas(routes);

    await withStdin(['y\n', 'y\n'], () =>
      pull({
        courseDir,
        syncFile: file,
        gitDirty: DIRTY_ONLY_IN_FILES,
        interactive: true,
        pruneLocal: true,
        force: true,
      }),
    );

    assert.deepEqual(tree(courseDir), [
      '01-intro',
      '01-intro/01-welcome.md',
      '01-intro/_category_.json',
    ]);
    assert.equal(readState(file).modules['02-loops'], undefined);
  });
});

// ---------------------------------------------------------------------------
// The flag surface
// ---------------------------------------------------------------------------

describe('npx course pull: the flags', () => {
  const SECOND_ITEM = {
    id: 93,
    type: 'Page',
    title: 'More',
    page_url: 'more',
    content_id: 601,
    position: 1,
    indent: 0,
  };
  const SECOND_PAGE = {
    page_id: 601,
    url: 'more',
    title: 'More',
    body: '<p>More of it.</p>',
    updated_at: '2026-08-20T11:00:00.000Z',
  };

  /** Two Canvas modules, neither of which exists locally yet. */
  function twoModules() {
    return [
      { method: 'GET', path: '/modules/10/items', body: [ITEM] },
      { method: 'GET', path: '/modules/20/items', body: [SECOND_ITEM] },
      {
        method: 'GET',
        path: '/modules',
        body: [
          { id: 10, name: 'Intro', position: 1 },
          { id: 20, name: 'Later', position: 2 },
        ],
      },
      { method: 'GET', path: '/pages/welcome', body: PAGE },
      { method: 'GET', path: '/pages/more', body: SECOND_PAGE },
      {
        method: 'GET',
        path: '/pages',
        body: [pageRow(PAGE), pageRow(SECOND_PAGE)],
      },
    ];
  }

  for (const [how, selector] of [
    ['by folder name', '01-intro'],
    ['by number', '01'],
  ]) {
    it(`-m confines the run to the module named (${how})`, async () => {
      silence();
      const courseDir = tempDir({});
      const file = stateFile({});
      mockCanvas(twoModules());

      await pull({
        courseDir,
        syncFile: file,
        gitDirty: CLEAN,
        module: selector,
      });

      assert.deepEqual(
        tree(courseDir),
        ['01-intro', '01-intro/01-welcome.md', '01-intro/_category_.json'],
        'the module that was not named must not be written',
      );
    });
  }

  it('refuses a module name neither side answers to', async () => {
    const out = silence();
    const { courseDir, file } = syncedFixture();
    mockCanvas(readRoutes());

    await pull({
      courseDir,
      syncFile: file,
      gitDirty: CLEAN,
      module: '99-nope',
    });

    assert.equal(process.exitCode, 1);
    assert.match(errored(out), /no module named 99-nope/);
  });

  it('refuses a number neither side answers to', async () => {
    const out = silence();
    const { courseDir, file } = syncedFixture();
    mockCanvas(readRoutes());

    await pull({
      courseDir,
      syncFile: file,
      gitDirty: CLEAN,
      module: '09',
    });

    assert.equal(process.exitCode, 1);
    assert.match(errored(out), /\[pull\] Error: Module not found: 09/);
  });

  it('scopes the run to a module deleted here, by its number in the state', async () => {
    const out = silence();
    const { courseDir, file } = syncedFixture();
    fs.rmSync(path.join(courseDir, '01-intro'), { recursive: true });
    // Canvas renamed it meanwhile, so only the state can tie 01 to 01-intro.
    mockCanvas(
      readRoutes().map((route) =>
        route.path === '/modules'
          ? { ...route, body: [{ id: 10, name: 'Welcome', position: 1 }] }
          : route,
      ),
    );

    await pull({
      courseDir,
      syncFile: file,
      gitDirty: CLEAN,
      module: '1',
    });

    assert.doesNotMatch(errored(out), /Module not found|no module named/);
    assert.equal(process.exitCode, 0);
    assert.match(
      printed(out),
      /01-intro: module "Welcome"/,
      'the orphan is in scope, so 1 reached the planner as 01-intro',
    );
  });

  for (const [how, selector] of [
    ['by folder name', '02-later'],
    ['by number', '02'],
  ]) {
    it(`accepts a module name only Canvas knows yet (${how})`, async () => {
      silence();
      const courseDir = tempDir({});
      const file = stateFile({});
      mockCanvas(twoModules());

      await pull({
        courseDir,
        syncFile: file,
        gitDirty: CLEAN,
        module: selector,
      });

      assert.equal(process.exitCode, 0);
      assert.deepEqual(tree(courseDir), [
        '02-later',
        '02-later/01-more.md',
        '02-later/_category_.json',
      ]);
    });
  }

  it('says so and stops when the Canvas course holds no modules', async () => {
    const out = silence();
    const { courseDir, file } = syncedFixture();
    const before = tree(courseDir);
    mockCanvas([{ method: 'GET', path: '/modules', body: [] }]);

    await pull({
      courseDir,
      syncFile: file,
      gitDirty: CLEAN,
      pruneLocal: true,
    });

    assert.deepEqual(
      tree(courseDir),
      before,
      'an empty course deletes nothing',
    );
    assert.equal(process.exitCode, 0);
    assert.match(printed(out), /No modules found in Canvas course/);
  });

  it('fails when no course id is configured', async () => {
    const out = silence();
    const original = process.env.CANVAS_COURSE_ID;
    delete process.env.CANVAS_COURSE_ID;
    try {
      await pull({});
    } finally {
      process.env.CANVAS_COURSE_ID = original;
    }
    assert.equal(process.exitCode, 1);
    assert.match(errored(out), /CANVAS_COURSE_ID is not set/);
  });
});
