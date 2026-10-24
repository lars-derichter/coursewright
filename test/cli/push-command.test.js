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

const push = require('../../cli/push');

const COURSE_ID = '4242';

// Push asks git what it holds, and a temp course directory is in no repository
// at all. The answer is handed in so a test says the same thing wherever the
// checkout it runs in happens to be.
const CLEAN = { available: true, paths: new Set(), reason: null };

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'push-cli-test-'));
  for (const [relative, contents] of Object.entries(tree)) {
    const full = path.join(dir, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents, 'utf8');
  }
  return dir;
}

/** Alert icons recorded under the theme this repo is configured with. */
function recordedIcons() {
  const { ICON_FILES } = require('../../lib/convert/alert-icons');
  const { loadTheme, themeFingerprint } = require('../../lib/config/theme');
  const fingerprint = themeFingerprint(loadTheme());
  const icons = {};
  for (const type of Object.keys(ICON_FILES)) {
    icons[type] = {
      canvas_file_id: 900,
      preview_url: `https://canvas.example.com/recorded/${type}`,
      theme: fingerprint,
    };
  }
  return icons;
}

/**
 * The existence check `ensureIcons` makes on each recorded icon before it
 * trusts the row: one `GET /files/:id` per icon, all answered 200, so the
 * recorded icons stand and no upload follows.
 */
function iconCheckRoutes() {
  return Object.keys(require('../../lib/convert/alert-icons').ICON_FILES).map(
    () => ({
      method: 'GET',
      path: '/api/v1/files/900',
      body: { id: 900 },
    }),
  );
}

/** A sync state on disk, so the command's own load/save path is exercised. */
function stateFile(state) {
  const file = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'push-state-')),
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
        icons: recordedIcons(),
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
 */
function readRoutes({ items = [ITEM], pages = [PAGE] } = {}) {
  return [
    { method: 'GET', path: '/modules/10/items', body: items },
    {
      method: 'GET',
      path: '/modules',
      body: [{ id: 10, name: 'Intro', position: 1 }],
    },
    ...pages.map((page) => ({
      method: 'GET',
      path: `/pages/${page.url}`,
      body: page,
    })),
    { method: 'GET', path: '/pages', body: pages.map(pageRow) },
  ];
}

/**
 * A synced course: the tree, the state and the Canvas side all agreeing, which
 * is what every "does this write anything" test starts from.
 */
function syncedFixture({ localBody = 'Hello there.\n' } = {}) {
  const courseDir = tempDir({
    '01-intro/_category_.json': '{ "label": "Intro", "position": 1 }\n',
    '01-intro/01-welcome.md': `---\ntitle: Welcome\n---\n\n${localBody}`,
  });
  const {
    hashLocalFile,
    canvasFingerprint,
  } = require('../../lib/sync/fingerprint');
  const file = stateFile({
    modules: {
      '01-intro': {
        canvas_module_id: 10,
        name: 'Intro',
        position: 1,
        item_order: ['01-intro/01-welcome.md'],
        items: {
          '01-intro/01-welcome.md': {
            canvas_type: 'page',
            canvas_id: 501,
            page_url: 'welcome',
            module_item_id: 91,
            title: 'Welcome',
            local_hash: hashLocalFile(
              path.join(courseDir, '01-intro/01-welcome.md'),
            ),
            canvas_hash: canvasFingerprint(
              { item: ITEM, content: PAGE },
              'page',
            ),
            canvas_updated_at: PAGE.updated_at,
            synced_at: '2026-08-20T09:00:00.000Z',
          },
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

function endpoints(calls) {
  return writes(calls).map(
    (call) => `${call.method} ${call.url.split('/api/v1')[1]}`,
  );
}

function printed(out) {
  return out.log.mock.calls.map((call) => call.arguments.join(' ')).join('\n');
}

/**
 * Run a function with stdin replaced by a readable stream of `input`, so a
 * readline prompt resolves without a terminal.
 */
async function withStdin(input, fn) {
  const { Readable } = require('stream');
  const original = Object.getOwnPropertyDescriptor(process, 'stdin');
  const fake = Readable.from([input]);
  fake.isTTY = false;
  Object.defineProperty(process, 'stdin', { value: fake, configurable: true });
  try {
    return await fn();
  } finally {
    Object.defineProperty(process, 'stdin', original);
  }
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

describe('npx course push', () => {
  it('writes nothing at all when Canvas already matches the tree', async () => {
    const out = silence();
    const { courseDir, file } = syncedFixture();
    const calls = mockCanvas(readRoutes());

    await push({
      courseDir,
      syncFile: file,
      gitDirty: CLEAN,
      interactive: false,
    });

    assert.deepEqual(writes(calls), [], 'a no-op push must issue no write');
    // The one run the in-sync sentence is true of, and it still says it.
    assert.match(printed(out), /Canvas already holds everything in course\//);
    assert.equal(process.exitCode, 0);
  });

  it('does not report a run in sync when its only action failed', async () => {
    const out = silence();
    // Nothing applied means nothing to report, and a bare report used to print
    // the same sentence as a run with nothing to do — so the run's own summary
    // claimed the two sides agreed while the errors under it said the item had
    // not been written. Any action that throws reaches this; a failed page
    // write is only the cheapest way to get there with one item.
    const { courseDir, file } = syncedFixture();
    fs.writeFileSync(
      path.join(courseDir, '01-intro/01-welcome.md'),
      '---\ntitle: Welcome\n---\n\nEdited here.\n',
      'utf8',
    );
    // No PUT route, so the single write this run plans answers 400 and throws.
    mockCanvas([...iconCheckRoutes(), ...readRoutes()]);

    await push({
      courseDir,
      syncFile: file,
      gitDirty: CLEAN,
      interactive: false,
    });

    assert.doesNotMatch(printed(out), /already holds everything/);
    assert.match(printed(out), /Nothing was applied\. See the errors below\./);
    assert.match(
      out.error.mock.calls.map((call) => call.arguments.join(' ')).join('\n'),
      /01-intro\/01-welcome\.md/,
    );
    assert.equal(process.exitCode, 1);
  });

  it('pushes a local edit, and only that', async () => {
    silence();
    const { courseDir, file } = syncedFixture();
    fs.writeFileSync(
      path.join(courseDir, '01-intro/01-welcome.md'),
      '---\ntitle: Welcome\n---\n\nEdited here.\n',
      'utf8',
    );
    const calls = mockCanvas([
      ...iconCheckRoutes(),
      ...readRoutes(),
      {
        method: 'PUT',
        path: '/pages/501',
        body: { ...PAGE, body: '<p>Edited here.</p>' },
      },
    ]);

    await push({
      courseDir,
      syncFile: file,
      gitDirty: CLEAN,
      interactive: false,
    });

    assert.deepEqual(endpoints(calls), [`PUT /courses/${COURSE_ID}/pages/501`]);
  });

  it('pushes over a Canvas edit rather than pulling it', async () => {
    // conflict: 'local' is pinned, so a page that moved on both sides goes up.
    silence();
    const { courseDir, file } = syncedFixture();
    fs.writeFileSync(
      path.join(courseDir, '01-intro/01-welcome.md'),
      '---\ntitle: Welcome\n---\n\nEdited here.\n',
      'utf8',
    );
    const movedPage = {
      ...PAGE,
      body: '<p>Edited in Canvas.</p>',
      updated_at: '2026-08-20T13:00:00.000Z',
    };
    const calls = mockCanvas([
      ...iconCheckRoutes(),
      ...readRoutes({ pages: [movedPage] }),
      { method: 'PUT', path: '/pages/501', body: movedPage },
    ]);

    await push({
      courseDir,
      syncFile: file,
      gitDirty: CLEAN,
      interactive: false,
    });

    assert.deepEqual(endpoints(calls), [`PUT /courses/${COURSE_ID}/pages/501`]);
    assert.match(
      fs.readFileSync(path.join(courseDir, '01-intro/01-welcome.md'), 'utf8'),
      /Edited here/,
      'push never writes the Canvas version over the file',
    );
  });

  it('leaves a Canvas-only edit alone and says which side it left', async () => {
    silence();
    const out = silence();
    const { courseDir, file } = syncedFixture();
    const movedPage = {
      ...PAGE,
      body: '<p>Edited in Canvas.</p>',
      updated_at: '2026-08-20T13:00:00.000Z',
    };
    const calls = mockCanvas(readRoutes({ pages: [movedPage] }));

    await push({
      courseDir,
      syncFile: file,
      gitDirty: CLEAN,
      interactive: false,
    });

    assert.deepEqual(writes(calls), []);
    assert.match(
      fs.readFileSync(path.join(courseDir, '01-intro/01-welcome.md'), 'utf8'),
      /Hello there/,
      'the local file is not touched either',
    );
    assert.match(printed(out), /Left alone \(this command does not write/);
    assert.equal(process.exitCode, 0);
  });

  it('leaves a dirty file alone without calling it skipped', async () => {
    // Push writes to no local file, so a Canvas-side edit on one holding
    // uncommitted work is withheld, not refused: naming it under "Skipped"
    // would tell the author to commit a file this command does not touch, and
    // fail the run for it.
    const out = silence();
    const { courseDir, file } = syncedFixture();
    const movedPage = {
      ...PAGE,
      body: '<p>Edited in Canvas.</p>',
      updated_at: '2026-08-20T13:00:00.000Z',
    };
    const calls = mockCanvas(readRoutes({ pages: [movedPage] }));

    await push({
      courseDir,
      syncFile: file,
      interactive: false,
      gitDirty: {
        available: true,
        paths: new Set(['01-intro/01-welcome.md']),
        reason: null,
      },
    });

    assert.deepEqual(writes(calls), []);
    assert.match(printed(out), /Left alone \(this command does not write/);
    assert.doesNotMatch(printed(out), /Skipped/);
    assert.equal(process.exitCode, 0);
  });

  it('says the undo is missing even under --quiet', async () => {
    // Push is the direction where losing this line costs most: the run goes
    // ahead and changes Canvas, and the only thing that would have let the
    // author walk it back is the thing that is not there. On `log.warn` a
    // `push --quiet` outside a checkout changed the course and said nothing
    // about it, so it goes through `log.refusal` (`cli/logger.js`).
    const out = silence();
    const { courseDir, file } = syncedFixture();
    mockCanvas(readRoutes());

    log.configure({ quiet: true });
    try {
      await push({
        courseDir,
        syncFile: file,
        interactive: false,
        gitDirty: {
          available: false,
          paths: new Set(),
          files: new Set(),
          reason: 'the tree is not inside a git repository',
        },
      });
    } finally {
      log.configure({ quiet: false });
    }

    const warned = out.warn.mock.calls
      .map((call) => call.arguments.join(' '))
      .join('\n');
    assert.match(warned, /not inside a git repository/);
    assert.match(warned, /nothing to fall back on/);
  });

  it('--dry-run writes nothing and reports the plan as a preview', async () => {
    const out = silence();
    const { courseDir, file } = syncedFixture();
    fs.writeFileSync(
      path.join(courseDir, '01-intro/01-welcome.md'),
      '---\ntitle: Welcome\n---\n\nEdited here.\n',
      'utf8',
    );
    const calls = mockCanvas(readRoutes());

    await push({
      courseDir,
      syncFile: file,
      gitDirty: CLEAN,
      interactive: false,
      dryRun: true,
    });

    assert.deepEqual(writes(calls), []);
    assert.equal(readState(file).last_sync, null, 'a dry run saves nothing');
    assert.match(printed(out), /^Would apply$/m);
    assert.doesNotMatch(printed(out), /^Applied$/m);
  });
});

// ---------------------------------------------------------------------------
// Adoption: the end-to-end of commit 8
// ---------------------------------------------------------------------------

describe('npx course push, into a course that already holds content', () => {
  /** The same page on both sides, with nothing in the state linking them. */
  function populated() {
    const courseDir = tempDir({
      '01-intro/_category_.json': '{ "label": "Intro", "position": 1 }\n',
      '01-intro/01-welcome.md': '---\ntitle: Welcome\n---\n\nLocal copy.\n',
    });
    return { courseDir, file: stateFile({}) };
  }

  it('claims the Canvas page instead of creating a second one', async () => {
    const out = silence();
    const { courseDir, file } = populated();
    const calls = mockCanvas([
      ...iconCheckRoutes(),
      // The three counts the first-push confirmation asks for, before the
      // course is read for real: each one is spliced out on the way past, so
      // the reads below still have their own routes.
      { method: 'GET', path: '/modules', body: [{ id: 10, name: 'Intro' }] },
      { method: 'GET', path: '/pages', body: [pageRow(PAGE)] },
      { method: 'GET', path: '/assignments', body: [] },
      ...readRoutes(),
      {
        method: 'PUT',
        path: '/pages/501',
        body: { ...PAGE, body: '<p>Local copy.</p>' },
      },
    ]);

    await withStdin('y\n', () =>
      push({ courseDir, syncFile: file, gitDirty: CLEAN, interactive: false }),
    );

    assert.deepEqual(
      endpoints(calls),
      [`PUT /courses/${COURSE_ID}/pages/501`],
      'the existing page is written over; nothing is created',
    );
    assert.match(printed(out), /Adopted \(matched to something already/);
    assert.match(printed(out), /01-intro\/01-welcome\.md: page "Welcome"/);

    const row =
      readState(file).modules['01-intro'].items['01-intro/01-welcome.md'];
    assert.equal(row.canvas_id, 501, 'the row now names the Canvas page');
    assert.equal(row.module_item_id, 91);
  });

  it('leaves the second push with nothing to do', async () => {
    // The run that follows the adopting one. Pass 1 has to write down which
    // Canvas module the folder is, or pass 2 pairs the folder with nothing:
    // the module reads as gone from Canvas, every item in it as a local
    // orphan, and a stray move-canvas-item fails for want of a module id.
    silence();
    const { courseDir, file } = populated();
    mockCanvas([
      ...iconCheckRoutes(),
      { method: 'GET', path: '/modules', body: [{ id: 10, name: 'Intro' }] },
      { method: 'GET', path: '/pages', body: [pageRow(PAGE)] },
      { method: 'GET', path: '/assignments', body: [] },
      ...readRoutes(),
      {
        method: 'PUT',
        path: '/pages/501',
        body: { ...PAGE, body: '<p>Local copy.</p>' },
      },
    ]);
    await withStdin('y\n', () =>
      push({ courseDir, syncFile: file, gitDirty: CLEAN, interactive: false }),
    );

    assert.equal(
      readState(file).modules['01-intro'].canvas_module_id,
      10,
      'the first push has to leave the folder linked to its Canvas module',
    );

    mock.restoreAll();
    const out = silence();
    const calls = mockCanvas(readRoutes());
    await push({
      courseDir,
      syncFile: file,
      gitDirty: CLEAN,
      interactive: false,
    });

    assert.deepEqual(writes(calls), [], 'the second push writes nothing');
    assert.doesNotMatch(printed(out), /Orphaned locally/);
    assert.equal(process.exitCode, 0);
  });

  it('cancels the whole run when the first-push warning is declined', async () => {
    silence();
    const { courseDir, file } = populated();
    const calls = mockCanvas([
      { method: 'GET', path: '/modules', body: [{ id: 10, name: 'Intro' }] },
      { method: 'GET', path: '/pages', body: [pageRow(PAGE)] },
      { method: 'GET', path: '/assignments', body: [] },
    ]);

    await withStdin('n\n', () =>
      push({ courseDir, syncFile: file, gitDirty: CLEAN, interactive: false }),
    );

    assert.deepEqual(writes(calls), []);
    assert.equal(
      readState(file).last_sync,
      null,
      'a cancelled run records no sync',
    );
    assert.ok(
      !calls.some((call) => call.url.includes('/modules/10/items')),
      'the course is not even read once the answer is no',
    );
    assert.equal(
      process.exitCode,
      1,
      'a push that pushed nothing must not report success to its caller',
    );
  });
});

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

describe('npx course push, when Canvas was reordered', () => {
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

  /** Two synced pages whose Canvas order is the reverse of the local one. */
  function reorderedOnCanvas() {
    const courseDir = tempDir({
      '01-intro/_category_.json': '{ "label": "Intro", "position": 1 }\n',
      '01-intro/01-welcome.md': '---\ntitle: Welcome\n---\n\nHello there.\n',
      '01-intro/02-second.md': '---\ntitle: Second\n---\n\nSecond page.\n',
    });
    const {
      hashLocalFile,
      canvasFingerprint,
    } = require('../../lib/sync/fingerprint');
    const row = (itemPath, item, content) => ({
      canvas_type: 'page',
      canvas_id: content.page_id,
      page_url: content.url,
      module_item_id: item.id,
      title: content.title,
      local_hash: hashLocalFile(path.join(courseDir, itemPath)),
      canvas_hash: canvasFingerprint({ item, content }, 'page'),
      canvas_updated_at: content.updated_at,
      synced_at: '2026-08-20T09:00:00.000Z',
    });
    const file = stateFile({
      modules: {
        '01-intro': {
          canvas_module_id: 10,
          name: 'Intro',
          position: 1,
          item_order: ['01-intro/01-welcome.md', '01-intro/02-second.md'],
          items: {
            '01-intro/01-welcome.md': row('01-intro/01-welcome.md', ITEM, PAGE),
            '01-intro/02-second.md': row(
              '01-intro/02-second.md',
              SECOND_ITEM,
              SECOND_PAGE,
            ),
          },
        },
      },
    });
    // Canvas holds them the other way round, and nothing else moved.
    const items = [
      { ...SECOND_ITEM, position: 1 },
      { ...ITEM, position: 2 },
    ];
    return { courseDir, file, items };
  }

  it('leaves the Canvas order as it is, and reports what it did not do', async () => {
    // Old push rebuilt every item list, so it silently reverted anyone who
    // reordered a module in the Canvas UI. Reordering the local files to match
    // is a local write, which this command withholds; settling it is sync's
    // job.
    const out = silence();
    const { courseDir, file, items } = reorderedOnCanvas();
    const calls = mockCanvas(readRoutes({ items, pages: [PAGE, SECOND_PAGE] }));

    await push({
      courseDir,
      syncFile: file,
      gitDirty: CLEAN,
      interactive: false,
    });

    assert.deepEqual(writes(calls), [], 'a reorder on one side is not a write');
    assert.deepEqual(
      fs.readdirSync(path.join(courseDir, '01-intro')).sort(),
      ['01-welcome.md', '02-second.md', '_category_.json'],
      'no file is renumbered',
    );
    assert.match(
      printed(out),
      /01-intro: would have taken the Canvas order \(only this side reordered\), but this command does not write to the local files/,
    );
  });

  it('promises no answer for a contested order, and names who does ask', async () => {
    // Push takes no `--order` flag, so it never settles a module both sides
    // reordered. It used to say "awaiting an answer" all the same, which
    // promised a prompt no command would ever issue.
    const out = silence();
    const THIRD_PAGE = {
      page_id: 503,
      url: 'third',
      title: 'Third',
      body: '<p>Third page.</p>',
      updated_at: '2026-08-20T11:00:00.000Z',
    };
    const THIRD_ITEM = {
      id: 93,
      type: 'Page',
      title: 'Third',
      page_url: 'third',
      content_id: 503,
      position: 3,
      indent: 0,
    };
    const courseDir = tempDir({
      '01-intro/_category_.json': '{ "label": "Intro", "position": 1 }\n',
      '01-intro/01-welcome.md': '---\ntitle: Welcome\n---\n\nHello there.\n',
      '01-intro/02-second.md': '---\ntitle: Second\n---\n\nSecond page.\n',
      '01-intro/03-third.md': '---\ntitle: Third\n---\n\nThird page.\n',
    });
    const {
      hashLocalFile,
      canvasFingerprint,
    } = require('../../lib/sync/fingerprint');
    const row = (itemPath, item, content) => ({
      canvas_type: 'page',
      canvas_id: content.page_id,
      page_url: content.url,
      module_item_id: item.id,
      title: content.title,
      local_hash: hashLocalFile(path.join(courseDir, itemPath)),
      canvas_hash: canvasFingerprint({ item, content }, 'page'),
      canvas_updated_at: content.updated_at,
      synced_at: '2026-08-20T09:00:00.000Z',
    });
    const file = stateFile({
      modules: {
        '01-intro': {
          canvas_module_id: 10,
          name: 'Intro',
          position: 1,
          // The last sync recorded second, welcome, third. The filenames say
          // welcome, second, third, and Canvas says second, third, welcome:
          // both sides moved, and they disagree.
          item_order: [
            '01-intro/02-second.md',
            '01-intro/01-welcome.md',
            '01-intro/03-third.md',
          ],
          items: {
            '01-intro/01-welcome.md': row('01-intro/01-welcome.md', ITEM, PAGE),
            '01-intro/02-second.md': row(
              '01-intro/02-second.md',
              SECOND_ITEM,
              SECOND_PAGE,
            ),
            '01-intro/03-third.md': row(
              '01-intro/03-third.md',
              THIRD_ITEM,
              THIRD_PAGE,
            ),
          },
        },
      },
    });
    const calls = mockCanvas(
      readRoutes({
        items: [
          { ...SECOND_ITEM, position: 1 },
          { ...THIRD_ITEM, position: 2 },
          { ...ITEM, position: 3 },
        ],
        pages: [PAGE, SECOND_PAGE, THIRD_PAGE],
      }),
    );

    await push({
      courseDir,
      syncFile: file,
      gitDirty: CLEAN,
      interactive: false,
    });

    assert.deepEqual(writes(calls), [], 'a contested order moves nothing');
    const text = printed(out);
    assert.doesNotMatch(text, /awaiting an answer/);
    assert.match(
      text,
      /01-intro: left as it is — both sides reordered, and this command never asks which wins; `npx course sync` is the one that does\./,
    );
  });
});

// ---------------------------------------------------------------------------
// --prune-canvas
// ---------------------------------------------------------------------------

describe('npx course push --prune-canvas', () => {
  /** A course whose second page was deleted locally but is still on Canvas. */
  function orphaned() {
    const fixture = syncedFixture();
    const state = readState(fixture.file);
    const module = state.modules['01-intro'];
    module.item_order.push('01-intro/02-gone.md');
    module.items['01-intro/02-gone.md'] = {
      canvas_type: 'page',
      canvas_id: 502,
      page_url: 'gone',
      module_item_id: 92,
      title: 'Gone',
      local_hash: 'whatever-it-was',
      canvas_hash: 'stored-gone-hash',
      canvas_updated_at: '2026-08-20T11:00:00.000Z',
      synced_at: '2026-08-20T09:00:00.000Z',
    };
    fs.writeFileSync(fixture.file, JSON.stringify(state, null, 2), 'utf8');

    const gonePage = {
      page_id: 502,
      url: 'gone',
      title: 'Gone',
      body: '<p>Gone.</p>',
      updated_at: '2026-08-20T11:00:00.000Z',
    };
    const goneItem = {
      id: 92,
      type: 'Page',
      title: 'Gone',
      page_url: 'gone',
      content_id: 502,
      position: 2,
      indent: 0,
    };
    return {
      ...fixture,
      routes: readRoutes({
        items: [ITEM, goneItem],
        pages: [PAGE, gonePage],
      }),
    };
  }

  /**
   * The same, but the orphan is an assignment students have submitted to —
   * and, when `quizId` is given, one that is really the gradebook half of a
   * quiz.
   */
  function orphanedAssignment({ quizId = null } = {}) {
    const item = {
      id: 92,
      type: 'Assignment',
      title: 'Homework',
      content_id: 601,
      position: 2,
      indent: 0,
    };
    const assignment = {
      id: 601,
      name: 'Homework',
      description: '<p>Do it.</p>',
      points_possible: 10,
      has_submitted_submissions: true,
      updated_at: '2026-08-20T11:00:00.000Z',
    };

    const fixture = syncedFixture();
    const { canvasFingerprint } = require('../../lib/sync/fingerprint');
    const state = readState(fixture.file);
    const module = state.modules['01-intro'];
    module.item_order.push('01-intro/02-hw.md');
    module.items['01-intro/02-hw.md'] = {
      canvas_type: 'assignment',
      canvas_id: 601,
      module_item_id: 92,
      title: 'Homework',
      local_hash: 'whatever-it-was',
      canvas_hash: canvasFingerprint(
        { item, content: assignment },
        'assignment',
      ),
      canvas_updated_at: assignment.updated_at,
      synced_at: '2026-08-20T09:00:00.000Z',
    };
    fs.writeFileSync(fixture.file, JSON.stringify(state, null, 2), 'utf8');

    return {
      ...fixture,
      routes: [
        { method: 'GET', path: '/modules/10/items', body: [ITEM, item] },
        {
          method: 'GET',
          path: '/modules',
          body: [{ id: 10, name: 'Intro', position: 1 }],
        },
        // The single fetch the quiz-backed check makes; ahead of the list
        // routes, which its URL would otherwise be matched by.
        {
          method: 'GET',
          path: '/assignments/601',
          body:
            quizId == null ? assignment : { ...assignment, quiz_id: quizId },
        },
        // One list for the fingerprints, one for the submission states.
        { method: 'GET', path: '/assignments', body: [assignment] },
        { method: 'GET', path: '/assignments', body: [assignment] },
        { method: 'GET', path: `/pages/${PAGE.url}`, body: PAGE },
        { method: 'GET', path: '/pages', body: [pageRow(PAGE)] },
      ],
    };
  }

  it('names the orphan and deletes nothing without the flag', async () => {
    const out = silence();
    const { courseDir, file, routes } = orphaned();
    const calls = mockCanvas(routes);

    await push({
      courseDir,
      syncFile: file,
      gitDirty: CLEAN,
      interactive: false,
    });

    assert.deepEqual(writes(calls), []);
    assert.match(printed(out), /Orphaned on Canvas/);
    assert.match(printed(out), /`--prune-canvas` is what deletes these/);
    // A course mid-edit is not a failure.
    assert.equal(process.exitCode, 0);
    assert.ok(readState(file).modules['01-intro'].items['01-intro/02-gone.md']);
  });

  it('deletes only the orphan, once the question is answered', async () => {
    silence();
    const { courseDir, file, routes } = orphaned();
    const calls = mockCanvas([
      ...routes,
      { method: 'DELETE', path: '/pages/502', body: {} },
    ]);

    await withStdin('y\n', () =>
      push({
        courseDir,
        syncFile: file,
        gitDirty: CLEAN,
        interactive: true,
        pruneCanvas: true,
      }),
    );

    assert.deepEqual(
      endpoints(calls),
      [`DELETE /courses/${COURSE_ID}/pages/502`],
      'only the orphan may be deleted',
    );
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
    const calls = mockCanvas(routes);

    await withStdin('n\n', () =>
      push({
        courseDir,
        syncFile: file,
        gitDirty: CLEAN,
        interactive: true,
        pruneCanvas: true,
      }),
    );

    assert.deepEqual(writes(calls), []);
    assert.ok(readState(file).modules['01-intro'].items['01-intro/02-gone.md']);
    // Re-planned without the prune, so the orphan is listed as an orphan again
    // rather than as something the run claims to have deleted.
    assert.match(printed(out), /Orphaned on Canvas/);
    assert.match(printed(out), /`--prune-canvas` is what deletes these/);
  });

  it('deletes nothing when it cannot ask', async () => {
    const out = silence();
    const { courseDir, file, routes } = orphaned();
    const calls = mockCanvas(routes);

    await push({
      courseDir,
      syncFile: file,
      gitDirty: CLEAN,
      interactive: false,
      pruneCanvas: true,
    });

    assert.deepEqual(writes(calls), [], 'nothing may be deleted unconfirmed');
    assert.ok(readState(file).modules['01-intro'].items['01-intro/02-gone.md']);
    assert.match(printed(out), /Orphaned on Canvas/);
  });

  it('lists what it would delete on a dry run, and asks nothing', async () => {
    const out = silence();
    const { courseDir, file, routes } = orphaned();
    const calls = mockCanvas(routes);

    // No stdin behind this: a dry run that asked would hang the test.
    await push({
      courseDir,
      syncFile: file,
      gitDirty: CLEAN,
      interactive: true,
      pruneCanvas: true,
      dryRun: true,
    });

    assert.deepEqual(writes(calls), []);
    assert.match(printed(out), /02-gone\.md \(page\)/);
    assert.match(printed(out), /^Would apply$/m);
  });

  it('lists an embedded binary nothing points at, and asks before deleting it', async () => {
    const out = silence();
    // The whole course is in step; the only thing wrong is a `files` row for a
    // path no page names any more — what a renamed image leaves behind. It is
    // neither a module nor a module item, so the confirmation had to learn to
    // count it: a delete this prompt does not list is a delete that runs
    // unannounced.
    const { courseDir } = syncedFixture();
    const {
      hashLocalFile,
      canvasFingerprint,
    } = require('../../lib/sync/fingerprint');
    const file = stateFile({
      modules: {
        '01-intro': {
          canvas_module_id: 10,
          name: 'Intro',
          position: 1,
          item_order: ['01-intro/01-welcome.md'],
          items: {
            '01-intro/01-welcome.md': {
              canvas_type: 'page',
              canvas_id: 501,
              page_url: 'welcome',
              module_item_id: 91,
              title: 'Welcome',
              local_hash: hashLocalFile(
                path.join(courseDir, '01-intro/01-welcome.md'),
              ),
              canvas_hash: canvasFingerprint(
                { item: ITEM, content: PAGE },
                'page',
              ),
              canvas_updated_at: PAGE.updated_at,
              synced_at: '2026-08-20T09:00:00.000Z',
            },
          },
        },
      },
      files: {
        '01-intro/_files/logo.png': {
          canvas_file_id: 500,
          canvas_url: `/courses/${COURSE_ID}/files/500/preview`,
          sha256: 'abc123',
        },
      },
    });
    const calls = mockCanvas([
      ...readRoutes(),
      {
        method: 'GET',
        path: '/api/v1/files/500',
        body: { id: 500, display_name: 'logo.png' },
      },
      { method: 'DELETE', path: '/api/v1/files/500', body: {} },
    ]);

    await withStdin('y\n', () =>
      push({
        courseDir,
        syncFile: file,
        gitDirty: CLEAN,
        interactive: true,
        pruneCanvas: true,
      }),
    );

    assert.match(printed(out), /01-intro\/_files\/logo\.png \("logo\.png"\)/);
    assert.deepEqual(endpoints(calls), ['DELETE /files/500']);
    assert.deepEqual(readState(file).files, {});
  });

  it('names the student work behind a doomed assignment before it asks', async () => {
    const out = silence();
    const { courseDir, file, routes } = orphanedAssignment();
    const calls = mockCanvas([
      ...routes,
      { method: 'DELETE', path: '/assignments/601', body: {} },
    ]);

    await withStdin('y\n', () =>
      push({
        courseDir,
        syncFile: file,
        gitDirty: CLEAN,
        interactive: true,
        pruneCanvas: true,
      }),
    );

    assert.match(
      printed(out),
      /01-intro\/02-hw\.md \(assignment\) {2}<-- HAS STUDENT SUBMISSIONS/,
    );
    assert.deepEqual(endpoints(calls), [
      `DELETE /courses/${COURSE_ID}/assignments/601`,
    ]);
  });

  it('refuses to take a quiz down with the assignment that fronts it', async () => {
    const out = silence();
    const { courseDir, file, routes } = orphanedAssignment({ quizId: 77 });
    const calls = mockCanvas(routes);

    await withStdin('y\n', () =>
      push({
        courseDir,
        syncFile: file,
        gitDirty: CLEAN,
        interactive: true,
        pruneCanvas: true,
      }),
    );

    assert.deepEqual(writes(calls), [], 'the DELETE must never be issued');
    assert.ok(
      readState(file).modules['01-intro'].items['01-intro/02-hw.md'],
      'the row stays, so the next prune asks again',
    );
    assert.match(
      out.error.mock.calls.map((call) => call.arguments.join(' ')).join('\n'),
      /gradebook half of quiz 77/,
    );
    assert.equal(process.exitCode, 1);
  });
});

// ---------------------------------------------------------------------------
// The flag surface
// ---------------------------------------------------------------------------

describe('npx course push: the flags', () => {
  it('-m confines the run to the module named', async () => {
    silence();
    const courseDir = tempDir({
      '01-intro/_category_.json': '{ "label": "Intro", "position": 1 }\n',
      '01-intro/01-welcome.md': '---\ntitle: Welcome\n---\n\nEdited here.\n',
      '02-later/_category_.json': '{ "label": "Later", "position": 2 }\n',
      '02-later/01-more.md': '---\ntitle: More\n---\n\nAlso edited.\n',
    });
    const file = stateFile({
      modules: {
        '01-intro': {
          canvas_module_id: 10,
          name: 'Intro',
          position: 1,
          item_order: ['01-intro/01-welcome.md'],
          items: {
            '01-intro/01-welcome.md': {
              canvas_type: 'page',
              canvas_id: 501,
              page_url: 'welcome',
              module_item_id: 91,
              title: 'Welcome',
              local_hash: 'stale',
              canvas_hash: 'stored',
              canvas_updated_at: PAGE.updated_at,
            },
          },
        },
        '02-later': {
          canvas_module_id: 20,
          name: 'Later',
          position: 2,
          item_order: ['02-later/01-more.md'],
          items: {
            '02-later/01-more.md': {
              canvas_type: 'page',
              canvas_id: 601,
              page_url: 'more',
              module_item_id: 93,
              title: 'More',
              local_hash: 'stale',
              canvas_hash: 'stored',
              canvas_updated_at: PAGE.updated_at,
            },
          },
        },
      },
    });
    const calls = mockCanvas([
      ...iconCheckRoutes(),
      { method: 'GET', path: '/modules/10/items', body: [ITEM] },
      {
        method: 'GET',
        path: '/modules/20/items',
        body: [
          {
            id: 93,
            type: 'Page',
            title: 'More',
            page_url: 'more',
            content_id: 601,
            position: 1,
            indent: 0,
          },
        ],
      },
      {
        method: 'GET',
        path: '/modules',
        body: [
          { id: 10, name: 'Intro', position: 1 },
          { id: 20, name: 'Later', position: 2 },
        ],
      },
      {
        method: 'GET',
        path: '/pages',
        body: [
          pageRow(PAGE),
          {
            page_id: 601,
            url: 'more',
            title: 'More',
            updated_at: PAGE.updated_at,
          },
        ],
      },
      { method: 'PUT', path: '/pages/501', body: PAGE },
    ]);

    await push({
      courseDir,
      syncFile: file,
      gitDirty: CLEAN,
      interactive: false,
      module: '01-intro',
    });

    assert.deepEqual(
      endpoints(calls),
      [`PUT /courses/${COURSE_ID}/pages/501`],
      'the module that was not named must not be written',
    );
  });

  it('refuses a module name no folder answers to', async () => {
    const out = silence();
    const { courseDir, file } = syncedFixture();
    const calls = mockCanvas([]);

    await push({
      courseDir,
      syncFile: file,
      gitDirty: CLEAN,
      interactive: false,
      module: '99-nope',
    });

    assert.deepEqual(calls, [], 'it fails before it reads anything');
    assert.equal(process.exitCode, 1);
    assert.match(
      out.error.mock.calls.map((call) => call.arguments.join(' ')).join('\n'),
      /no module folder named 99-nope/,
    );
  });

  it('points --prune at its new name rather than pruning', async () => {
    const out = silence();
    const { courseDir, file } = syncedFixture();
    const calls = mockCanvas([]);

    await push({
      courseDir,
      syncFile: file,
      gitDirty: CLEAN,
      interactive: false,
      prune: true,
    });

    assert.deepEqual(calls, []);
    assert.equal(process.exitCode, 1);
    assert.match(
      out.error.mock.calls.map((call) => call.arguments.join(' ')).join('\n'),
      /--prune is now --prune-canvas/,
    );
  });

  it('says so and stops when there is nothing under course/', async () => {
    const out = silence();
    const courseDir = tempDir({});
    const calls = mockCanvas([]);

    await push({
      courseDir,
      syncFile: stateFile({}),
      gitDirty: CLEAN,
      interactive: false,
    });

    assert.deepEqual(calls, [], 'an empty tree is never pushed');
    assert.equal(process.exitCode, 0);
    assert.match(printed(out), /No modules found/);
  });

  it('fails when no course id is configured', async () => {
    const out = silence();
    const original = process.env.CANVAS_COURSE_ID;
    delete process.env.CANVAS_COURSE_ID;
    try {
      await push({});
    } finally {
      process.env.CANVAS_COURSE_ID = original;
    }
    assert.equal(process.exitCode, 1);
    assert.match(
      out.error.mock.calls.map((call) => call.arguments.join(' ')).join('\n'),
      /CANVAS_COURSE_ID is not set/,
    );
  });
});
