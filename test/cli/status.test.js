const { describe, it, mock, afterEach, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { mockCanvas, silence } = require('../helpers/canvas-mock');

process.env.CANVAS_API_URL = 'https://canvas.example.com';
process.env.CANVAS_API_TOKEN = 'test-token-123';
process.env.CANVAS_COURSE_ID = '4242';

const status = require('../../cli/status');

const COURSE_ID = '4242';

// Status asks git what it holds, and a temp course directory is in no
// repository at all. The answer is handed in so a test says the same thing
// wherever the checkout it runs in happens to be.
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'status-cli-test-'));
  for (const [relative, contents] of Object.entries(tree)) {
    const full = path.join(dir, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents, 'utf8');
  }
  return dir;
}

/** A sync state on disk, so the command's own load path is exercised. */
function stateFile(state) {
  const file = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'status-state-')),
    '.canvas-sync.json',
  );
  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        schema_version: 4,
        canvas_base_url: 'https://canvas.example.com',
        course_id: Number(COURSE_ID),
        last_sync: '2026-08-20T09:00:00.000Z',
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
  updated_at: '2026-08-20T08:00:00.000Z',
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
const SECOND_PAGE = {
  page_id: 502,
  url: 'second',
  title: 'Second',
  body: '<p>Second page.</p>',
  updated_at: '2026-08-20T08:00:00.000Z',
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
function readRoutes({
  items = [ITEM, SECOND_ITEM],
  pages = [PAGE, SECOND_PAGE],
  fetch = [],
} = {}) {
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

const WELCOME = '01-intro/01-welcome.md';
const SECOND = '01-intro/02-second.md';

/**
 * A synced course: two pages, with the tree, the state and the Canvas side all
 * agreeing. Every "what does status say about a change" test starts here and
 * changes exactly one thing.
 */
function syncedFixture() {
  const courseDir = tempDir({
    '01-intro/_category_.json': '{ "label": "Intro", "position": 1 }\n',
    [WELCOME]: '---\ntitle: Welcome\ncanvas_type: page\n---\n\nHello there.\n',
    [SECOND]: '---\ntitle: Second\ncanvas_type: page\n---\n\nSecond page.\n',
  });
  const file = stateFile({
    modules: {
      '01-intro': {
        canvas_module_id: 10,
        name: 'Intro',
        position: 1,
        item_order: [WELCOME, SECOND],
        items: {
          [WELCOME]: pageRowState(courseDir, WELCOME, ITEM, PAGE),
          [SECOND]: pageRowState(courseDir, SECOND, SECOND_ITEM, SECOND_PAGE),
        },
      },
    },
  });
  return { courseDir, file };
}

// ---------------------------------------------------------------------------
// Reading the run
// ---------------------------------------------------------------------------

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

/** Every file under a directory with its bytes, so a tree can be compared whole. */
function snapshot(dir) {
  const out = {};
  for (const entry of fs.readdirSync(dir, { recursive: true })) {
    const relative = String(entry).split(path.sep).join('/');
    const full = path.join(dir, relative);
    if (!fs.statSync(full).isFile()) continue;
    out[relative] = fs.readFileSync(full, 'utf8');
  }
  return out;
}

function write(courseDir, relative, contents) {
  fs.writeFileSync(path.join(courseDir, relative), contents, 'utf8');
}

/** Stamp every file in the tree with the same recent mtime, the way a clone does. */
function touchAll(dir, when = new Date()) {
  for (const entry of fs.readdirSync(dir, { recursive: true })) {
    fs.utimesSync(path.join(dir, String(entry)), when, when);
  }
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

describe('npx course status', () => {
  it('reports no work on a course both sides already agree on', async () => {
    const out = silence();
    const { courseDir, file } = syncedFixture();
    mockCanvas(readRoutes());

    await status({ courseDir, syncFile: file, gitDirty: CLEAN });

    assert.match(printed(out), /Nothing to do: course\/ and the Canvas course/);
    assert.doesNotMatch(printed(out), /Would apply|Left alone/);
    assert.equal(process.exitCode, 0);
  });

  it('prints no git-guard line today — a known defect, not a decision', async () => {
    // **This test records current behaviour. It does not endorse it.**
    //
    // The other three commands print the guard's reason, and since it moved to
    // `log.refusal` (`cli/logger.js`) `--quiet` no longer takes it away. This
    // command prints nothing, and the tempting reading — the guard protects the
    // working tree from a write and status makes none — is wrong. All three
    // dirty guards in `lib/sync/plan.js` are gated on `writeLands`, which is
    // false under status, so `gitDirty` changes no byte of what this command
    // prints and the `git status` it runs is consumed by nothing. The result is
    // that status reports "a sync would update 1 item locally" for a write that
    // sync would refuse.
    //
    // Fixing that is a change to the planner and is logged as its own work. So
    // this asserts only what is true right now, and is here to fail loudly if
    // the fix lands without someone revisiting this file.
    const out = silence();
    const { courseDir, file } = syncedFixture();
    mockCanvas(readRoutes());

    await status({
      courseDir,
      syncFile: file,
      gitDirty: {
        available: false,
        paths: new Set(),
        files: new Set(),
        reason: 'the tree is not inside a git repository',
      },
    });

    const said = [out.log, out.warn, out.error]
      .map((sink) =>
        sink.mock.calls.map((call) => call.arguments.join(' ')).join('\n'),
      )
      .join('\n');
    assert.doesNotMatch(said, /not inside a git repository/);
    assert.equal(process.exitCode, 0);
  });

  it('previews a local edit as the Canvas write it does not make', async () => {
    const out = silence();
    const { courseDir, file } = syncedFixture();
    write(
      courseDir,
      WELCOME,
      '---\ntitle: Welcome\ncanvas_type: page\n---\n\nEdited here.\n',
    );
    mockCanvas(readRoutes());

    await status({ courseDir, syncFile: file, gitDirty: CLEAN });

    const text = printed(out);
    assert.match(
      text,
      /Left alone \(this command does not write to that side\)/,
    );
    assert.match(text, /Canvas: 1 item updated/);
    assert.doesNotMatch(text, /Locally: 1 item updated/);
    assert.equal(process.exitCode, 0);
  });

  it('previews a Canvas edit as the local write it does not make', async () => {
    const out = silence();
    const { courseDir, file } = syncedFixture();
    const movedPage = {
      ...SECOND_PAGE,
      body: '<p>Edited in Canvas.</p>',
      updated_at: '2026-08-20T13:00:00.000Z',
    };
    mockCanvas(readRoutes({ pages: [PAGE, movedPage], fetch: [movedPage] }));

    await status({ courseDir, syncFile: file, gitDirty: CLEAN });

    const text = printed(out);
    assert.match(
      text,
      /Left alone \(this command does not write to that side\)/,
    );
    assert.match(text, /Locally: 1 item updated/);
    assert.doesNotMatch(text, /Canvas: 1 item updated/);
    assert.equal(process.exitCode, 0);
  });

  it('shows the collision a plain sync would refuse on', async () => {
    // Why the policy adopts nothing. Adoption is what lets push and pull claim
    // a Canvas object that already exists, and taking it here would quietly
    // resolve the one thing an author most needs a preview to show them: that
    // `sync` will refuse this course until they pick a direction.
    const out = silence();
    const { courseDir } = syncedFixture();
    const file = stateFile({ modules: {} });
    mockCanvas(readRoutes({ fetch: [PAGE, SECOND_PAGE] }));

    await status({ courseDir, syncFile: file, gitDirty: CLEAN });

    const text = printed(out);
    assert.match(text, /^Refused$/m);
    assert.match(text, /The sync state links nothing in 01-intro/);
    assert.match(text, /npx course push. pins the local copy/);
    assert.equal(
      process.exitCode,
      1,
      'a refusal fails the run, the way it does for sync --dry-run',
    );
  });

  it('shows the Canvas module a sync would refuse a folder for', async () => {
    // A module's folder is its name and its position, so two Canvas modules
    // agreeing on both derive the same one and only the first can have it.
    // `sync` refuses the second and exits 1; so does `sync --dry-run` over the
    // same course. Status used to preview that course as one module's worth of
    // work, say nothing about the second, and exit 0 — a preview of a run it
    // does not resemble, on the one fact an author needs it for.
    const out = silence();
    const courseDir = tempDir({});
    const file = stateFile({ modules: {} });
    mockCanvas([
      { method: 'GET', path: '/modules/10/items', body: [ITEM] },
      { method: 'GET', path: '/modules/20/items', body: [SECOND_ITEM] },
      {
        method: 'GET',
        path: '/modules',
        body: [
          { id: 10, name: 'Intro', position: 1 },
          { id: 20, name: 'Intro', position: 1 },
        ],
      },
      { method: 'GET', path: '/pages/welcome', body: PAGE },
      { method: 'GET', path: '/pages/second', body: SECOND_PAGE },
      {
        method: 'GET',
        path: '/pages',
        body: [PAGE, SECOND_PAGE].map(pageRow),
      },
    ]);

    await status({ courseDir, syncFile: file, gitDirty: CLEAN });

    const text = printed(out);
    assert.match(text, /^Skipped$/m);
    assert.match(text, /01-intro \(folder-taken\)/);
    assert.match(text, /Rename or renumber one of them in Canvas/);
    // The module that does have the folder is still previewed as the work it
    // is, so the refusal is an addition to the report and not a replacement.
    assert.match(text, /Locally: 1 module created/);
    assert.equal(
      process.exitCode,
      1,
      'a refusal fails the run, the way it does for sync --dry-run',
    );

    // `readdirSync` rather than `snapshot`, which lists files only: the write
    // this refusal is about is a *folder* being created.
    assert.deepEqual(
      fs.readdirSync(courseDir),
      [],
      'status put something in the tree',
    );
  });

  it('writes to neither side, with work waiting in both directions', async () => {
    // The whole promise of the command, asserted rather than taken on trust
    // from the policy: one file edited here, another edited on Canvas, so a
    // status that leaked a write would have one to make in either direction.
    const out = silence();
    const { courseDir, file } = syncedFixture();
    write(
      courseDir,
      WELCOME,
      '---\ntitle: Welcome\ncanvas_type: page\n---\n\nEdited here.\n',
    );
    const movedPage = {
      ...SECOND_PAGE,
      body: '<p>Edited in Canvas.</p>',
      updated_at: '2026-08-20T13:00:00.000Z',
    };
    const before = snapshot(courseDir);
    const stateBefore = fs.readFileSync(file, 'utf8');
    const calls = mockCanvas(
      readRoutes({ pages: [PAGE, movedPage], fetch: [movedPage] }),
    );

    await status({ courseDir, syncFile: file, gitDirty: CLEAN });

    assert.deepEqual(writes(calls), [], 'status issues no request but a read');
    assert.deepEqual(snapshot(courseDir), before, 'the tree is untouched');
    assert.equal(
      fs.readFileSync(file, 'utf8'),
      stateBefore,
      'and so is the sync state, which nothing here saves',
    );
    const text = printed(out);
    assert.match(text, /Canvas: 1 item updated/);
    assert.match(text, /Locally: 1 item updated/);
  });

  it('names the winner of a two-sided change without settling it', async () => {
    // The state a course spends most of its contested life in, and the reason
    // the exit code does not fail on it: `newest` picks a side, but neither
    // side is written here, so both are still exactly as the author left them.
    const out = silence();
    const { courseDir, file } = syncedFixture();
    write(
      courseDir,
      WELCOME,
      '---\ntitle: Welcome\ncanvas_type: page\n---\n\nEdited here.\n',
    );
    const alsoEdited = {
      ...PAGE,
      body: '<p>Edited in Canvas.</p>',
      updated_at: '2026-08-20T13:00:00.000Z',
    };
    mockCanvas(
      readRoutes({ pages: [alsoEdited, SECOND_PAGE], fetch: [alsoEdited] }),
    );

    await status({ courseDir, syncFile: file, gitDirty: CLEAN });

    const text = printed(out);
    assert.match(
      text,
      /01-intro\/01-welcome\.md \(conflict-unwritten\): local would have won/,
    );
    assert.match(text, /Run `npx course sync` to settle it/);
    assert.equal(process.exitCode, 0, 'a course mid-edit is not a failure');
  });

  it('reports the plan as a preview, never as work done', async () => {
    const out = silence();
    const { courseDir, file } = syncedFixture();
    write(
      courseDir,
      WELCOME,
      '---\ntitle: Welcome\ncanvas_type: page\n---\n\nEdited here.\n',
    );
    mockCanvas(readRoutes());

    await status({ courseDir, syncFile: file, gitDirty: CLEAN });

    const text = printed(out);
    assert.match(
      text,
      /What `npx course sync` would do\. Status wrote nothing/,
    );
    assert.doesNotMatch(text, /^Applied$/m);
  });
});

// ---------------------------------------------------------------------------
// The mtime bug
// ---------------------------------------------------------------------------

describe('npx course status, on a freshly cloned tree', () => {
  it('reports nothing when every file was checked out just now', async () => {
    // The regression guard this rewrite exists for. `git clone` stamps every
    // file with the checkout time, so every mtime is newer than `last_sync`,
    // and the old command called all of them modified. Content is what decides
    // now, and none of it changed.
    const out = silence();
    const { courseDir, file } = syncedFixture();
    touchAll(courseDir);
    assert.ok(
      fs.statSync(path.join(courseDir, WELCOME)).mtime >
        new Date(JSON.parse(fs.readFileSync(file, 'utf8')).last_sync),
      'the fixture has to reproduce the condition it guards against',
    );
    mockCanvas(readRoutes());

    await status({ courseDir, syncFile: file, gitDirty: CLEAN });

    assert.match(printed(out), /Nothing to do/);
    assert.doesNotMatch(printed(out), /Would apply|Left alone/);
  });

  it('still reports the one file whose contents really did change', async () => {
    // The control for the test above: "reports nothing" has to mean "found
    // nothing", not "cannot see anything".
    const { courseDir, file } = syncedFixture();
    write(
      courseDir,
      SECOND,
      '---\ntitle: Second\ncanvas_type: page\n---\n\nRewritten.\n',
    );
    touchAll(courseDir);
    const out = silence();
    mockCanvas(readRoutes());

    await status({ courseDir, syncFile: file, gitDirty: CLEAN });

    const text = printed(out);
    assert.match(text, /Canvas: 1 item updated/);
    assert.doesNotMatch(text, /2 items updated/);
  });
});

// ---------------------------------------------------------------------------
// Scoping, and the two ways of not reaching Canvas
// ---------------------------------------------------------------------------

describe('npx course status, when it cannot answer', () => {
  it('says why it needs a course id rather than reporting offline', async () => {
    const out = silence();
    const { courseDir, file } = syncedFixture();
    const original = process.env.CANVAS_COURSE_ID;
    delete process.env.CANVAS_COURSE_ID;
    try {
      await status({ courseDir, syncFile: file, gitDirty: CLEAN });
    } finally {
      process.env.CANVAS_COURSE_ID = original;
    }

    assert.match(errored(out), /CANVAS_COURSE_ID is not set/);
    assert.match(errored(out), /reports what a sync would do/);
    assert.equal(process.exitCode, 1);
  });

  it('says why a course it cannot read leaves it with no answer', async () => {
    const out = silence();
    const { courseDir, file } = syncedFixture();
    // No routes at all: the mock answers every request with a 400, which is
    // what an unreachable or forbidden course looks like from here.
    mockCanvas([]);

    await status({ courseDir, syncFile: file, gitDirty: CLEAN });

    assert.match(errored(out), /could not read Canvas course 4242/);
    assert.match(errored(out), /reports what a sync would do/);
    assert.doesNotMatch(printed(out), /Nothing to do/);
    assert.equal(process.exitCode, 1);
  });

  it('refuses a -m naming a module neither side has heard of', async () => {
    const out = silence();
    const { courseDir, file } = syncedFixture();
    mockCanvas(readRoutes());

    await status({
      courseDir,
      syncFile: file,
      gitDirty: CLEAN,
      module: ['02-typo'],
    });

    assert.match(errored(out), /no module named 02-typo/);
    assert.equal(process.exitCode, 1);
  });

  it('refuses a -m number neither side has heard of', async () => {
    const out = silence();
    const { courseDir, file } = syncedFixture();
    mockCanvas(readRoutes());

    await status({
      courseDir,
      syncFile: file,
      gitDirty: CLEAN,
      module: ['09'],
    });

    assert.match(errored(out), /\[status\] Error: Module not found: 09/);
    assert.equal(process.exitCode, 1);
  });

  for (const [how, selector] of [
    ['by folder name', ['01-intro']],
    ['by number', ['1']],
  ]) {
    it(`scopes the preview to the module -m names (${how})`, async () => {
      const out = silence();
      const { courseDir, file } = syncedFixture();
      fs.mkdirSync(path.join(courseDir, '02-later'), { recursive: true });
      write(
        courseDir,
        '02-later/_category_.json',
        '{ "label": "Later", "position": 2 }\n',
      );
      write(
        courseDir,
        '02-later/01-draft.md',
        '---\ntitle: Draft\ncanvas_type: page\n---\n\nNot pushed yet.\n',
      );
      mockCanvas(readRoutes());

      await status({
        courseDir,
        syncFile: file,
        gitDirty: CLEAN,
        module: selector,
      });

      assert.match(
        printed(out),
        /Nothing to do/,
        'the unsynced second module is out of scope, so there is nothing to say',
      );
      assert.equal(process.exitCode, 0);
    });
  }
});
