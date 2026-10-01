const { describe, it, mock, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { mockCanvas, silence } = require('../helpers/canvas-mock');
const {
  npmRunFormat,
  prettierCheck,
  seedPrettierConfig,
} = require('../helpers/prettier-config');

process.env.CANVAS_API_URL = 'https://canvas.example.com';
process.env.CANVAS_API_TOKEN = 'test-token-123';

const { applyPlan } = require('../../lib/sync/apply');
const { parseFrontmatter } = require('../../lib/convert/frontmatter');
const { plan } = require('../../lib/sync/plan');
const {
  gatherCanvas,
  gatherLocal,
  localFileHash,
} = require('../../lib/sync/gather');
const {
  canvasFingerprint,
  hashLocalFile,
  legacyFileFingerprint,
} = require('../../lib/sync/fingerprint');
const { buildReport } = require('../../cli/report');

const COURSE_ID = 4242;
const CLEAN = { available: true, paths: new Set(), reason: null };

afterEach(() => mock.restoreAll());

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function tempCourse(tree = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apply-plan-test-'));
  seedPrettierConfig(dir);
  for (const [relative, contents] of Object.entries(tree)) {
    const full = path.join(dir, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents, 'utf8');
  }
  return dir;
}

function emptyState() {
  return {
    schema_version: 4,
    canvas_base_url: 'https://canvas.example.com',
    course_id: COURSE_ID,
    last_sync: null,
    modules: {},
    // Icons already uploaded, which is what every course looks like after its
    // first sync. A test about the icons themselves clears this.
    icons: recordedIcons(),
    files: {},
  };
}

/** Run a plan against the mock, never touching the real sync file. */
function run(planned, options) {
  return applyPlan(planned, {
    courseId: COURSE_ID,
    save: () => {},
    now: () => '2026-08-20T12:00:00.000Z',
    ...options,
  });
}

const { ICON_FILES } = require('../../lib/convert/alert-icons');
const { loadTheme, themeFingerprint } = require('../../lib/config/theme');

const ICON_COUNT = Object.keys(ICON_FILES).length;

/**
 * The two hops a Canvas file upload takes, per icon: the grant, then the form
 * post to the URL the grant named.
 */
function iconUploadRoutes() {
  const routes = [];
  Object.keys(ICON_FILES).forEach((type, index) => {
    routes.push({
      method: 'POST',
      path: '/courses/4242/files',
      body: {
        upload_url: `https://canvas.example.com/upload/${type}`,
        upload_params: {},
      },
    });
    routes.push({
      method: 'POST',
      path: `/upload/${type}`,
      body: { id: 900 + index, display_name: ICON_FILES[type] },
    });
  });
  return routes;
}

/** Icons already recorded under the theme this repo is configured with. */
function recordedIcons() {
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

function calledWith(calls, method, fragment) {
  return calls.filter(
    (call) => call.method === method && call.url.includes(fragment),
  );
}

// ---------------------------------------------------------------------------
// The fingerprint invariant — the reason this file exists
// ---------------------------------------------------------------------------

describe('the fingerprint invariant, Canvas direction', () => {
  it('records both hashes after a Canvas write, so the next plan is empty', async () => {
    silence();
    const courseDir = tempCourse({
      '01-intro/_category_.json': '{ "label": "Intro", "position": 1 }\n',
      '01-intro/01-welcome.md': '---\ntitle: Welcome\n---\n\nHello there.\n',
    });
    const state = emptyState();

    // --- The course is on Canvas but nothing of it is ------------------------
    mockCanvas([{ method: 'GET', path: '/modules', body: [] }]);
    const local = gatherLocal({ courseDir, gitDirty: CLEAN });
    let canvas = await gatherCanvas({ courseId: COURSE_ID, base: state });
    const first = plan({ base: state, local, canvas });
    assert.deepEqual(
      first.actions.map((action) => action.type),
      ['create-canvas-module', 'create-canvas-item'],
    );

    // --- Execute -------------------------------------------------------------
    mock.restoreAll();
    const createdPage = {
      page_id: 501,
      url: 'welcome',
      title: 'Welcome',
      body: '<p>Hello there.</p>',
      updated_at: '2026-08-20T11:00:00.000Z',
    };
    const createdItem = {
      id: 91,
      type: 'Page',
      title: 'Welcome',
      page_url: 'welcome',
      content_id: 501,
      position: 1,
      indent: 0,
    };
    mockCanvas([
      { method: 'POST', path: '/modules/10/items', body: createdItem },
      {
        method: 'POST',
        path: '/modules',
        body: { id: 10, name: 'Intro', position: 1 },
      },
      { method: 'POST', path: '/pages', body: createdPage },
    ]);
    const outcome = await run(first, {
      courseDir,
      state,
      canvasContent: canvas.content,
    });
    assert.deepEqual(outcome.errors, []);

    const row = state.modules['01-intro'].items['01-intro/01-welcome.md'];
    assert.ok(row.local_hash, 'no local_hash was recorded');
    assert.ok(row.canvas_hash, 'no canvas_hash was recorded');
    assert.equal(row.canvas_updated_at, '2026-08-20T11:00:00.000Z');
    assert.equal(row.synced_at, '2026-08-20T12:00:00.000Z');
    assert.equal(row.module_item_id, 91);
    assert.equal(row.canvas_id, 501);
    assert.equal(row.page_url, 'welcome');

    // --- A sync straight after a sync ---------------------------------------
    // `base: null` deliberately defeats the page pre-filter, so the Canvas hash
    // is recomputed from a real fetch rather than read back out of the row this
    // run just wrote. That is what proves the two agree.
    mock.restoreAll();
    mockCanvas([
      { method: 'GET', path: '/modules/10/items', body: [createdItem] },
      {
        method: 'GET',
        path: '/modules',
        body: [{ id: 10, name: 'Intro', position: 1 }],
      },
      { method: 'GET', path: '/pages/welcome', body: createdPage },
      {
        method: 'GET',
        path: '/pages',
        body: [
          {
            page_id: 501,
            url: 'welcome',
            title: 'Welcome',
            updated_at: createdPage.updated_at,
          },
        ],
      },
    ]);
    canvas = await gatherCanvas({ courseId: COURSE_ID, base: null });
    const again = plan({
      base: state,
      local: gatherLocal({ courseDir, gitDirty: CLEAN }),
      canvas,
    });

    assert.deepEqual(again.actions, [], 'a sync after a sync must do nothing');
    assert.deepEqual(again.conflicts, []);
    assert.deepEqual(again.skipped, []);
  });
});

describe('the fingerprint invariant, local direction', () => {
  it('records both hashes after a local write, so the next plan is empty', async () => {
    silence();
    const courseDir = tempCourse();
    const state = emptyState();

    const page = {
      page_id: 501,
      url: 'welcome',
      title: 'Welcome',
      body: '<p>Hello there.</p>',
      updated_at: '2026-08-20T11:00:00.000Z',
    };
    const item = {
      id: 91,
      type: 'Page',
      title: 'Welcome',
      page_url: 'welcome',
      content_id: 501,
      position: 1,
      indent: 0,
    };
    const canvasRoutes = () => [
      { method: 'GET', path: '/modules/10/items', body: [item] },
      {
        method: 'GET',
        path: '/modules',
        body: [{ id: 10, name: 'Intro', position: 1 }],
      },
      { method: 'GET', path: '/pages/welcome', body: page },
      {
        method: 'GET',
        path: '/pages',
        body: [
          {
            page_id: 501,
            url: 'welcome',
            title: 'Welcome',
            updated_at: page.updated_at,
          },
        ],
      },
    ];

    mockCanvas(canvasRoutes());
    let canvas = await gatherCanvas({ courseId: COURSE_ID, base: state });
    const first = plan({
      base: state,
      local: gatherLocal({ courseDir, gitDirty: CLEAN }),
      canvas,
    });
    assert.deepEqual(
      first.actions.map((action) => action.type),
      ['create-local-module', 'create-local-item'],
    );

    // Nothing more is fetched: the content the gather already read is handed
    // to the executor rather than asked for a second time.
    const outcome = await run(first, {
      courseDir,
      state,
      canvasContent: canvas.content,
    });
    assert.deepEqual(outcome.errors, []);

    const written = path.join(courseDir, '01-intro/01-welcome.md');
    assert.ok(fs.existsSync(written), 'the item was not written');
    // A file sync created carries its title explicitly, so that renaming it
    // later cannot rename the Canvas item behind it.
    assert.match(fs.readFileSync(written, 'utf8'), /^---\ntitle: Welcome\n/);
    const row = state.modules['01-intro'].items['01-intro/01-welcome.md'];
    assert.ok(row.local_hash);
    assert.equal(row.canvas_hash, canvas.modules[0].items[0].canvasHash);
    assert.equal(row.canvas_updated_at, page.updated_at);
    assert.equal(row.synced_at, '2026-08-20T12:00:00.000Z');

    mock.restoreAll();
    mockCanvas(canvasRoutes());
    canvas = await gatherCanvas({ courseId: COURSE_ID, base: null });
    const again = plan({
      base: state,
      local: gatherLocal({ courseDir, gitDirty: CLEAN }),
      canvas,
    });

    assert.deepEqual(again.actions, [], 'a sync after a sync must do nothing');
    assert.deepEqual(again.skipped, []);
  });
});

/**
 * The formatting half of the same invariant.
 *
 * Prettier owns the shape of every markdown file in this repo and
 * `.prettierrc.json` sets `proseWrap: "always"`. Turndown wraps nothing, so a
 * pull used to write a file the next `npm run format` would immediately
 * rewrite — and rewriting it moved the file off the `local_hash` the pull had
 * just recorded. The next sync then read the item as changed locally and
 * pushed it back, producing byte-identical HTML on Canvas and a phantom local
 * change in every report until someone did.
 *
 * Nothing here asserts a particular wrapping. What is asserted is agreement:
 * the bytes the pull wrote are the bytes `npm run format` would leave, and the
 * row describes those bytes and not the ones on their way to them.
 */
describe('a pull writes what `npm run format` would leave', () => {
  /** One long Canvas paragraph, which turndown hands over as one long line. */
  const PROSE =
    'Dit is een paragraaf die van Canvas komt en die turndown op één lange ' +
    'regel zet, ver over de tachtig tekens, zoals elke gepulde pagina ' +
    'eruitziet zolang niemand hem herwikkelt.';

  const page = {
    page_id: 501,
    url: 'welcome',
    title: 'Welcome',
    body: `<p>${PROSE}</p>`,
    updated_at: '2026-08-20T11:00:00.000Z',
  };
  const item = {
    id: 91,
    type: 'Page',
    title: 'Welcome',
    page_url: 'welcome',
    content_id: 501,
    position: 1,
    indent: 0,
  };
  const canvasRoutes = () => [
    { method: 'GET', path: '/modules/10/items', body: [item] },
    {
      method: 'GET',
      path: '/modules',
      body: [{ id: 10, name: 'Intro', position: 1 }],
    },
    { method: 'GET', path: '/pages/welcome', body: page },
    {
      method: 'GET',
      path: '/pages',
      body: [
        {
          page_id: 501,
          url: 'welcome',
          title: 'Welcome',
          updated_at: page.updated_at,
        },
      ],
    },
  ];

  /** Pull the page above into a fresh tree and hand back where it landed. */
  async function pullOnce(courseDir, state) {
    mockCanvas(canvasRoutes());
    const canvas = await gatherCanvas({ courseId: COURSE_ID, base: state });
    const first = plan({
      base: state,
      local: gatherLocal({ courseDir, gitDirty: CLEAN }),
      canvas,
    });
    assert.deepEqual(
      first.actions.map((action) => action.type),
      ['create-local-module', 'create-local-item'],
    );
    const outcome = await run(first, {
      courseDir,
      state,
      canvasContent: canvas.content,
    });
    assert.deepEqual(outcome.errors, []);
    return path.join(courseDir, '01-intro/01-welcome.md');
  }

  it('leaves the file clean under the Prettier the repo runs', async () => {
    silence();
    const courseDir = tempCourse();
    const written = await pullOnce(courseDir, emptyState());

    // Checked by running the binary, not the API this tool calls: the claim is
    // about `npm run format`, and asking the same call that wrote the file
    // whether it likes the file would prove nothing.
    assert.equal(prettierCheck(courseDir, written), true);
    // And it really was rewrapped, so the check above is not passing on a file
    // that had nothing to fix. Turndown hands the paragraph over as one line of
    // 177 characters; every line on disk is inside the print width.
    const lines = fs.readFileSync(written, 'utf8').split('\n');
    assert.ok(
      lines.every((line) => line.length <= 80),
      `a line ran over the print width: ${JSON.stringify(lines)}`,
    );
    assert.ok(
      lines.filter(
        (line) => line.startsWith('Dit is') || line.startsWith('ver'),
      ).length === 2,
      `the prose was not wrapped at all: ${JSON.stringify(lines)}`,
    );
  });

  it('writes exactly what `npm run format` would produce', async () => {
    silence();
    // The property the whole change rests on, asserted directly rather than
    // inferred from the two halves agreeing about `--check`.
    const courseDir = tempCourse();
    const written = await pullOnce(courseDir, emptyState());

    assert.equal(
      fs.readFileSync(written, 'utf8'),
      npmRunFormat(courseDir, written),
    );
  });

  it('records the hash of the formatted bytes, so the next run is empty', async () => {
    silence();
    // Format first, hash second. Get it the other way round and the row
    // describes a file that never existed on disk, the next gather reads the
    // item as changed locally, and the defect is back one line down from where
    // it was.
    const courseDir = tempCourse();
    const state = emptyState();
    const written = await pullOnce(courseDir, state);

    assert.equal(
      state.modules['01-intro'].items['01-intro/01-welcome.md'].local_hash,
      hashLocalFile(written),
      'the row does not describe the bytes on disk',
    );

    mock.restoreAll();
    mockCanvas(canvasRoutes());
    const again = plan({
      base: state,
      local: gatherLocal({ courseDir, gitDirty: CLEAN }),
      canvas: await gatherCanvas({ courseId: COURSE_ID, base: null }),
    });
    assert.deepEqual(
      again.actions,
      [],
      'the pull left a change behind for the next run to push back',
    );
    assert.deepEqual(again.conflicts, []);
    assert.deepEqual(again.skipped, []);
  });

  /** The first push of a file the author wrote, through plan and apply. */
  async function pushOne(courseDir, state) {
    mockCanvas([{ method: 'GET', path: '/modules', body: [] }]);
    const first = plan({
      base: state,
      local: gatherLocal({ courseDir, gitDirty: CLEAN }),
      canvas: await gatherCanvas({ courseId: COURSE_ID, base: state }),
    });
    assert.deepEqual(
      first.actions.map((action) => action.type),
      ['create-canvas-module', 'create-canvas-item'],
    );

    mock.restoreAll();
    mockCanvas([
      { method: 'POST', path: '/modules', body: { id: 10, position: 1 } },
      {
        method: 'POST',
        path: '/pages',
        body: { page_id: 501, url: 'welcome', title: 'Welcome' },
      },
      { method: 'POST', path: '/modules/10/items', body: { ...item } },
    ]);
    const outcome = await run(first, { courseDir, state });
    assert.deepEqual(outcome.errors, []);
    return outcome;
  }

  it('keeps the file clean through the title a push writes into it', async () => {
    silence();
    // `writeTitleIfAbsent` is the one write that happens to a file the author
    // wrote, on the very first push of it. A clean file has to survive it
    // clean: the row is recorded from a re-read, so a file this left in a
    // shape `npm run format` disagrees with would read as a local change the
    // moment anybody formatted the tree.
    const wrapped =
      'Een korte regel die ruim onder de tachtig tekens blijft.\n';
    const courseDir = tempCourse({
      '01-intro/_category_.json': '{ "label": "Intro", "position": 1 }\n',
      '01-intro/01-welcome.md': wrapped,
    });
    const state = emptyState();
    const welcome = path.join(courseDir, '01-intro/01-welcome.md');
    assert.equal(
      prettierCheck(courseDir, welcome),
      true,
      'the fixture has to start out clean or this proves nothing',
    );

    await pushOne(courseDir, state);

    assert.match(
      fs.readFileSync(welcome, 'utf8'),
      /^title: Welcome$/m,
      'the title never reached the file, so this proves nothing',
    );
    assert.equal(prettierCheck(courseDir, welcome), true);
    assert.equal(
      state.modules['01-intro'].items['01-intro/01-welcome.md'].local_hash,
      hashLocalFile(welcome),
    );
  });

  it('leaves an unformatted file exactly as unformatted as it found it', async () => {
    silence();
    // The other side of the same rule, and the one it is tempting to get
    // wrong. This write runs over a file the author wrote and this run has not
    // otherwise touched, so reformatting it is sync editing their prose
    // unasked — the same class of thing as deleting a comment out of their
    // frontmatter. And it buys nothing: `.prettierrc.json` sets
    // `embeddedLanguageFormatting: "off"`, so Prettier never looks at
    // frontmatter, and the added line cannot move `prettier --check` either
    // way. The file was failing it before this run and is failing it after,
    // for the author's own reason.
    const unwrapped = `${PROSE}\n`;
    const courseDir = tempCourse({
      '01-intro/_category_.json': '{ "label": "Intro", "position": 1 }\n',
      '01-intro/01-welcome.md': unwrapped,
    });
    const state = emptyState();
    const welcome = path.join(courseDir, '01-intro/01-welcome.md');
    assert.notEqual(
      prettierCheck(courseDir, welcome),
      true,
      'the fixture has to start out unformatted or this proves nothing',
    );

    await pushOne(courseDir, state);

    assert.equal(
      fs.readFileSync(welcome, 'utf8'),
      `---\ntitle: Welcome\n---\n\n${unwrapped}`,
      'one line added and not a byte else',
    );
    assert.equal(
      state.modules['01-intro'].items['01-intro/01-welcome.md'].local_hash,
      hashLocalFile(welcome),
      'the row still describes what is on disk',
    );
  });
});

describe('the fingerprint invariant, a file item and its binary', () => {
  it('is silent on the second run and speaks up when the binary moves', async () => {
    silence();
    // Two runs and then a third, because either half alone can be had cheaply
    // and wrongly. A fingerprint that ignores the binary is quiet on run two
    // and stays quiet after the edit; one that gather and apply spell
    // differently notices the edit and also re-pushes the item for ever.
    const courseDir = tempCourse({
      '01-intro/_category_.json': '{ "label": "Intro", "position": 1 }\n',
      '01-intro/03-syllabus.md':
        '---\ntitle: Syllabus\ncanvas_type: file\nfile_ref: _files/handbook.pdf\n---\n',
      '01-intro/_files/handbook.pdf': 'last year’s handbook',
    });
    const state = emptyState();

    const uploaded = {
      id: 770,
      display_name: 'handbook.pdf',
      size: 20,
      updated_at: '2026-08-20T11:00:00.000Z',
    };
    const item = {
      id: 91,
      type: 'File',
      title: 'Syllabus',
      content_id: 770,
      position: 1,
      indent: 0,
    };
    // The order matters: `/modules` is a substring of `/modules/10/items`, so
    // the specific route has to be offered to the matcher first.
    const canvasReads = () => [
      { method: 'GET', path: '/modules/10/items', body: [item] },
      {
        method: 'GET',
        path: '/modules',
        body: [{ id: 10, name: 'Intro', position: 1 }],
      },
      { method: 'GET', path: '/api/v1/files/770', body: uploaded },
    ];

    // --- Run one: the course is on Canvas and holds none of this -------------
    mockCanvas([{ method: 'GET', path: '/modules', body: [] }]);
    let canvas = await gatherCanvas({ courseId: COURSE_ID, base: state });
    const first = plan({
      base: state,
      local: gatherLocal({ courseDir, gitDirty: CLEAN }),
      canvas,
    });
    assert.deepEqual(
      first.actions.map((action) => action.type),
      ['create-canvas-module', 'create-canvas-item'],
    );

    mock.restoreAll();
    mockCanvas([
      { method: 'POST', path: '/modules/10/items', body: item },
      {
        method: 'POST',
        path: '/modules',
        body: { id: 10, name: 'Intro', position: 1 },
      },
      {
        method: 'POST',
        path: `/api/v1/courses/${COURSE_ID}/files`,
        body: {
          upload_url: 'https://canvas.example.com/upload/binary',
          upload_params: {},
        },
      },
      { method: 'POST', path: '/upload/binary', body: uploaded },
    ]);
    const outcome = await run(first, {
      courseDir,
      state,
      canvasContent: canvas.content,
    });
    assert.deepEqual(outcome.errors, []);

    // --- Run two: nothing was touched, so nothing may happen -----------------
    mock.restoreAll();
    const quiet = mockCanvas(canvasReads());
    canvas = await gatherCanvas({ courseId: COURSE_ID, base: null });
    const again = plan({
      base: state,
      local: gatherLocal({ courseDir, gitDirty: CLEAN }),
      canvas,
    });
    assert.deepEqual(again.actions, [], 'a sync after a sync must do nothing');
    assert.deepEqual(again.skipped, []);
    assert.deepEqual(
      quiet.filter((call) => call.method === 'POST'),
      [],
      'the second run uploaded something',
    );

    // --- Run three: this year's PDF, and nothing else, replaces last year's --
    mock.restoreAll();
    fs.writeFileSync(
      path.join(courseDir, '01-intro/_files/handbook.pdf'),
      'this year’s handbook!!',
      'utf8',
    );
    mockCanvas(canvasReads());
    const afterEdit = plan({
      base: state,
      local: gatherLocal({ courseDir, gitDirty: CLEAN }),
      canvas: await gatherCanvas({ courseId: COURSE_ID, base: null }),
    });
    assert.deepEqual(
      afterEdit.actions.map((action) => action.type),
      ['update-canvas-item'],
      'replacing the binary must reach Canvas',
    );
  });

  it('records the same fingerprint after pulling one, so the next plan is empty', async () => {
    silence();
    // The other direction, and the one a fix is easiest to leave half done in:
    // a pull writes a wrapper *and* downloads the binary, and records the row
    // itself rather than through `localHashOf`. Record the wrapper's text alone
    // there and the very next `gatherLocal` disagrees with the row this run
    // wrote — the item reads as changed locally for ever and every sync pushes
    // it back.
    const courseDir = tempCourse();
    const state = emptyState();

    const file = {
      id: 770,
      display_name: 'handbook.pdf',
      size: 14,
      updated_at: '2026-08-20T11:00:00.000Z',
      url: 'https://canvas.example.com/download/770',
    };
    const item = {
      id: 91,
      type: 'File',
      title: 'Syllabus',
      content_id: 770,
      position: 1,
      indent: 0,
    };
    const canvasReads = () => [
      { method: 'GET', path: '/modules/10/items', body: [item] },
      {
        method: 'GET',
        path: '/modules',
        body: [{ id: 10, name: 'Intro', position: 1 }],
      },
      { method: 'GET', path: '/api/v1/files/770', body: file },
    ];

    mockCanvas([
      ...canvasReads(),
      // A second metadata read plus the bytes: `downloadFile` asks Canvas where
      // the file is before fetching it.
      { method: 'GET', path: '/api/v1/files/770', body: file },
      { method: 'GET', path: '/download/770', body: 'handbook bytes' },
    ]);
    let canvas = await gatherCanvas({ courseId: COURSE_ID, base: state });
    const first = plan({
      base: state,
      local: gatherLocal({ courseDir, gitDirty: CLEAN }),
      canvas,
    });
    assert.deepEqual(
      first.actions.map((action) => action.type),
      ['create-local-module', 'create-local-item'],
    );

    const outcome = await run(first, {
      courseDir,
      state,
      canvasContent: canvas.content,
    });
    assert.deepEqual(outcome.errors, []);

    const wrapper = path.join(courseDir, '01-intro/01-syllabus.md');
    assert.match(
      fs.readFileSync(wrapper, 'utf8'),
      /file_ref: _files\/handbook\.pdf/,
    );
    assert.equal(
      fs.readFileSync(
        path.join(courseDir, '01-intro/_files/handbook.pdf'),
        'utf8',
      ),
      'handbook bytes',
    );

    mock.restoreAll();
    mockCanvas(canvasReads());
    canvas = await gatherCanvas({ courseId: COURSE_ID, base: null });
    const again = plan({
      base: state,
      local: gatherLocal({ courseDir, gitDirty: CLEAN }),
      canvas,
    });

    assert.deepEqual(again.actions, [], 'a sync after a pull must do nothing');
    assert.deepEqual(again.skipped, []);
  });

  it('is silent after Canvas locks the file with its module, and not after a replacement', async () => {
    silence();
    // Measured on a Canvas sandbox: unpublishing a module locks every file in
    // it and moves each file's `updated_at`, publishing it again unlocks them
    // and moves it once more, and `modified_at` stays where the upload left
    // it. With `updated_at` in the fingerprint, one publish click made every
    // file item in the module read as changed on Canvas, and the next pull or
    // sync downloaded each binary again. Push records the upload response, so
    // this is the whole round trip: the row it writes has to agree with the
    // locked file the next gather reads.
    const courseDir = tempCourse({
      '01-intro/_category_.json': '{ "label": "Intro", "position": 1 }\n',
      '01-intro/01-syllabus.md':
        '---\ntitle: Syllabus\ncanvas_type: file\nfile_ref: _files/handbook.pdf\n---\n',
      '01-intro/_files/handbook.pdf': 'this year’s handbook',
    });
    const state = emptyState();

    const uploaded = {
      id: 770,
      display_name: 'handbook.pdf',
      size: 22,
      locked: false,
      modified_at: '2026-10-01T09:00:00Z',
      updated_at: '2026-10-01T09:00:00Z',
    };
    const item = {
      id: 91,
      type: 'File',
      title: 'Syllabus',
      content_id: 770,
      position: 1,
      indent: 0,
    };
    const canvasReads = (file) => [
      { method: 'GET', path: '/modules/10/items', body: [item] },
      {
        method: 'GET',
        path: '/modules',
        body: [{ id: 10, name: 'Intro', position: 1 }],
      },
      { method: 'GET', path: '/api/v1/files/770', body: file },
    ];
    const planAgainst = async (file) => {
      mock.restoreAll();
      mockCanvas(canvasReads(file));
      return plan({
        base: state,
        local: gatherLocal({ courseDir, gitDirty: CLEAN }),
        canvas: await gatherCanvas({ courseId: COURSE_ID, base: state }),
      });
    };

    // --- Run one: push the item, which records the upload response ---------
    mockCanvas([{ method: 'GET', path: '/modules', body: [] }]);
    const canvas = await gatherCanvas({ courseId: COURSE_ID, base: state });
    const first = plan({
      base: state,
      local: gatherLocal({ courseDir, gitDirty: CLEAN }),
      canvas,
    });
    mock.restoreAll();
    mockCanvas([
      { method: 'POST', path: '/modules/10/items', body: item },
      {
        method: 'POST',
        path: '/modules',
        body: { id: 10, name: 'Intro', position: 1 },
      },
      {
        method: 'POST',
        path: `/api/v1/courses/${COURSE_ID}/files`,
        body: {
          upload_url: 'https://canvas.example.com/upload/binary',
          upload_params: {},
        },
      },
      { method: 'POST', path: '/upload/binary', body: uploaded },
    ]);
    const outcome = await run(first, {
      courseDir,
      state,
      canvasContent: canvas.content,
    });
    assert.deepEqual(outcome.errors, []);
    assert.equal(
      state.modules['01-intro'].items['01-intro/01-syllabus.md']
        .canvas_updated_at,
      '2026-10-01T09:00:00Z',
      'the row records the clock the fingerprint reads, not updated_at',
    );

    // --- Run two: the module was unpublished, so Canvas locked the file -----
    const locked = await planAgainst({
      ...uploaded,
      locked: true,
      updated_at: '2026-10-01T09:05:00Z',
    });
    assert.deepEqual(locked.actions, [], 'a publish click is not an edit');
    assert.deepEqual(locked.skipped, []);

    // --- Run three: published again, unlocked, updated_at moved once more ---
    const unlocked = await planAgainst({
      ...uploaded,
      locked: false,
      updated_at: '2026-10-01T09:06:00Z',
    });
    assert.deepEqual(unlocked.actions, []);

    // --- Run four: someone replaced the file in Canvas, at the same size ----
    const replaced = await planAgainst({
      ...uploaded,
      modified_at: '2026-10-02T09:00:00Z',
      updated_at: '2026-10-02T09:00:00Z',
    });
    assert.deepEqual(
      replaced.actions.map((action) => action.type),
      ['update-local-item'],
      'a replaced file still has to come down',
    );
    assert.equal(replaced.actions[0].canvasUpdatedAt, '2026-10-02T09:00:00Z');
  });
});

describe('a file item recorded under the 1.5.1 fingerprint', () => {
  // The 1.5.2 migration bridge, end to end. 1.5.1 hashed a file's
  // `updated_at` and 1.5.2 hashes its `modified_at`, so every file item's
  // stored `canvas_hash` stops matching the moment a course updates. Without
  // the bridge the first run read each one as changed on Canvas: a pull or a
  // sync downloaded every binary again, a push listed every one as left
  // alone, and a file item deleted here became a decision nothing could
  // prune. The row below is what 1.5.1 wrote, for a file Canvas has not
  // touched since.
  const WRAPPER = '01-intro/01-syllabus.md';
  const WRAPPER_TEXT =
    "---\ntitle: 'Syllabus'\ncanvas_type: file\nfile_ref: _files/handbook.pdf\n---\n";
  const BINARY = '01-intro/_files/handbook.pdf';
  const BYTES = 'this year’s handbook';
  const SYNCED_AT = '2026-09-30T12:00:00.000Z';

  const file = {
    id: 770,
    display_name: 'handbook.pdf',
    size: 22,
    locked: false,
    modified_at: '2026-10-01T09:00:00Z',
    updated_at: '2026-10-01T09:30:00Z',
  };
  const item = {
    id: 91,
    type: 'File',
    title: 'Syllabus',
    content_id: 770,
    position: 1,
    indent: 0,
  };

  const PUSH = {
    write: { canvas: true, local: false },
    conflict: 'local',
    adopt: 'local',
  };
  const PULL = {
    write: { canvas: false, local: true },
    conflict: 'canvas',
    adopt: 'canvas',
  };

  function setup() {
    const courseDir = tempCourse({
      '01-intro/_category_.json': '{ "label": "Intro", "position": 1 }\n',
      [WRAPPER]: WRAPPER_TEXT,
      [BINARY]: BYTES,
    });
    const state = emptyState();
    state.modules['01-intro'] = {
      canvas_module_id: 10,
      name: 'Intro',
      position: 1,
      item_order: [WRAPPER],
      items: {
        [WRAPPER]: {
          canvas_type: 'file',
          canvas_id: 770,
          module_item_id: 91,
          title: 'Syllabus',
          indent: 0,
          local_hash: localFileHash(path.join(courseDir, WRAPPER), WRAPPER),
          canvas_hash: legacyFileFingerprint({ item, content: file }),
          canvas_updated_at: file.updated_at,
          synced_at: SYNCED_AT,
        },
      },
    };
    return { courseDir, state };
  }

  function canvasReads(fileObject = file) {
    return [
      { method: 'GET', path: '/modules/10/items', body: [item] },
      {
        method: 'GET',
        path: '/modules',
        body: [{ id: 10, name: 'Intro', position: 1 }],
      },
      { method: 'GET', path: '/api/v1/files/770', body: fileObject },
    ];
  }

  async function planAgainst({ courseDir, state }, policy, fileObject = file) {
    mock.restoreAll();
    mockCanvas(canvasReads(fileObject));
    const canvas = await gatherCanvas({ courseId: COURSE_ID, base: state });
    const planned = plan({
      base: state,
      local: gatherLocal({ courseDir, gitDirty: CLEAN }),
      canvas,
      policy,
    });
    return { planned, canvas };
  }

  const rowOf = (state) => state.modules['01-intro'].items[WRAPPER];

  for (const [name, policy] of [
    ['sync', {}],
    ['push', PUSH],
    ['pull', PULL],
  ]) {
    it(`${name}: records the new fingerprint and touches nothing else`, async () => {
      silence();
      const course = setup();
      const { courseDir, state } = course;

      const { planned, canvas } = await planAgainst(course, policy);
      assert.deepEqual(
        planned.actions.map((action) => action.type),
        ['refresh-base-hash'],
      );
      assert.deepEqual(planned.withheld, []);
      assert.deepEqual(planned.decisions, []);

      // No route at all: a request of any kind fails the action.
      mock.restoreAll();
      const calls = mockCanvas([]);
      const outcome = await run(planned, {
        courseDir,
        state,
        gitDirty: CLEAN,
        canvasContent: canvas.content,
      });
      assert.deepEqual(outcome.errors, []);
      assert.deepEqual(calls, [], 'nothing may reach Canvas');
      assert.deepEqual(
        buildReport(planned, { applied: outcome.applied }),
        [],
        'the report must read as a run with nothing to do',
      );

      const row = rowOf(state);
      assert.equal(
        row.canvas_hash,
        canvasFingerprint({ item, content: file }, 'file'),
      );
      assert.equal(row.canvas_updated_at, '2026-10-01T09:00:00Z');
      assert.equal(row.synced_at, SYNCED_AT, 'nothing synced, so no stamp');
      assert.equal(
        fs.readFileSync(path.join(courseDir, WRAPPER), 'utf8'),
        WRAPPER_TEXT,
      );
      assert.equal(
        fs.readFileSync(path.join(courseDir, BINARY), 'utf8'),
        BYTES,
      );

      // The next run has nothing left to bridge.
      const again = await planAgainst(course, policy);
      assert.deepEqual(again.planned.actions, []);

      // And the fix itself: Canvas locks the file with its module.
      const locked = await planAgainst(course, policy, {
        ...file,
        locked: true,
        updated_at: '2026-10-01T10:00:00Z',
      });
      assert.deepEqual(locked.planned.actions, []);
      assert.deepEqual(locked.planned.withheld, []);
    });
  }

  it('pushes a binary replaced here as an ordinary update, and keeps the upload’s record', async () => {
    silence();
    const course = setup();
    const { courseDir, state } = course;
    fs.writeFileSync(
      path.join(courseDir, BINARY),
      'next year’s handbook',
      'utf8',
    );

    const { planned, canvas } = await planAgainst(course, { conflict: 'ask' });
    assert.deepEqual(
      planned.actions.map((action) => action.type),
      ['update-canvas-item', 'refresh-base-hash'],
    );
    assert.deepEqual(planned.pending.conflicts, []);
    assert.deepEqual(planned.conflicts, []);

    const uploaded = {
      ...file,
      size: 23,
      modified_at: '2026-10-02T09:00:00Z',
      updated_at: '2026-10-02T09:00:00Z',
    };
    mock.restoreAll();
    mockCanvas([
      {
        method: 'POST',
        path: `/api/v1/courses/${COURSE_ID}/files`,
        body: {
          upload_url: 'https://canvas.example.com/upload/binary',
          upload_params: {},
        },
      },
      { method: 'POST', path: '/upload/binary', body: uploaded },
    ]);
    const outcome = await run(planned, {
      courseDir,
      state,
      gitDirty: CLEAN,
      canvasContent: canvas.content,
    });
    assert.deepEqual(outcome.errors, []);

    // The refresh ran after the upload and found the row already rewritten,
    // so the row describes the file Canvas holds now, not the one it read.
    const row = rowOf(state);
    assert.equal(
      row.canvas_hash,
      canvasFingerprint({ item, content: uploaded }, 'file'),
    );
    assert.equal(row.canvas_updated_at, '2026-10-02T09:00:00Z');

    const again = await planAgainst(course, {}, uploaded);
    assert.deepEqual(again.planned.actions, []);
  });

  it('makes a file item deleted here a prunable orphan, and prunes it', async () => {
    silence();
    const course = setup();
    const { courseDir, state } = course;
    fs.rmSync(path.join(courseDir, WRAPPER));

    // Without the flag: an orphan like any other, and the row is brought up
    // to date so a later publish click cannot turn it into a decision.
    const kept = await planAgainst(course, PUSH);
    assert.deepEqual(kept.planned.decisions, []);
    assert.equal(kept.planned.orphans.canvas.length, 1);
    assert.deepEqual(
      kept.planned.actions.map((action) => action.type),
      ['refresh-base-hash'],
    );

    // With it: deleted, and no refresh planned for the row it removes.
    const pruned = await planAgainst(course, { ...PUSH, pruneCanvas: true });
    assert.deepEqual(pruned.planned.decisions, []);
    assert.deepEqual(
      pruned.planned.actions.map((action) => action.type),
      ['delete-canvas-item'],
    );
    mock.restoreAll();
    const calls = mockCanvas([
      { method: 'DELETE', path: '/api/v1/files/770', body: {} },
    ]);
    const outcome = await run(pruned.planned, {
      courseDir,
      state,
      gitDirty: CLEAN,
      canvasContent: pruned.canvas.content,
    });
    assert.deepEqual(outcome.errors, []);
    assert.equal(calls.length, 1);
    assert.equal(rowOf(state), undefined);
  });
});

describe('the fingerprint invariant, a page and the binary it embeds', () => {
  it('pushes the page when only the image moved, and is silent after', async () => {
    silence();
    // The whole round trip, because each half alone is satisfied by a defect.
    // Nothing but the PNG is touched between run two and run three: the page's
    // markdown is byte-identical, so its own `local_hash` cannot answer this and
    // the planner has to read `state.files` to see it at all. Run four is the
    // other half — the upload has to record the new hash, or the page reports as
    // changed on every run for ever.
    const courseDir = tempCourse({
      '01-intro/_category_.json': '{ "label": "Intro", "position": 1 }\n',
      '01-intro/01-welcome.md':
        '---\ntitle: Welcome\n---\n\n![Diagram](./_files/diagram.png)\n',
      '01-intro/_files/diagram.png': 'first draft of the diagram',
    });
    const state = emptyState();

    const uploaded = { id: 770, display_name: 'diagram.png' };
    const page = {
      page_id: 501,
      url: 'welcome',
      title: 'Welcome',
      body: `<p><img src="/courses/${COURSE_ID}/files/770/preview"></p>`,
      updated_at: '2026-08-20T11:00:00.000Z',
    };
    const item = {
      id: 91,
      type: 'Page',
      title: 'Welcome',
      page_url: 'welcome',
      content_id: 501,
      position: 1,
      indent: 0,
    };
    // The specific route first: `/pages` is a substring of `/pages/welcome`, and
    // `/modules` of `/modules/10/items`.
    const canvasReads = () => [
      { method: 'GET', path: '/modules/10/items', body: [item] },
      {
        method: 'GET',
        path: '/modules',
        body: [{ id: 10, name: 'Intro', position: 1 }],
      },
      { method: 'GET', path: '/pages/welcome', body: page },
      {
        method: 'GET',
        path: '/pages',
        body: [
          {
            page_id: 501,
            url: 'welcome',
            title: 'Welcome',
            updated_at: page.updated_at,
          },
        ],
      },
    ];
    const uploadRoutes = () => [
      {
        method: 'POST',
        path: `/api/v1/courses/${COURSE_ID}/files`,
        body: {
          upload_url: 'https://canvas.example.com/upload/binary',
          upload_params: {},
        },
      },
      { method: 'POST', path: '/upload/binary', body: uploaded },
    ];

    // --- Run one: Canvas holds none of this ----------------------------------
    mockCanvas([{ method: 'GET', path: '/modules', body: [] }]);
    let canvas = await gatherCanvas({ courseId: COURSE_ID, base: state });
    const first = plan({
      base: state,
      local: gatherLocal({ courseDir, gitDirty: CLEAN }),
      canvas,
    });
    assert.deepEqual(
      first.actions.map((action) => action.type),
      ['create-canvas-module', 'create-canvas-item'],
    );

    mock.restoreAll();
    mockCanvas([
      { method: 'POST', path: '/modules/10/items', body: item },
      {
        method: 'POST',
        path: '/modules',
        body: { id: 10, name: 'Intro', position: 1 },
      },
      ...uploadRoutes(),
      { method: 'POST', path: '/pages', body: page },
    ]);
    let outcome = await run(first, {
      courseDir,
      state,
      canvasContent: canvas.content,
    });
    assert.deepEqual(outcome.errors, []);
    const firstHash = state.files['01-intro/_files/diagram.png'].sha256;
    assert.ok(firstHash, 'the upload recorded no hash for the binary');

    // --- Run two: nothing was touched, so nothing may happen -----------------
    mock.restoreAll();
    const quiet = mockCanvas(canvasReads());
    canvas = await gatherCanvas({ courseId: COURSE_ID, base: null });
    const again = plan({
      base: state,
      local: gatherLocal({ courseDir, gitDirty: CLEAN }),
      canvas,
    });
    assert.deepEqual(again.actions, [], 'a sync after a sync must do nothing');
    assert.deepEqual(
      quiet.filter((call) => call.method === 'POST'),
      [],
      'the second run uploaded something',
    );

    // --- Run three: the image is redrawn, and nothing else --------------------
    mock.restoreAll();
    fs.writeFileSync(
      path.join(courseDir, '01-intro/_files/diagram.png'),
      'the redrawn diagram, same page around it',
      'utf8',
    );
    mockCanvas(canvasReads());
    canvas = await gatherCanvas({ courseId: COURSE_ID, base: null });
    const afterEdit = plan({
      base: state,
      local: gatherLocal({ courseDir, gitDirty: CLEAN }),
      canvas,
    });
    assert.deepEqual(
      afterEdit.actions.map((action) => action.type),
      ['update-canvas-item'],
      'redrawing an embedded image must reach Canvas',
    );

    mock.restoreAll();
    const writes = mockCanvas([
      ...uploadRoutes(),
      { method: 'PUT', path: '/pages/501', body: page },
    ]);
    outcome = await run(afterEdit, {
      courseDir,
      state,
      canvasContent: canvas.content,
    });
    assert.deepEqual(outcome.errors, []);
    assert.equal(
      writes.filter((call) => call.url.includes('/upload/binary')).length,
      1,
      'the planner said the binary moved and the run must actually send it',
    );
    assert.notEqual(
      state.files['01-intro/_files/diagram.png'].sha256,
      firstHash,
      'the new bytes were uploaded but the old hash was left on the row',
    );

    // --- Run four: the run that proves the two sides agree -------------------
    mock.restoreAll();
    const settled = mockCanvas(canvasReads());
    const last = plan({
      base: state,
      local: gatherLocal({ courseDir, gitDirty: CLEAN }),
      canvas: await gatherCanvas({ courseId: COURSE_ID, base: null }),
    });
    assert.deepEqual(
      last.actions,
      [],
      'the item reports as changed for ever unless the upload recorded the hash',
    );
    assert.deepEqual(last.skipped, []);
    assert.deepEqual(
      settled.filter((call) => call.method === 'POST'),
      [],
      'a settled course must upload nothing',
    );
  });
});

describe('the fingerprint invariant, an item dragged into a subfolder', () => {
  it('pushes the indent it gained, and is silent on the run after', async () => {
    silence();
    // An indent is not in either hash and cannot be: it is one bit of the
    // item's own path, and the file is byte for byte what it was. Both halves
    // are here because either alone is satisfied by a defect. The push has to
    // be planned at all — that is the hole — and the row has to come out of it
    // holding the new indent, or the planner has no baseline and issues the
    // same PUT on every run for ever.
    const courseDir = tempCourse({
      '01-intro/_category_.json': '{ "label": "Intro", "position": 1 }\n',
      '01-intro/01-welcome.md': '---\ntitle: Welcome\n---\n\nHello there.\n',
    });
    const state = emptyState();

    const page = {
      page_id: 501,
      url: 'welcome',
      title: 'Welcome',
      body: '<p>Hello there.</p>',
      updated_at: '2026-08-20T11:00:00.000Z',
    };
    const item = {
      id: 91,
      type: 'Page',
      title: 'Welcome',
      page_url: 'welcome',
      content_id: 501,
      position: 1,
      indent: 0,
    };
    // The specific route first: `/pages` is a substring of `/pages/welcome`,
    // and `/modules` of `/modules/10/items`.
    const canvasReads = (items) => [
      { method: 'GET', path: '/modules/10/items', body: items },
      {
        method: 'GET',
        path: '/modules',
        body: [{ id: 10, name: 'Intro', position: 1 }],
      },
      { method: 'GET', path: '/pages/welcome', body: page },
      {
        method: 'GET',
        path: '/pages',
        body: [
          {
            page_id: 501,
            url: 'welcome',
            title: 'Welcome',
            updated_at: page.updated_at,
          },
        ],
      },
    ];

    // --- Run one: the page is created at the top of its module --------------
    mockCanvas([{ method: 'GET', path: '/modules', body: [] }]);
    let canvas = await gatherCanvas({ courseId: COURSE_ID, base: state });
    const first = plan({
      base: state,
      local: gatherLocal({ courseDir, gitDirty: CLEAN }),
      canvas,
    });
    assert.deepEqual(
      first.actions.map((action) => action.type),
      ['create-canvas-module', 'create-canvas-item'],
    );

    mock.restoreAll();
    mockCanvas([
      { method: 'POST', path: '/modules/10/items', body: item },
      {
        method: 'POST',
        path: '/modules',
        body: { id: 10, name: 'Intro', position: 1 },
      },
      { method: 'POST', path: '/pages', body: page },
    ]);
    let outcome = await run(first, {
      courseDir,
      state,
      canvasContent: canvas.content,
    });
    assert.deepEqual(outcome.errors, []);
    const flat = state.modules['01-intro'].items['01-intro/01-welcome.md'];
    assert.equal(flat.indent, 0, 'a create has to leave a baseline too');

    // --- The author drags the file into a new subfolder, and renames nothing -
    mock.restoreAll();
    fs.mkdirSync(path.join(courseDir, '01-intro/theory'), { recursive: true });
    fs.writeFileSync(
      path.join(courseDir, '01-intro/theory/_category_.json'),
      '{ "label": "Theory", "position": 1 }\n',
      'utf8',
    );
    fs.renameSync(
      path.join(courseDir, '01-intro/01-welcome.md'),
      path.join(courseDir, '01-intro/theory/01-welcome.md'),
    );

    mockCanvas(canvasReads([item]));
    canvas = await gatherCanvas({ courseId: COURSE_ID, base: state });
    const moved = plan({
      base: state,
      local: gatherLocal({ courseDir, gitDirty: CLEAN }),
      canvas,
    });
    assert.deepEqual(
      moved.actions.map((action) => action.type),
      ['rekey-base', 'create-canvas-item', 'update-canvas-item'],
      'the text header is created and the page is pushed under it',
    );
    assert.equal(
      moved.actions.at(-1).indent,
      1,
      'the page belongs beneath the header now',
    );

    mock.restoreAll();
    const header = {
      id: 92,
      type: 'SubHeader',
      title: 'Theory',
      position: 1,
      indent: 0,
    };
    const indented = { ...item, position: 2, indent: 1 };
    const writes = mockCanvas([
      { method: 'POST', path: '/modules/10/items', body: header },
      { method: 'PUT', path: '/modules/10/items/91', body: indented },
      { method: 'PUT', path: '/pages/501', body: page },
    ]);
    outcome = await run(moved, {
      courseDir,
      state,
      canvasContent: canvas.content,
    });
    assert.deepEqual(outcome.errors, []);
    assert.equal(
      calledWith(writes, 'PUT', '/modules/10/items/91').length,
      1,
      'the indent reaches Canvas through the module item, exactly once',
    );
    assert.equal(
      state.modules['01-intro'].items['01-intro/theory/01-welcome.md'].indent,
      1,
      'the row is the only baseline there is, and it has to hold the new indent',
    );

    // --- Run three: the run that proves the two sides agree ------------------
    mock.restoreAll();
    const settled = mockCanvas(canvasReads([header, indented]));
    const last = plan({
      base: state,
      local: gatherLocal({ courseDir, gitDirty: CLEAN }),
      canvas: await gatherCanvas({ courseId: COURSE_ID, base: state }),
    });
    assert.deepEqual(
      last.actions,
      [],
      'the item is pushed on every run for ever unless the row recorded it',
    );
    assert.deepEqual(last.skipped, []);
    assert.deepEqual(
      settled.filter((call) => call.method !== 'GET'),
      [],
      'a settled course writes nothing',
    );
  });

  it('leaves the same baseline when the item arrived by pull', async () => {
    silence();
    // The other direction, and the one a fix is easiest to leave half done in:
    // a pull records its own row rather than going through the push-side
    // recorder. Leave the indent out of that one and an item whose last write
    // was a pull has no baseline at all, so dragging it out of its subfolder
    // afterwards is invisible — the same defect, reachable by a different
    // route.
    const courseDir = tempCourse();
    const state = emptyState();

    const page = {
      page_id: 501,
      url: 'welcome',
      title: 'Welcome',
      body: '<p>Hello there.</p>',
      updated_at: '2026-08-20T11:00:00.000Z',
    };
    const header = {
      id: 92,
      type: 'SubHeader',
      title: 'Theory',
      position: 1,
      indent: 0,
    };
    const item = {
      id: 91,
      type: 'Page',
      title: 'Welcome',
      page_url: 'welcome',
      content_id: 501,
      position: 2,
      indent: 1,
    };
    const reads = () => [
      { method: 'GET', path: '/modules/10/items', body: [header, item] },
      {
        method: 'GET',
        path: '/modules',
        body: [{ id: 10, name: 'Intro', position: 1 }],
      },
      { method: 'GET', path: '/pages/welcome', body: page },
      {
        method: 'GET',
        path: '/pages',
        body: [
          {
            page_id: 501,
            url: 'welcome',
            title: 'Welcome',
            updated_at: page.updated_at,
          },
        ],
      },
    ];

    // --- The whole module comes down, header and indented page together -----
    mockCanvas(reads());
    const canvas = await gatherCanvas({ courseId: COURSE_ID, base: state });
    const pulled = plan({
      base: state,
      local: gatherLocal({ courseDir, gitDirty: CLEAN }),
      canvas,
    });
    assert.deepEqual(
      pulled.actions.map((action) => action.type),
      ['create-local-module', 'create-local-item', 'create-local-item'],
    );

    const outcome = await run(pulled, {
      courseDir,
      state,
      canvasContent: canvas.content,
    });
    assert.deepEqual(outcome.errors, []);

    const nested = '01-intro/01-theory/01-welcome.md';
    assert.equal(
      state.modules['01-intro'].items[nested].indent,
      1,
      'the page landed in the subfolder and the row has to say so',
    );

    // --- The author drags it back out to the top of the module ---------------
    mock.restoreAll();
    fs.renameSync(
      path.join(courseDir, nested),
      path.join(courseDir, '01-intro/02-welcome.md'),
    );
    mockCanvas(reads());
    const dragged = plan({
      base: state,
      local: gatherLocal({ courseDir, gitDirty: CLEAN }),
      canvas: await gatherCanvas({ courseId: COURSE_ID, base: state }),
    });

    assert.deepEqual(
      dragged.actions.map((action) => action.type),
      ['rekey-base', 'update-canvas-item'],
    );
    assert.equal(dragged.actions.at(-1).indent, 0);
  });
});

// ---------------------------------------------------------------------------
// One test per action type
// ---------------------------------------------------------------------------

describe('the module link, over two passes', () => {
  it('links the module it adopted, so the second pass is empty', async () => {
    // Two consecutive passes over the state the first one leaves. The
    // single-pass version of this passed while the run was leaving its module
    // row with no `canvas_module_id` in it — nothing else records that link, so
    // pass 2 paired the folder with nothing, read the module as gone from
    // Canvas, made every item in it a local orphan and emitted a stray move.
    silence();
    const courseDir = tempCourse({
      '01-intro/_category_.json': '{ "label": "Intro", "position": 1 }\n',
      '01-intro/01-welcome.md': '---\ntitle: Welcome\n---\n\nLocal copy.\n',
    });
    const state = emptyState();

    const item = {
      id: 91,
      type: 'Page',
      title: 'Welcome',
      page_url: 'welcome',
      content_id: 501,
      position: 1,
      indent: 0,
    };
    const page = {
      page_id: 501,
      url: 'welcome',
      title: 'Welcome',
      body: '<p>Local copy.</p>',
      updated_at: '2026-08-20T11:00:00.000Z',
    };
    const reads = () => [
      { method: 'GET', path: '/modules/10/items', body: [item] },
      {
        method: 'GET',
        path: '/modules',
        body: [{ id: 10, name: 'Intro', position: 1 }],
      },
      { method: 'GET', path: '/pages/welcome', body: page },
      {
        method: 'GET',
        path: '/pages',
        body: [
          {
            page_id: 501,
            url: 'welcome',
            title: 'Welcome',
            updated_at: page.updated_at,
          },
        ],
      },
    ];

    // --- Pass 1: the course is on Canvas and the state knows none of it ------
    mockCanvas(reads());
    const local = gatherLocal({ courseDir, gitDirty: CLEAN });
    let canvas = await gatherCanvas({ courseId: COURSE_ID, base: state });
    const first = plan({
      base: state,
      local,
      canvas,
      policy: { write: { canvas: true, local: false }, adopt: 'local' },
    });
    assert.deepEqual(
      first.actions.map((action) => action.type),
      ['link-base-module', 'update-canvas-item'],
      'the page is claimed, and the module it sits in is linked',
    );

    mock.restoreAll();
    mockCanvas([{ method: 'PUT', path: '/pages/501', body: page }]);
    const outcome = await run(first, {
      courseDir,
      state,
      canvasContent: canvas.content,
    });
    assert.deepEqual(outcome.errors, []);

    assert.equal(
      state.modules['01-intro'].canvas_module_id,
      10,
      'the folder and the Canvas module are the same module, and the state says so',
    );

    // --- Pass 2: nothing has moved on either side ----------------------------
    mock.restoreAll();
    mockCanvas(reads());
    canvas = await gatherCanvas({ courseId: COURSE_ID, base: state });
    const second = plan({
      base: state,
      local: gatherLocal({ courseDir, gitDirty: CLEAN }),
      canvas,
      policy: { write: { canvas: true, local: false }, adopt: 'local' },
    });

    assert.deepEqual(second.actions, [], 'a settled course plans nothing');
    assert.deepEqual(second.withheld, [], 'and withholds nothing either');
    assert.deepEqual(second.orphans.local, []);
    assert.deepEqual(second.orphans.canvas, []);
    assert.deepEqual(second.adopted, [], 'there is nothing left to adopt');
  });

  it('writes a title into the item it adopted, and settles after', async () => {
    // The page carries no `title:`, so its name comes from its filename — and
    // that is the coupling `writeTitleIfAbsent` exists to break, because
    // `renumber` renames files by the dozen and would then rename the Canvas
    // item under the author. It ran on the create handler alone, and an
    // adoption is not a create: it is an `update-canvas-item` from `adoptPair`.
    //
    // Both halves again. The title has to land in the file, and the row that
    // the same write records has to describe the file *including* it, or the
    // adopted item reads as changed locally on every run after this one.
    silence();
    const courseDir = tempCourse({
      '01-intro/_category_.json': '{ "label": "Intro", "position": 1 }\n',
      '01-intro/01-welcome.md': 'Local copy.\n',
    });
    const state = emptyState();
    const welcome = path.join(courseDir, '01-intro/01-welcome.md');

    const item = {
      id: 91,
      type: 'Page',
      title: 'Welcome',
      page_url: 'welcome',
      content_id: 501,
      position: 1,
      indent: 0,
    };
    const page = {
      page_id: 501,
      url: 'welcome',
      title: 'Welcome',
      body: '<p>Local copy.</p>',
      updated_at: '2026-08-20T11:00:00.000Z',
    };
    const reads = () => [
      { method: 'GET', path: '/modules/10/items', body: [item] },
      {
        method: 'GET',
        path: '/modules',
        body: [{ id: 10, name: 'Intro', position: 1 }],
      },
      { method: 'GET', path: '/pages/welcome', body: page },
      {
        method: 'GET',
        path: '/pages',
        body: [
          {
            page_id: 501,
            url: 'welcome',
            title: 'Welcome',
            updated_at: page.updated_at,
          },
        ],
      },
    ];
    const pinned = {
      write: { canvas: true, local: false },
      adopt: 'local',
    };

    // --- Pass 1: the Canvas page is claimed rather than duplicated -----------
    mockCanvas(reads());
    let canvas = await gatherCanvas({ courseId: COURSE_ID, base: state });
    const first = plan({
      base: state,
      local: gatherLocal({ courseDir, gitDirty: CLEAN }),
      canvas,
      policy: pinned,
    });
    assert.deepEqual(
      first.actions.map((action) => action.type),
      ['link-base-module', 'update-canvas-item'],
    );

    mock.restoreAll();
    mockCanvas([{ method: 'PUT', path: '/pages/501', body: page }]);
    const outcome = await run(first, {
      courseDir,
      state,
      canvasContent: canvas.content,
    });
    assert.deepEqual(outcome.errors, []);

    assert.match(
      fs.readFileSync(welcome, 'utf8'),
      /^title: Welcome$/m,
      'the adopted item still has no title of its own',
    );
    assert.equal(
      state.modules['01-intro'].items['01-intro/01-welcome.md'].local_hash,
      hashLocalFile(welcome),
      'the row has to describe the file as the write left it',
    );

    // --- Pass 2: nothing has moved on either side ----------------------------
    mock.restoreAll();
    mockCanvas(reads());
    const second = plan({
      base: state,
      local: gatherLocal({ courseDir, gitDirty: CLEAN }),
      canvas: await gatherCanvas({ courseId: COURSE_ID, base: state }),
      policy: pinned,
    });

    assert.deepEqual(
      second.actions,
      [],
      'the title write leaves the item reading as changed unless the row saw it',
    );
    assert.deepEqual(second.withheld, []);
    assert.deepEqual(second.adopted, []);

    // --- And renumbering the file no longer renames it on Canvas -------------
    fs.renameSync(welcome, path.join(courseDir, '01-intro/04-welcome.md'));
    mock.restoreAll();
    mockCanvas(reads());
    const renumbered = plan({
      base: state,
      local: gatherLocal({ courseDir, gitDirty: CLEAN }),
      canvas: await gatherCanvas({ courseId: COURSE_ID, base: state }),
      policy: pinned,
    });
    assert.deepEqual(
      renumbered.actions.map((action) => action.type),
      ['rekey-base'],
      'the whole point: the file moved and the Canvas item kept its name',
    );
  });

  it('links a module plain sync paired, so the second pass is empty', async () => {
    // No adoption anywhere: a pair with items on one side only never trips the
    // collision guard, so `sync` reaches the same branch. Gating the link on
    // `policy.adopt` left this case failing in exactly the same way — the
    // folder read as gone from Canvas on pass 2, with a `create-local-module`
    // for a module that was already there.
    silence();
    const courseDir = tempCourse({
      '01-intro/_category_.json': '{ "label": "Intro", "position": 1 }\n',
      '01-intro/01-welcome.md': '---\ntitle: Welcome\n---\n\nHello there.\n',
    });
    const state = emptyState();

    mockCanvas([
      { method: 'GET', path: '/modules/10/items', body: [] },
      {
        method: 'GET',
        path: '/modules',
        body: [{ id: 10, name: 'Intro', position: 1 }],
      },
      { method: 'GET', path: '/pages', body: [] },
    ]);
    let canvas = await gatherCanvas({ courseId: COURSE_ID, base: state });
    const first = plan({
      base: state,
      local: gatherLocal({ courseDir, gitDirty: CLEAN }),
      canvas,
    });
    assert.deepEqual(
      first.actions.map((action) => action.type),
      ['link-base-module', 'create-canvas-item'],
      'the empty Canvas module is filled rather than duplicated, and linked',
    );

    const createdPage = {
      page_id: 501,
      url: 'welcome',
      title: 'Welcome',
      body: '<p>Hello there.</p>',
      updated_at: '2026-08-20T11:00:00.000Z',
    };
    const createdItem = {
      id: 91,
      type: 'Page',
      title: 'Welcome',
      page_url: 'welcome',
      content_id: 501,
      position: 1,
      indent: 0,
    };
    mock.restoreAll();
    mockCanvas([
      { method: 'POST', path: '/modules/10/items', body: createdItem },
      { method: 'POST', path: '/pages', body: createdPage },
    ]);
    const outcome = await run(first, {
      courseDir,
      state,
      canvasContent: canvas.content,
    });
    assert.deepEqual(outcome.errors, []);
    assert.equal(state.modules['01-intro'].canvas_module_id, 10);

    mock.restoreAll();
    mockCanvas([
      { method: 'GET', path: '/modules/10/items', body: [createdItem] },
      {
        method: 'GET',
        path: '/modules',
        body: [{ id: 10, name: 'Intro', position: 1 }],
      },
      { method: 'GET', path: '/pages/welcome', body: createdPage },
      {
        method: 'GET',
        path: '/pages',
        body: [
          {
            page_id: 501,
            url: 'welcome',
            title: 'Welcome',
            updated_at: createdPage.updated_at,
          },
        ],
      },
    ]);
    const second = plan({
      base: state,
      local: gatherLocal({ courseDir, gitDirty: CLEAN }),
      canvas: await gatherCanvas({ courseId: COURSE_ID, base: null }),
    });

    assert.deepEqual(second.actions, []);
    assert.deepEqual(second.orphans.local, []);
    assert.deepEqual(second.orphans.canvas, []);
  });

  it('links it from the other side too, where Canvas holds the items', async () => {
    // The mirror of the case above, and the same branch: the Canvas module has
    // the content and the local folder is empty, so the item write goes the
    // other way. The link is the same either way, which is the point of it
    // being a state action rather than a write to one side.
    silence();
    const courseDir = tempCourse({
      '01-intro/_category_.json': '{ "label": "Intro", "position": 1 }\n',
    });
    const state = emptyState();

    const page = {
      page_id: 501,
      url: 'welcome',
      title: 'Welcome',
      body: '<p>Hello there.</p>',
      updated_at: '2026-08-20T11:00:00.000Z',
    };
    const item = {
      id: 91,
      type: 'Page',
      title: 'Welcome',
      page_url: 'welcome',
      content_id: 501,
      position: 1,
      indent: 0,
    };
    const reads = () => [
      { method: 'GET', path: '/modules/10/items', body: [item] },
      {
        method: 'GET',
        path: '/modules',
        body: [{ id: 10, name: 'Intro', position: 1 }],
      },
      { method: 'GET', path: '/pages/welcome', body: page },
      {
        method: 'GET',
        path: '/pages',
        body: [
          {
            page_id: 501,
            url: 'welcome',
            title: 'Welcome',
            updated_at: page.updated_at,
          },
        ],
      },
    ];

    mockCanvas(reads());
    const canvas = await gatherCanvas({ courseId: COURSE_ID, base: state });
    const first = plan({
      base: state,
      local: gatherLocal({ courseDir, gitDirty: CLEAN }),
      canvas,
    });
    assert.deepEqual(
      first.actions.map((action) => action.type),
      ['link-base-module', 'create-local-item'],
    );

    mock.restoreAll();
    mockCanvas([]);
    const outcome = await run(first, {
      courseDir,
      state,
      canvasContent: canvas.content,
    });
    assert.deepEqual(outcome.errors, []);
    assert.equal(state.modules['01-intro'].canvas_module_id, 10);

    mock.restoreAll();
    mockCanvas(reads());
    const second = plan({
      base: state,
      local: gatherLocal({ courseDir, gitDirty: CLEAN }),
      canvas: await gatherCanvas({ courseId: COURSE_ID, base: null }),
    });

    assert.deepEqual(second.actions, []);
    assert.deepEqual(second.orphans.local, []);
    assert.deepEqual(second.orphans.canvas, []);
  });
});

describe('two Canvas modules that derive the same folder name', () => {
  it('takes the first and refuses the second, writing nothing for it', async () => {
    // A module's folder is `toFolderName(name, position)`, so two Canvas
    // modules agreeing on both derive the same one and only the first can have
    // it. The second used to reach the executor as `create-local-module` with
    // `folder: null`: `path.join(courseDir, null)` threw, the run reported an
    // internal error rather than the name clash it could describe — and the
    // `create-local-item` ranked behind it carried its *real* suggested path,
    // so it ran, wrote that module's page into the first module's folder, and
    // filed the row under a state key of the literal string `"null"`.
    silence();
    const courseDir = tempCourse();
    const state = emptyState();

    const pageA = {
      page_id: 501,
      url: 'a',
      title: 'A',
      body: '<p>Module one.</p>',
      updated_at: '2026-08-20T11:00:00.000Z',
    };
    const pageB = {
      page_id: 502,
      url: 'b',
      title: 'B',
      body: '<p>Module two.</p>',
      updated_at: '2026-08-20T11:00:00.000Z',
    };

    mockCanvas([
      {
        method: 'GET',
        path: '/modules/10/items',
        body: [
          {
            id: 91,
            type: 'Page',
            title: 'A',
            page_url: 'a',
            content_id: 501,
            position: 1,
            indent: 0,
          },
        ],
      },
      {
        method: 'GET',
        path: '/modules/20/items',
        body: [
          {
            id: 92,
            type: 'Page',
            title: 'B',
            page_url: 'b',
            content_id: 502,
            position: 1,
            indent: 0,
          },
        ],
      },
      {
        method: 'GET',
        path: '/modules',
        body: [
          { id: 10, name: 'Introduction', position: 1 },
          { id: 20, name: 'Introduction', position: 1 },
        ],
      },
      { method: 'GET', path: '/pages/a', body: pageA },
      { method: 'GET', path: '/pages/b', body: pageB },
      {
        method: 'GET',
        path: '/pages',
        body: [
          { page_id: 501, url: 'a', title: 'A', updated_at: pageA.updated_at },
          { page_id: 502, url: 'b', title: 'B', updated_at: pageB.updated_at },
        ],
      },
    ]);

    const canvas = await gatherCanvas({ courseId: COURSE_ID, base: state });
    assert.deepEqual(
      canvas.modules.map((module) => module.suggestedFolder),
      ['01-introduction', '01-introduction'],
      'the gather really does hand two modules the one folder name',
    );

    const planned = plan({
      base: state,
      local: gatherLocal({ courseDir, gitDirty: CLEAN }),
      canvas,
    });
    const outcome = await run(planned, {
      courseDir,
      state,
      canvasContent: canvas.content,
    });

    assert.deepEqual(
      outcome.errors,
      [],
      'a name clash is not an internal error',
    );
    assert.equal(planned.skipped.length, 1);
    assert.equal(planned.skipped[0].reason, 'folder-taken');

    assert.ok(fs.existsSync(path.join(courseDir, '01-introduction/01-a.md')));
    assert.equal(
      fs.existsSync(path.join(courseDir, '01-introduction/01-b.md')),
      false,
      'the second module’s page must not land in the first module’s folder',
    );
    assert.deepEqual(Object.keys(state.modules), ['01-introduction']);
  });
});

describe('applyPlan, per action type', () => {
  it('creates a module and records the id every later action needs', async () => {
    silence();
    const state = emptyState();
    const calls = mockCanvas([
      { method: 'POST', path: '/modules', body: { id: 77, name: 'Intro' } },
    ]);

    await run(
      {
        actions: [
          {
            type: 'create-canvas-module',
            folder: '01-intro',
            name: 'Intro',
            position: 1,
          },
        ],
      },
      { state, courseDir: tempCourse() },
    );

    assert.equal(calledWith(calls, 'POST', '/modules').length, 1);
    assert.equal(state.modules['01-intro'].canvas_module_id, 77);
  });

  it('writes a Canvas rename into the label and keeps the local slot', async () => {
    // `writeCategoryFile` rewrites the whole `position` field, so where the
    // number comes from is the whole question. It used to come from the state
    // row — a record of the last run rather than of the folder — and a row with
    // no `position` fell through to `?? 0`, which sent the module to the top of
    // the sidebar behind the author's back. It is the action's now, and the
    // planner sets that from the folder's own numeric prefix.
    silence();
    const courseDir = tempCourse({
      '01-intro/_category_.json':
        '{\n  "label": "My Own Title",\n  "position": 1,\n  "collapsed": true\n}\n',
    });
    const state = emptyState();
    // No `position` on the row, which is what made the old read write 0.
    state.modules['01-intro'] = {
      canvas_module_id: 10,
      name: 'My Own Title',
      item_order: [],
      items: {},
    };
    mockCanvas([]);

    await run(
      {
        actions: [
          {
            type: 'update-local-module',
            folder: '01-intro',
            canvasModuleId: 10,
            name: 'Renamed In Canvas',
            position: 1,
          },
        ],
      },
      { state, courseDir, gitDirty: CLEAN },
    );

    const category = JSON.parse(
      fs.readFileSync(path.join(courseDir, '01-intro/_category_.json'), 'utf8'),
    );
    assert.equal(category.label, 'Renamed In Canvas');
    assert.equal(category.position, 1);
    assert.equal(category.collapsed, true, 'the author’s own fields survive');
  });

  it('updates a page and leaves the module item alone when it already agrees', async () => {
    silence();
    const courseDir = tempCourse({
      '01-intro/01-welcome.md': '---\ntitle: Welcome\n---\n\nEdited.\n',
    });
    const state = emptyState();
    state.modules['01-intro'] = {
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
        },
      },
    };
    const calls = mockCanvas([
      {
        // A page is addressed by its numeric id, which a rename does not move.
        method: 'PUT',
        path: '/pages/501',
        body: {
          page_id: 501,
          url: 'welcome',
          title: 'Welcome',
          body: '<p>Edited.</p>',
          updated_at: '2026-08-20T11:00:00.000Z',
        },
      },
    ]);

    const outcome = await run(
      {
        actions: [
          {
            type: 'update-canvas-item',
            folder: '01-intro',
            canvasModuleId: 10,
            itemPath: '01-intro/01-welcome.md',
            title: 'Welcome',
            canvasType: 'page',
            canvasId: 501,
            pageUrl: 'welcome',
            moduleItemId: 91,
            indent: 0,
          },
        ],
      },
      {
        courseDir,
        state,
        // The live module item already carries the same title and indent, so
        // there is nothing for a module-item PUT to change.
        canvasContent: new Map([
          [
            '91',
            { item: { id: 91, title: 'Welcome', indent: 0 }, content: null },
          ],
        ]),
      },
    );

    assert.deepEqual(outcome.errors, []);
    assert.equal(calledWith(calls, 'PUT', '/pages/501').length, 1);
    assert.equal(calledWith(calls, 'PUT', '/modules/10/items').length, 0);
  });
  it('treats an indent Canvas did not report as 0', async () => {
    silence();
    const courseDir = tempCourse({
      '01-intro/01-welcome.md': '---\ntitle: Welcome\n---\n\nEdited.\n',
    });
    const state = emptyState();
    state.modules['01-intro'] = {
      canvas_module_id: 10,
      item_order: ['01-intro/01-welcome.md'],
      items: {
        '01-intro/01-welcome.md': {
          canvas_type: 'page',
          canvas_id: 501,
          page_url: 'welcome',
          module_item_id: 91,
          title: 'Welcome',
        },
      },
    };
    const calls = mockCanvas([
      {
        method: 'PUT',
        path: '/pages/501',
        body: {
          page_id: 501,
          url: 'welcome',
          title: 'Welcome',
          body: '<p>Edited.</p>',
          updated_at: '2026-08-20T11:00:00.000Z',
        },
      },
    ]);

    const outcome = await run(
      {
        actions: [
          {
            type: 'update-canvas-item',
            folder: '01-intro',
            canvasModuleId: 10,
            itemPath: '01-intro/01-welcome.md',
            title: 'Welcome',
            canvasType: 'page',
            canvasId: 501,
            pageUrl: 'welcome',
            moduleItemId: 91,
            indent: 0,
          },
        ],
      },
      {
        courseDir,
        state,
        // Canvas omits indent on an item that has none, and means 0 by it.
        canvasContent: new Map([
          ['91', { item: { id: 91, title: 'Welcome' }, content: null }],
        ]),
      },
    );

    assert.deepEqual(outcome.errors, []);
    assert.equal(calledWith(calls, 'PUT', '/modules/10/items').length, 0);
  });

  it('sends new_tab when the author flipped it and Canvas reported the old value', async () => {
    silence();
    const courseDir = tempCourse({
      '01-intro/01-docs.md':
        '---\ntitle: Docs\ncanvas_type: external_url\nexternal_url: https://example.com\nnew_tab: false\n---\n',
    });
    const state = emptyState();
    state.modules['01-intro'] = {
      canvas_module_id: 10,
      item_order: ['01-intro/01-docs.md'],
      items: {
        '01-intro/01-docs.md': {
          canvas_type: 'external_url',
          canvas_id: 95,
          module_item_id: 95,
          title: 'Docs',
        },
      },
    };
    const calls = mockCanvas([
      {
        method: 'PUT',
        path: '/modules/10/items/95',
        body: {
          id: 95,
          type: 'ExternalUrl',
          title: 'Docs',
          external_url: 'https://example.com',
          new_tab: false,
          indent: 0,
        },
      },
    ]);

    const outcome = await run(
      {
        actions: [
          {
            type: 'update-canvas-item',
            folder: '01-intro',
            canvasModuleId: 10,
            itemPath: '01-intro/01-docs.md',
            title: 'Docs',
            canvasType: 'external_url',
            canvasId: 95,
            moduleItemId: 95,
            indent: 0,
          },
        ],
      },
      {
        courseDir,
        state,
        canvasContent: new Map([
          [
            '95',
            {
              item: {
                id: 95,
                type: 'ExternalUrl',
                title: 'Docs',
                external_url: 'https://example.com',
                new_tab: true,
                indent: 0,
              },
              content: null,
            },
          ],
        ]),
      },
    );

    assert.deepEqual(outcome.errors, []);
    const [sent] = calledWith(calls, 'PUT', '/modules/10/items/95');
    assert.deepEqual(
      sent.body.module_item,
      { new_tab: false },
      'only the field that moved is sent',
    );
  });

  it('says nothing about new_tab when neither the file nor Canvas does', async () => {
    silence();
    // An LTI link points at a tool this project did not install, and Canvas
    // does not report new_tab reliably for one, so an author who said nothing
    // gets nothing sent — guessing would issue a PUT that changes nothing on
    // every single run.
    const courseDir = tempCourse({
      '01-intro/01-wooclap.md':
        '---\ntitle: Wooclap\ncanvas_type: external_tool\nexternal_url: https://app.wooclap.com/x\n---\n',
    });
    const state = emptyState();
    state.modules['01-intro'] = {
      canvas_module_id: 10,
      item_order: ['01-intro/01-wooclap.md'],
      items: {
        '01-intro/01-wooclap.md': {
          canvas_type: 'external_tool',
          canvas_id: 96,
          module_item_id: 96,
          title: 'Wooclap',
        },
      },
    };
    const calls = mockCanvas([]);

    const outcome = await run(
      {
        actions: [
          {
            type: 'update-canvas-item',
            folder: '01-intro',
            canvasModuleId: 10,
            itemPath: '01-intro/01-wooclap.md',
            title: 'Wooclap',
            canvasType: 'external_tool',
            canvasId: 96,
            moduleItemId: 96,
            indent: 0,
          },
        ],
      },
      {
        courseDir,
        state,
        canvasContent: new Map([
          [
            '96',
            {
              item: {
                id: 96,
                type: 'ExternalTool',
                title: 'Wooclap',
                external_url: 'https://app.wooclap.com/x',
                indent: 0,
              },
              content: null,
            },
          ],
        ]),
      },
    );

    assert.deepEqual(outcome.errors, []);
    assert.equal(calledWith(calls, 'PUT', '/modules/10/items').length, 0);
  });

  it('leaves new_tab out of the comparison for a type that has none', async () => {
    silence();
    const courseDir = tempCourse({
      '01-intro/01-welcome.md':
        '---\ntitle: Welcome\nnew_tab: true\n---\n\nEdited.\n',
    });
    const state = emptyState();
    state.modules['01-intro'] = {
      canvas_module_id: 10,
      item_order: ['01-intro/01-welcome.md'],
      items: {
        '01-intro/01-welcome.md': {
          canvas_type: 'page',
          canvas_id: 501,
          page_url: 'welcome',
          module_item_id: 91,
          title: 'Welcome',
        },
      },
    };
    const calls = mockCanvas([
      {
        method: 'PUT',
        path: '/pages/501',
        body: {
          page_id: 501,
          url: 'welcome',
          title: 'Welcome',
          body: '<p>Edited.</p>',
          updated_at: '2026-08-20T11:00:00.000Z',
        },
      },
    ]);

    const outcome = await run(
      {
        actions: [
          {
            type: 'update-canvas-item',
            folder: '01-intro',
            canvasModuleId: 10,
            itemPath: '01-intro/01-welcome.md',
            title: 'Welcome',
            canvasType: 'page',
            canvasId: 501,
            pageUrl: 'welcome',
            moduleItemId: 91,
            indent: 0,
          },
        ],
      },
      {
        courseDir,
        state,
        canvasContent: new Map([
          [
            '91',
            { item: { id: 91, title: 'Welcome', indent: 0 }, content: null },
          ],
        ]),
      },
    );

    assert.deepEqual(outcome.errors, []);
    assert.equal(calledWith(calls, 'PUT', '/modules/10/items').length, 0);
  });

  it('creates an external URL as a module item and takes its id as the content id', async () => {
    silence();
    const courseDir = tempCourse({
      '01-intro/01-docs.md':
        '---\ntitle: Docs\ncanvas_type: external_url\nexternal_url: https://example.com\n---\n',
    });
    const state = emptyState();
    state.modules['01-intro'] = {
      canvas_module_id: 10,
      item_order: [],
      items: {},
    };
    const calls = mockCanvas([
      {
        method: 'POST',
        path: '/modules/10/items',
        body: {
          id: 95,
          type: 'ExternalUrl',
          title: 'Docs',
          external_url: 'https://example.com',
          new_tab: true,
          indent: 0,
        },
      },
    ]);

    await run(
      {
        actions: [
          {
            type: 'create-canvas-item',
            folder: '01-intro',
            canvasModuleId: 10,
            itemPath: '01-intro/01-docs.md',
            title: 'Docs',
            canvasType: 'external_url',
            indent: 0,
            position: 1,
          },
        ],
      },
      { courseDir, state },
    );

    const [post] = calledWith(calls, 'POST', '/modules/10/items');
    assert.equal(post.body.module_item.external_url, 'https://example.com');
    assert.equal(post.body.module_item.type, 'ExternalUrl');
    const row = state.modules['01-intro'].items['01-intro/01-docs.md'];
    assert.equal(row.canvas_id, 95);
    assert.equal(row.module_item_id, 95);
    assert.ok(row.canvas_hash);
  });

  // -------------------------------------------------------------------------
  // Creating the two reference types, which resolve before they can be placed
  // -------------------------------------------------------------------------

  /**
   * A course with one quiz item in it, and the plan that creates it. The routes
   * differ per test; what the quiz list answers is the whole question.
   */
  function quizCreate() {
    const courseDir = tempCourse({
      '01-intro/05-test.md':
        '---\ntitle: Test 1\ncanvas_type: quiz\n' +
        'quiz_ref: evaluations/2526/test-1/test-1-qti.zip\n---\n',
    });
    const state = emptyState();
    state.modules['01-intro'] = {
      canvas_module_id: 10,
      item_order: [],
      items: {},
    };
    return {
      courseDir,
      state,
      actions: [
        {
          type: 'create-canvas-item',
          folder: '01-intro',
          canvasModuleId: 10,
          itemPath: '01-intro/05-test.md',
          title: 'Test 1',
          canvasType: 'quiz',
          indent: 0,
          position: 1,
        },
      ],
    };
  }

  /** A log that keeps every line, so a test can say which channel carried one. */
  function recordingLog() {
    const warnings = [];
    const errors = [];
    return {
      warnings,
      errors,
      log: {
        info: () => {},
        verbose: () => {},
        warn: (line) => warnings.push(line),
        error: (line) => errors.push(line),
      },
    };
  }

  it('places, records and applies a quiz that resolves by title', async () => {
    silence();
    // The success half of the two branches below: a quiz found by title is a
    // real create, and pinning it is what keeps the refusals from swallowing
    // the items they should let through.
    const { courseDir, state, actions } = quizCreate();
    const calls = mockCanvas([
      { method: 'GET', path: '/quizzes', body: [{ id: 12, title: 'Test 1' }] },
      {
        method: 'POST',
        path: '/modules/10/items',
        body: {
          id: 96,
          type: 'Quiz',
          title: 'Test 1',
          content_id: 12,
          indent: 0,
        },
      },
    ]);

    const outcome = await run({ actions }, { courseDir, state });

    assert.deepEqual(outcome.errors, []);
    assert.deepEqual(
      outcome.applied.map((action) => action.itemPath),
      ['01-intro/05-test.md'],
    );
    const [post] = calledWith(calls, 'POST', '/modules/10/items');
    assert.equal(post.body.module_item.type, 'Quiz');
    assert.equal(post.body.module_item.content_id, 12);
    // The quiz's own id is the content id; the module item id is Canvas's.
    const row = state.modules['01-intro'].items['01-intro/05-test.md'];
    assert.equal(row.canvas_id, 12);
    assert.equal(row.module_item_id, 96);
  });

  it('reports no item created when the course holds no quiz by that title', async () => {
    const spies = silence();
    // The defect this pins: `pushQuiz` warned and returned null, the handler
    // returned, and a return is a success to the dispatch loop — so the action
    // landed in `applied`, the run printed "Canvas: 1 item created" for an item
    // that does not exist, and it exited 0 with the only trace a warning that
    // `--quiet` drops.
    const { courseDir, state, actions } = quizCreate();
    const { warnings, errors, log } = recordingLog();
    const calls = mockCanvas([{ method: 'GET', path: '/quizzes', body: [] }]);

    const outcome = await run({ actions }, { courseDir, state, log });

    // No POST route is on the table, so a create would have answered 400.
    assert.equal(calledWith(calls, 'POST', '/modules/10/items').length, 0);
    assert.deepEqual(outcome.applied, [], 'a create that did not create');
    assert.equal(outcome.errors.length, 1);
    assert.equal(outcome.errors[0].action.itemPath, '01-intro/05-test.md');
    // The reason carries the procedure, and carries it on the error channel,
    // which is the one `--quiet` does not suppress.
    assert.match(outcome.errors[0].error, /holds no quiz by that name yet/);
    assert.match(outcome.errors[0].error, /Import Course Content/);
    assert.match(outcome.errors[0].error, /test-1-qti\.zip/);
    assert.match(errors.join('\n'), /Import Course Content/);
    const warned = [
      ...warnings,
      ...spies.warn.mock.calls.map((call) => call.arguments[0]),
    ].join('\n');
    assert.doesNotMatch(warned, /Import Course Content/);

    // Nothing recorded for an item that was not created, so the next run plans
    // the same create again.
    assert.deepEqual(state.modules['01-intro'].items, {});
  });

  it('keeps the two unresolvable-quiz reasons apart', async () => {
    silence();
    // Two quizzes under one title is a different problem with a different
    // remedy from a package that was never imported, and the author acts on
    // the difference. One "could not create the item" for both would throw the
    // useful half away.
    const { courseDir, state, actions } = quizCreate();
    const calls = mockCanvas([
      {
        method: 'GET',
        path: '/quizzes',
        body: [
          { id: 12, title: 'Test 1' },
          { id: 44, title: 'Test 1' },
        ],
      },
    ]);

    const outcome = await run({ actions }, { courseDir, state });

    assert.equal(calledWith(calls, 'POST', '/modules/10/items').length, 0);
    assert.deepEqual(outcome.applied, []);
    assert.equal(outcome.errors.length, 1);
    assert.match(
      outcome.errors[0].error,
      /2 quizzes in this course carry that title \(ids 12, 44\)/,
    );
    assert.doesNotMatch(
      outcome.errors[0].error,
      /Import Course Content/,
      'the import procedure is the other reason, and does not fix this one',
    );
    assert.deepEqual(state.modules['01-intro'].items, {});
  });

  it('reports no item created when an external tool names no launch URL', async () => {
    silence();
    // The same field a `canvas_type: external_url` already fails the run over.
    // One missing `external_url` used to get two answers depending on which of
    // the two types the file claimed.
    const courseDir = tempCourse({
      '01-intro/04-lab.md':
        '---\ntitle: Week 1 lab\ncanvas_type: external_tool\n---\n',
    });
    const state = emptyState();
    state.modules['01-intro'] = {
      canvas_module_id: 10,
      item_order: [],
      items: {},
    };
    const calls = mockCanvas([]);

    const outcome = await run(
      {
        actions: [
          {
            type: 'create-canvas-item',
            folder: '01-intro',
            canvasModuleId: 10,
            itemPath: '01-intro/04-lab.md',
            title: 'Week 1 lab',
            canvasType: 'external_tool',
            indent: 0,
            position: 1,
          },
        ],
      },
      { courseDir, state },
    );

    assert.deepEqual(calls, [], 'no probe and no create without a launch URL');
    assert.deepEqual(outcome.applied, []);
    assert.equal(outcome.errors.length, 1);
    assert.match(outcome.errors[0].error, /names no external_url/);
    assert.deepEqual(state.modules['01-intro'].items, {});
  });

  it('writes title: into a file it creates the Canvas object from', async () => {
    silence();
    // The filename is the address and `title:` is the display name. Without
    // the title in the file, the scanner derives one from the filename, so
    // renaming the file would rename the Canvas item.
    const courseDir = tempCourse({
      '01-intro/01-welcome.md': 'Just a body, no frontmatter at all.\n',
    });
    const state = emptyState();
    state.modules['01-intro'] = {
      canvas_module_id: 10,
      item_order: [],
      items: {},
    };
    mockCanvas([
      {
        method: 'POST',
        path: '/modules/10/items',
        body: {
          id: 91,
          type: 'Page',
          title: 'Welcome',
          page_url: 'welcome',
          indent: 0,
        },
      },
      {
        method: 'POST',
        path: '/pages',
        body: {
          page_id: 501,
          url: 'welcome',
          title: 'Welcome',
          body: '<p>Just a body, no frontmatter at all.</p>',
          updated_at: '2026-08-20T11:00:00.000Z',
        },
      },
    ]);

    const outcome = await run(
      {
        actions: [
          {
            type: 'create-canvas-item',
            folder: '01-intro',
            canvasModuleId: 10,
            itemPath: '01-intro/01-welcome.md',
            title: 'Welcome',
            canvasType: 'page',
            indent: 0,
            position: 1,
          },
        ],
      },
      { courseDir, state },
    );

    assert.deepEqual(outcome.errors, []);
    const written = fs.readFileSync(
      path.join(courseDir, '01-intro/01-welcome.md'),
      'utf8',
    );
    assert.match(written, /^---\ntitle: Welcome\n/, 'no title: was written');

    // The row has to describe the file including that line, or the very next
    // run reads the item as changed locally and pushes it again.
    const row = state.modules['01-intro'].items['01-intro/01-welcome.md'];
    assert.equal(
      row.local_hash,
      hashLocalFile(path.join(courseDir, '01-intro/01-welcome.md')),
    );
  });

  it('leaves a title the author already wrote exactly as it is', async () => {
    silence();
    const original =
      '---\ntitle: The author\u2019s own title\ncanvas_type: page\n---\n\nBody.\n';
    const courseDir = tempCourse({ '01-intro/01-welcome.md': original });
    const state = emptyState();
    state.modules['01-intro'] = {
      canvas_module_id: 10,
      item_order: [],
      items: {},
    };
    mockCanvas([
      {
        method: 'POST',
        path: '/modules/10/items',
        body: {
          id: 91,
          type: 'Page',
          title: 'The author\u2019s own title',
          page_url: 'welcome',
          indent: 0,
        },
      },
      {
        method: 'POST',
        path: '/pages',
        body: {
          page_id: 501,
          url: 'welcome',
          title: 'The author\u2019s own title',
          body: '<p>Body.</p>',
          updated_at: '2026-08-20T11:00:00.000Z',
        },
      },
    ]);

    await run(
      {
        actions: [
          {
            type: 'create-canvas-item',
            folder: '01-intro',
            canvasModuleId: 10,
            itemPath: '01-intro/01-welcome.md',
            title: 'The author\u2019s own title',
            canvasType: 'page',
            indent: 0,
            position: 1,
          },
        ],
      },
      { courseDir, state },
    );

    assert.equal(
      fs.readFileSync(path.join(courseDir, '01-intro/01-welcome.md'), 'utf8'),
      original,
      'the file must not have been rewritten',
    );
  });

  it('adds title: to a hand-written block without rewriting the rest', async () => {
    silence();
    // The write used to go back through `matter.stringify`, which renders the
    // *parsed* object: the comment was deleted outright, `canvas_type:   `
    // lost its spacing and the inline list became a two-line one. All three on
    // a file this run had otherwise only read.
    const original = [
      '---',
      '# The Canvas type is deliberate: this is graded.',
      'canvas_type:   assignment',
      'tags: [ intro , welcome ]',
      'points_possible: 20',
      '---',
      '',
      'Hand in your work here.',
      '',
    ].join('\n');
    const courseDir = tempCourse({ '01-intro/01-first-task.md': original });
    const state = emptyState();
    state.modules['01-intro'] = {
      canvas_module_id: 10,
      item_order: [],
      items: {},
    };
    mockCanvas([
      {
        method: 'POST',
        path: '/assignments',
        body: {
          id: 701,
          name: 'First Task',
          description: '<p>Hand in your work here.</p>',
          updated_at: '2026-08-20T11:00:00.000Z',
        },
      },
      {
        method: 'POST',
        path: '/modules/10/items',
        body: { id: 91, type: 'Assignment', content_id: 701, indent: 0 },
      },
    ]);

    const outcome = await run(
      {
        actions: [
          {
            type: 'create-canvas-item',
            folder: '01-intro',
            canvasModuleId: 10,
            itemPath: '01-intro/01-first-task.md',
            title: 'First Task',
            canvasType: 'assignment',
            indent: 0,
            position: 1,
          },
        ],
      },
      { courseDir, state },
    );
    assert.deepEqual(outcome.errors, []);

    const written = fs.readFileSync(
      path.join(courseDir, '01-intro/01-first-task.md'),
      'utf8',
    );
    assert.equal(
      written,
      [
        '---',
        'title: First Task',
        '# The Canvas type is deliberate: this is graded.',
        'canvas_type:   assignment',
        'tags: [ intro , welcome ]',
        'points_possible: 20',
        '---',
        '',
        'Hand in your work here.',
        '',
      ].join('\n'),
      'the only difference may be the one line that was added',
    );

    // Asserted on the parsed block as well as on the bytes. Text that looks
    // right can still parse wrong — a second `---` block above the author's
    // reads as one line added and demotes every key below it into the body.
    assert.deepEqual(parseFrontmatter(written).data, {
      title: 'First Task',
      canvas_type: 'assignment',
      tags: ['intro', 'welcome'],
      points_possible: 20,
    });

    // And the row still describes the bytes on disk, which is what stops the
    // next run reading the added line as a local change.
    assert.equal(
      state.modules['01-intro'].items['01-intro/01-first-task.md'].local_hash,
      hashLocalFile(path.join(courseDir, '01-intro/01-first-task.md')),
    );
  });

  it('adds no title at all to a block whose fence never closes', async () => {
    silence();
    const warnings = [];
    // The refusal, exercised where it actually runs. `writeTitleIfAbsent`
    // parses the file and then hands `insertFrontmatterKey` the same string,
    // and gray-matter caches by input string: the cached copy it returns on
    // that second call is missing `.matter`, which is a non-enumerable
    // property `Object.assign` does not carry. A guard reading `.matter`
    // therefore never fired in production and fired every time in a unit test
    // calling the helper on a fresh string. What got through instead was a
    // *second* frontmatter block above the author's, which pushes every key
    // below it into the body: the item silently stops being an assignment.
    const original = '---\ncanvas_type: assignment\npoints_possible: 20\n';
    const courseDir = tempCourse({ '01-intro/01-first-task.md': original });
    const state = emptyState();
    state.modules['01-intro'] = {
      canvas_module_id: 10,
      item_order: [],
      items: {},
    };
    mockCanvas([
      {
        method: 'POST',
        path: '/assignments',
        body: {
          id: 701,
          name: 'First Task',
          description: '',
          updated_at: '2026-08-20T11:00:00.000Z',
        },
      },
      {
        method: 'POST',
        path: '/modules/10/items',
        body: { id: 91, type: 'Assignment', content_id: 701, indent: 0 },
      },
    ]);

    const outcome = await run(
      {
        actions: [
          {
            type: 'create-canvas-item',
            folder: '01-intro',
            canvasModuleId: 10,
            itemPath: '01-intro/01-first-task.md',
            title: 'First Task',
            canvasType: 'assignment',
            indent: 0,
            position: 1,
          },
        ],
      },
      {
        courseDir,
        state,
        log: {
          info: () => {},
          verbose: () => {},
          warn: (line) => warnings.push(line),
          error: () => {},
        },
      },
    );
    assert.deepEqual(outcome.errors, [], 'the push itself still goes through');

    const written = fs.readFileSync(
      path.join(courseDir, '01-intro/01-first-task.md'),
      'utf8',
    );
    // The assertion that matters is what the file *parses* as, not what it
    // reads as. Both of the author's keys have to still be frontmatter.
    assert.deepEqual(parseFrontmatter(written).data, {
      canvas_type: 'assignment',
      points_possible: 20,
    });
    assert.equal(written, original, 'and not a byte was written at all');

    // And the author is told, because a Canvas item that keeps taking its name
    // from its filename is not something to fix silently.
    assert.equal(warnings.length, 1);
    assert.match(
      warnings[0],
      /Left the frontmatter of 01-intro\/01-first-task\.md/,
    );
  });

  it('refuses to write a link stub with no launch URL, and carries on', async () => {
    silence();
    // The action cannot describe a link, so the content cache is the supported
    // path. A caller that does not pass it gets an error for that one action —
    // never a file that looks like a link and points nowhere, which the next
    // run would read as done and never retry.
    const courseDir = tempCourse();
    const state = emptyState();
    state.modules['01-intro'] = {
      canvas_module_id: 10,
      item_order: [],
      items: {},
    };
    mockCanvas([]);

    const outcome = await run(
      {
        actions: [
          {
            type: 'create-local-item',
            folder: '01-intro',
            itemPath: '01-intro/01-docs.md',
            canvasModuleId: 10,
            moduleItemId: 95,
            canvasType: 'external_url',
            canvasId: 95,
            title: 'Docs',
            indent: 0,
            position: 1,
            canvasHash: 'whatever',
          },
        ],
      },
      { courseDir, state, canvasContent: new Map() },
    );

    assert.equal(outcome.errors.length, 1);
    assert.match(outcome.errors[0].error, /launch URL/);
    assert.equal(
      fs.existsSync(path.join(courseDir, '01-intro/01-docs.md')),
      false,
      'no stub may be left behind',
    );
    assert.equal(
      state.modules['01-intro'].items['01-intro/01-docs.md'],
      undefined,
    );
  });

  it('writes the link stub when the content cache supplies the URL', async () => {
    silence();
    const courseDir = tempCourse();
    const state = emptyState();
    state.modules['01-intro'] = {
      canvas_module_id: 10,
      item_order: [],
      items: {},
    };
    mockCanvas([]);

    const outcome = await run(
      {
        actions: [
          {
            type: 'create-local-item',
            folder: '01-intro',
            itemPath: '01-intro/01-docs.md',
            canvasModuleId: 10,
            moduleItemId: 95,
            canvasType: 'external_url',
            canvasId: 95,
            title: 'Docs',
            indent: 0,
            position: 1,
            canvasHash: 'whatever',
          },
        ],
      },
      {
        courseDir,
        state,
        canvasContent: new Map([
          [
            '95',
            {
              item: {
                id: 95,
                type: 'ExternalUrl',
                title: 'Docs',
                external_url: 'https://example.com',
                new_tab: true,
                indent: 0,
              },
              content: null,
            },
          ],
        ]),
      },
    );

    assert.deepEqual(outcome.errors, []);
    const written = fs.readFileSync(
      path.join(courseDir, '01-intro/01-docs.md'),
      'utf8',
    );
    // The YAML serializer quotes a URL; the assertion should not care.
    assert.match(written, /external_url: '?https:\/\/example\.com'?/);
    assert.match(written, /title: Docs/);
  });

  it('refuses to write a quiz reference the module item names no quiz for', async () => {
    silence();
    // Same failure shape as the URL-less link: a reference file that looks
    // synced, names no Canvas object, and is never retried because the next run
    // finds a local file with a base row behind it.
    const courseDir = tempCourse();
    const state = emptyState();
    state.modules['01-intro'] = {
      canvas_module_id: 10,
      item_order: [],
      items: {},
    };
    mockCanvas([]);

    const outcome = await run(
      {
        actions: [
          {
            type: 'create-local-item',
            folder: '01-intro',
            itemPath: '01-intro/01-midterm.md',
            canvasModuleId: 10,
            moduleItemId: 96,
            canvasType: 'quiz',
            canvasId: null,
            title: 'Midterm',
            indent: 0,
            position: 1,
            canvasHash: 'quiz-hash',
          },
        ],
      },
      { courseDir, state, canvasContent: new Map() },
    );

    assert.equal(outcome.errors.length, 1);
    assert.match(outcome.errors[0].error, /content_id/);
    assert.match(outcome.errors[0].error, /Midterm/);
    assert.match(outcome.errors[0].error, /No file was written/);
    assert.equal(
      fs.existsSync(path.join(courseDir, '01-intro/01-midterm.md')),
      false,
      'no reference file may be left behind',
    );
    assert.equal(
      state.modules['01-intro'].items['01-intro/01-midterm.md'],
      undefined,
      'and no row, or the next run would read the item as done',
    );
  });

  it('writes the quiz reference when the module item does name one', async () => {
    silence();
    const courseDir = tempCourse();
    const state = emptyState();
    state.modules['01-intro'] = {
      canvas_module_id: 10,
      item_order: [],
      items: {},
    };
    mockCanvas([]);

    const outcome = await run(
      {
        actions: [
          {
            type: 'create-local-item',
            folder: '01-intro',
            itemPath: '01-intro/01-midterm.md',
            canvasModuleId: 10,
            moduleItemId: 96,
            canvasType: 'quiz',
            canvasId: 314,
            title: 'Midterm',
            indent: 0,
            position: 1,
            canvasHash: 'quiz-hash',
          },
        ],
      },
      { courseDir, state, canvasContent: new Map() },
    );

    assert.deepEqual(outcome.errors, []);
    const written = fs.readFileSync(
      path.join(courseDir, '01-intro/01-midterm.md'),
      'utf8',
    );
    assert.match(written, /title: Midterm/);
    assert.match(written, /canvas_type: quiz/);
    // Which Canvas object a file is lives in the sync state, keyed by path —
    // never in the frontmatter.
    assert.equal(
      state.modules['01-intro'].items['01-intro/01-midterm.md'].canvas_id,
      314,
    );
  });

  it('uploads the alert icons before it renders a page that uses one', async () => {
    silence();
    // `applyPlan` reads `getIconUrls`, so the engine has to be what calls
    // `ensureIcons` too. Without it the callout goes to Canvas with no <img> —
    // `markdownToHtml` omits it silently when the URL is missing — and the page
    // is then fingerprinted as synced, so nothing ever puts the icon back.
    const courseDir = tempCourse({
      '01-intro/01-welcome.md':
        '---\ntitle: Welcome\n---\n\n> [!NOTE]\n> Careful.\n',
    });
    const state = emptyState();
    state.icons = {};
    state.modules['01-intro'] = {
      canvas_module_id: 10,
      item_order: [],
      items: {},
    };

    const calls = mockCanvas([
      ...iconUploadRoutes(),
      {
        method: 'POST',
        path: '/modules/10/items',
        body: {
          id: 91,
          type: 'Page',
          title: 'Welcome',
          page_url: 'welcome',
          indent: 0,
        },
      },
      {
        method: 'POST',
        path: '/pages',
        body: {
          page_id: 501,
          url: 'welcome',
          title: 'Welcome',
          body: '<p>whatever Canvas stored</p>',
          updated_at: '2026-08-20T11:00:00.000Z',
        },
      },
    ]);

    const outcome = await run(
      {
        actions: [
          {
            type: 'create-canvas-item',
            folder: '01-intro',
            canvasModuleId: 10,
            itemPath: '01-intro/01-welcome.md',
            title: 'Welcome',
            canvasType: 'page',
            indent: 0,
            position: 1,
          },
        ],
      },
      { courseDir, state },
    );

    assert.deepEqual(outcome.errors, []);
    // The icons exist on Canvas and are recorded.
    assert.equal(Object.keys(state.icons).length, ICON_COUNT);
    assert.ok(state.icons.note.preview_url);
    // And the body Canvas was handed names one.
    const [pagePost] = calls.filter(
      (call) => call.method === 'POST' && /\/pages$/.test(call.url),
    );
    assert.match(pagePost.body.wiki_page.body, /<img[^>]+src="[^"]*preview"/);
  });

  it('writes nothing at all when the icons cannot be uploaded', async () => {
    silence();
    // Carrying on would push the page with its callouts unmarked and record it
    // as synced, which is the permanent silent failure the icon upload exists
    // to prevent. Nothing has been written yet at this point, so stopping is
    // free — and whatever did upload is kept, so the next run resumes.
    const courseDir = tempCourse({
      '01-intro/01-welcome.md':
        '---\ntitle: Welcome\n---\n\n> [!NOTE]\n> Careful.\n',
    });
    const state = emptyState();
    state.icons = {};
    state.modules['01-intro'] = {
      canvas_module_id: 10,
      item_order: [],
      items: {},
    };

    // Only the first icon can be uploaded. The second asks for a grant, finds
    // no route left, and throws.
    const [firstGrant, firstUpload] = iconUploadRoutes();
    const saves = [];
    const calls = mockCanvas([
      firstGrant,
      firstUpload,
      {
        method: 'POST',
        path: '/modules/10/items',
        body: { id: 91, type: 'Page', title: 'Welcome' },
      },
      {
        method: 'POST',
        path: '/pages',
        body: {
          page_id: 501,
          url: 'welcome',
          title: 'Welcome',
          body: '<p>x</p>',
        },
      },
    ]);

    const outcome = await run(
      {
        actions: [
          {
            type: 'create-canvas-item',
            folder: '01-intro',
            canvasModuleId: 10,
            itemPath: '01-intro/01-welcome.md',
            title: 'Welcome',
            canvasType: 'page',
            indent: 0,
            position: 1,
          },
        ],
      },
      { courseDir, state, save: () => saves.push(true) },
    );

    // No content reached Canvas: the page and module-item routes are untouched.
    assert.equal(
      calls.filter((call) => /\/pages$/.test(call.url)).length,
      0,
      'a page was pushed without its icons',
    );
    assert.equal(
      calls.filter((call) => call.url.includes('/modules/10/items')).length,
      0,
    );
    assert.deepEqual(outcome.applied, []);

    // The error says what failed and that nothing was written.
    assert.equal(outcome.errors.length, 1);
    assert.equal(outcome.errors[0].action.type, 'ensure-icons');
    assert.match(outcome.errors[0].error, /alert icons could not be uploaded/);
    assert.match(outcome.errors[0].error, /nothing was written on either side/);

    // Partial progress survives, so the next run does not upload a second copy.
    assert.equal(state.icons.note.canvas_file_id, 900);
    assert.equal(Object.keys(state.icons).length, 1);
    assert.equal(saves.length, 1, 'what did upload was not saved');

    // And no sync is claimed, because none happened.
    assert.equal(state.last_sync, null);
  });

  it('uploads no icon at all on a run that only writes locally', async () => {
    silence();
    // The icons are files in the Canvas course. A run that writes nothing there
    // has no business putting anything in it, so the absence of an upload route
    // is the assertion: one request and the run would fail.
    const courseDir = tempCourse();
    const state = emptyState();
    state.icons = {};
    state.modules['01-intro'] = {
      canvas_module_id: 10,
      item_order: [],
      items: {},
    };

    const outcome = await run(
      {
        actions: [
          {
            type: 'create-local-item',
            folder: '01-intro',
            itemPath: '01-intro/01-docs.md',
            canvasModuleId: 10,
            moduleItemId: 95,
            canvasType: 'external_url',
            canvasId: 95,
            title: 'Docs',
            indent: 0,
            position: 1,
            canvasHash: 'whatever',
          },
        ],
      },
      {
        courseDir,
        state,
        canvasContent: new Map([
          [
            '95',
            {
              item: {
                id: 95,
                type: 'ExternalUrl',
                title: 'Docs',
                external_url: 'https://example.com',
                indent: 0,
              },
              content: null,
            },
          ],
        ]),
      },
    );

    assert.deepEqual(outcome.errors, []);
    assert.deepEqual(state.icons, {}, 'a local-only run uploaded an icon');
  });

  it('does not upload an icon the state already records under this theme', async () => {
    silence();
    // No upload routes at all: `ensureIcons` skips an icon whose stored theme
    // fingerprint still matches, and that record is the whole of its
    // idempotency.
    const courseDir = tempCourse({
      '01-intro/01-welcome.md':
        '---\ntitle: Welcome\n---\n\n> [!NOTE]\n> Careful.\n',
    });
    const state = emptyState();
    state.icons = recordedIcons();
    state.modules['01-intro'] = {
      canvas_module_id: 10,
      item_order: [],
      items: {},
    };

    const calls = mockCanvas([
      {
        method: 'POST',
        path: '/modules/10/items',
        body: {
          id: 91,
          type: 'Page',
          title: 'Welcome',
          page_url: 'welcome',
          indent: 0,
        },
      },
      {
        method: 'POST',
        path: '/pages',
        body: {
          page_id: 501,
          url: 'welcome',
          title: 'Welcome',
          body: '<p>stored</p>',
          updated_at: '2026-08-20T11:00:00.000Z',
        },
      },
    ]);

    const outcome = await run(
      {
        actions: [
          {
            type: 'create-canvas-item',
            folder: '01-intro',
            canvasModuleId: 10,
            itemPath: '01-intro/01-welcome.md',
            title: 'Welcome',
            canvasType: 'page',
            indent: 0,
            position: 1,
          },
        ],
      },
      { courseDir, state },
    );

    assert.deepEqual(outcome.errors, []);
    assert.equal(
      calls.filter((call) => /\/courses\/\d+\/files$/.test(call.url)).length,
      0,
      'an icon was uploaded a second time',
    );
    // The recorded URLs are still the ones the render used.
    const [pagePost] = calls.filter(
      (call) => call.method === 'POST' && /\/pages$/.test(call.url),
    );
    assert.match(
      pagePost.body.wiki_page.body,
      /src="https:\/\/canvas\.example\.com\/recorded\/note"/,
    );
  });

  it('deletes a quiz item without touching the quiz behind it', async () => {
    silence();
    const state = emptyState();
    state.modules['01-intro'] = {
      canvas_module_id: 10,
      item_order: ['01-intro/01-test.md'],
      items: {
        '01-intro/01-test.md': {
          canvas_type: 'quiz',
          canvas_id: 700,
          module_item_id: 93,
        },
      },
    };
    const calls = mockCanvas([
      { method: 'DELETE', path: '/modules/10/items/93', body: {} },
    ]);

    await run(
      {
        actions: [
          {
            type: 'delete-canvas-item',
            folder: '01-intro',
            canvasModuleId: 10,
            itemPath: '01-intro/01-test.md',
            moduleItemId: 93,
            canvasType: 'quiz',
            canvasId: 700,
          },
        ],
      },
      { state, courseDir: tempCourse() },
    );

    assert.equal(calls.length, 1);
    assert.equal(calledWith(calls, 'DELETE', '/quizzes').length, 0);
    assert.equal(
      state.modules['01-intro'].items['01-intro/01-test.md'],
      undefined,
    );
  });

  it('does not read "404" in an error message as the item being gone', async () => {
    silence();
    // The already-gone check used to string-match the message, and the message
    // ends with the request path and the response body — so refusing to delete
    // a page whose very slug contains "404" was swallowed as "already gone",
    // the row dropped, and a delete reported that never happened. Only a typed
    // 404 answer means the object is absent; any other refusal must surface
    // and keep the row.
    const state = emptyState();
    state.modules['01-intro'] = {
      canvas_module_id: 10,
      item_order: ['01-intro/01-errors.md'],
      items: {
        '01-intro/01-errors.md': {
          canvas_type: 'page',
          canvas_id: 'fixing-404-errors',
          page_url: 'fixing-404-errors',
          module_item_id: 93,
        },
      },
    };
    mockCanvas([
      {
        method: 'DELETE',
        path: '/pages/fixing-404-errors',
        body: { message: 'unauthorized' },
        status: 403,
      },
    ]);

    const outcome = await run(
      {
        actions: [
          {
            type: 'delete-canvas-item',
            folder: '01-intro',
            canvasModuleId: 10,
            itemPath: '01-intro/01-errors.md',
            moduleItemId: 93,
            canvasType: 'page',
            pageUrl: 'fixing-404-errors',
          },
        ],
      },
      { state, courseDir: tempCourse() },
    );

    assert.equal(outcome.errors.length, 1);
    assert.match(outcome.errors[0].error, /status 403/);
    // The row survives, so the next run tries again instead of forgetting the
    // page ever existed.
    assert.notEqual(
      state.modules['01-intro'].items['01-intro/01-errors.md'],
      undefined,
    );
  });

  it('moves an item to another module without changing its id', async () => {
    silence();
    const state = emptyState();
    state.modules['01-intro'] = {
      canvas_module_id: 10,
      item_order: [],
      items: {},
    };
    state.modules['02-next'] = {
      canvas_module_id: 20,
      item_order: ['02-next/01-a.md'],
      items: { '02-next/01-a.md': { canvas_type: 'page', module_item_id: 91 } },
    };
    const calls = mockCanvas([
      { method: 'PUT', path: '/modules/10/items/91', body: { id: 91 } },
    ]);

    await run(
      {
        actions: [
          {
            type: 'move-canvas-item',
            itemPath: '02-next/01-a.md',
            fromFolder: '01-intro',
            toFolder: '02-next',
            fromCanvasModuleId: 10,
            toCanvasModuleId: 20,
            moduleItemId: 91,
            canvasType: 'page',
            title: 'A',
            indent: 0,
            position: 1,
          },
        ],
      },
      { state, courseDir: tempCourse() },
    );

    const [put] = calledWith(calls, 'PUT', '/modules/10/items/91');
    assert.equal(put.body.module_item.module_id, 20);
    assert.equal(
      state.modules['02-next'].items['02-next/01-a.md'].module_item_id,
      91,
    );
  });

  it('reorders a module by position, in ascending order', async () => {
    silence();
    const state = emptyState();
    state.modules['01-intro'] = {
      canvas_module_id: 10,
      item_order: ['01-intro/01-a.md', '01-intro/02-b.md'],
      items: {
        '01-intro/01-a.md': { canvas_type: 'page', module_item_id: 91 },
        '01-intro/02-b.md': { canvas_type: 'page', module_item_id: 92 },
      },
    };
    const calls = mockCanvas([
      { method: 'PUT', path: '/modules/10/items/92', body: { id: 92 } },
      { method: 'PUT', path: '/modules/10/items/91', body: { id: 91 } },
    ]);

    await run(
      {
        actions: [
          {
            type: 'reorder-canvas-module',
            folder: '01-intro',
            canvasModuleId: 10,
            order: [
              { itemPath: '01-intro/02-b.md', moduleItemId: 92, position: 1 },
              { itemPath: '01-intro/01-a.md', moduleItemId: 91, position: 2 },
            ],
          },
        ],
      },
      { state, courseDir: tempCourse() },
    );

    assert.deepEqual(
      calls.map((call) => [
        call.url.split('/').pop(),
        call.body.module_item.position,
      ]),
      [
        ['92', 1],
        ['91', 2],
      ],
    );
    assert.deepEqual(state.modules['01-intro'].item_order, [
      '01-intro/02-b.md',
      '01-intro/01-a.md',
    ]);
  });

  it('names the item it could not reposition and keeps the recorded order', async () => {
    silence();
    // An item the state holds no module item id for — a create that failed
    // earlier in this same run is the ordinary way to get one — used to be
    // skipped without a word while `item_order` was written from the plan.
    // Canvas shifts the skipped item as its neighbours are placed, and the same
    // shifting carries the items that did move away from the positions they
    // were sent to, so the plan describes an arrangement Canvas never took.
    // Recording it is what makes the next run read the failure as a Canvas-side
    // reorder and renumber the author's files to match it.
    const warnings = [];
    const state = emptyState();
    state.modules['01-intro'] = {
      canvas_module_id: 7,
      item_order: ['01-intro/01-a.md', '01-intro/02-b.md', '01-intro/03-c.md'],
      items: {
        '01-intro/01-a.md': { canvas_type: 'page', module_item_id: 11 },
        '01-intro/02-b.md': { canvas_type: 'page' },
        '01-intro/03-c.md': { canvas_type: 'page', module_item_id: 13 },
      },
    };
    const calls = mockCanvas([
      { method: 'PUT', path: '/modules/7/items/13', body: { id: 13 } },
      { method: 'PUT', path: '/modules/7/items/11', body: { id: 11 } },
    ]);

    const outcome = await run(
      {
        actions: [
          {
            type: 'reorder-canvas-module',
            folder: '01-intro',
            canvasModuleId: 7,
            order: [
              { itemPath: '01-intro/03-c.md', position: 1 },
              { itemPath: '01-intro/02-b.md', position: 2 },
              { itemPath: '01-intro/01-a.md', position: 3 },
            ],
          },
        ],
      },
      {
        state,
        courseDir: tempCourse(),
        log: {
          info: () => {},
          warn: (line) => warnings.push(line),
          verbose: () => {},
          error: () => {},
        },
      },
    );

    // The rest of the module was still placed, and nothing failed.
    assert.deepEqual(outcome.errors, []);
    assert.deepEqual(
      calls.map((call) => [
        call.url.split('/').pop(),
        call.body.module_item.position,
      ]),
      [
        ['13', 1],
        ['11', 3],
      ],
    );
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /01-intro\/02-b\.md to position 2/);

    // The base is what the two sides last agreed on, and this run reached no
    // new agreement, so it stays exactly as it was.
    assert.deepEqual(state.modules['01-intro'].item_order, [
      '01-intro/01-a.md',
      '01-intro/02-b.md',
      '01-intro/03-c.md',
    ]);
  });

  it('carries on when Canvas already deleted an item mid-reorder', async () => {
    silence();
    // A stale module item id answers the position PUT with a 404: somebody
    // deleted the item behind this run's back. That is the missing-id case
    // above met one request later, and it gets the same treatment — the
    // surviving items still get their positions, the base order stays — where
    // it used to abort the loop and strand every item after the dead one.
    const warnings = [];
    const state = emptyState();
    state.modules['01-intro'] = {
      canvas_module_id: 7,
      item_order: ['01-intro/01-a.md', '01-intro/02-b.md', '01-intro/03-c.md'],
      items: {
        '01-intro/01-a.md': { canvas_type: 'page', module_item_id: 11 },
        '01-intro/02-b.md': { canvas_type: 'page', module_item_id: 12 },
        '01-intro/03-c.md': { canvas_type: 'page', module_item_id: 13 },
      },
    };
    const calls = mockCanvas([
      { method: 'PUT', path: '/modules/7/items/13', body: { id: 13 } },
      {
        method: 'PUT',
        path: '/modules/7/items/12',
        body: {
          errors: [{ message: 'The specified resource does not exist.' }],
        },
        status: 404,
      },
      { method: 'PUT', path: '/modules/7/items/11', body: { id: 11 } },
    ]);

    const outcome = await run(
      {
        actions: [
          {
            type: 'reorder-canvas-module',
            folder: '01-intro',
            canvasModuleId: 7,
            order: [
              { itemPath: '01-intro/03-c.md', position: 1 },
              { itemPath: '01-intro/02-b.md', position: 2 },
              { itemPath: '01-intro/01-a.md', position: 3 },
            ],
          },
        ],
      },
      {
        state,
        courseDir: tempCourse(),
        log: {
          info: () => {},
          warn: (line) => warnings.push(line),
          verbose: () => {},
          error: () => {},
        },
      },
    );

    // Every position was attempted, the dead item's included, and the action
    // did not fail: the items after the dead one were still placed.
    assert.deepEqual(outcome.errors, []);
    assert.deepEqual(
      calls.map((call) => call.url.split('/').pop()),
      ['13', '12', '11'],
    );
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /01-intro\/02-b\.md to position 2/);
    assert.match(warnings[0], /module item 12 is gone from Canvas/);

    // No new agreement was reached, so the base stays exactly as it was.
    assert.deepEqual(state.modules['01-intro'].item_order, [
      '01-intro/01-a.md',
      '01-intro/02-b.md',
      '01-intro/03-c.md',
    ]);
  });

  it('keeps the recorded order when a reposition fails partway through', async () => {
    silence();
    // The items before the failure moved and the rest did not, which is a
    // module in an arrangement this run cannot name. There is nothing a
    // `finally` could record that this side knows — no row is written per
    // item, and where Canvas left the ones that moved is Canvas's answer — so
    // the base stays put and the action is reported as the error it is.
    const state = emptyState();
    state.modules['01-intro'] = {
      canvas_module_id: 7,
      item_order: ['01-intro/01-a.md', '01-intro/02-b.md', '01-intro/03-c.md'],
      items: {
        '01-intro/01-a.md': { canvas_type: 'page', module_item_id: 11 },
        '01-intro/02-b.md': { canvas_type: 'page', module_item_id: 12 },
        '01-intro/03-c.md': { canvas_type: 'page', module_item_id: 13 },
      },
    };
    const calls = mockCanvas([
      { method: 'PUT', path: '/modules/7/items/13', body: { id: 13 } },
      {
        method: 'PUT',
        path: '/modules/7/items/12',
        body: { errors: [{ message: 'Access denied' }] },
        status: 403,
      },
    ]);

    const outcome = await run(
      {
        actions: [
          {
            type: 'reorder-canvas-module',
            folder: '01-intro',
            canvasModuleId: 7,
            order: [
              { itemPath: '01-intro/03-c.md', position: 1 },
              { itemPath: '01-intro/02-b.md', position: 2 },
              { itemPath: '01-intro/01-a.md', position: 3 },
            ],
          },
        ],
      },
      { state, courseDir: tempCourse() },
    );

    assert.equal(outcome.errors.length, 1);
    assert.equal(outcome.errors[0].action.type, 'reorder-canvas-module');
    // Stopped where it threw: the third item was never sent.
    assert.deepEqual(
      calls.map((call) => call.url.split('/').pop()),
      ['13', '12'],
    );
    assert.deepEqual(state.modules['01-intro'].item_order, [
      '01-intro/01-a.md',
      '01-intro/02-b.md',
      '01-intro/03-c.md',
    ]);
  });

  it('does not empty the recorded order for an order that names nothing', async () => {
    silence();
    // The sequence is rewritten wholesale, so a degenerate action would erase
    // the base every later run compares against — and a module with no base
    // order reads as one whose items all appeared since the last sync.
    const state = emptyState();
    state.modules['01-intro'] = {
      canvas_module_id: 7,
      item_order: ['01-intro/01-a.md', '01-intro/02-b.md'],
      items: {
        '01-intro/01-a.md': { canvas_type: 'page', module_item_id: 11 },
        '01-intro/02-b.md': { canvas_type: 'page', module_item_id: 12 },
      },
    };
    const calls = mockCanvas([]);

    await run(
      {
        actions: [
          {
            type: 'reorder-canvas-module',
            folder: '01-intro',
            canvasModuleId: 7,
            order: [],
          },
        ],
      },
      { state, courseDir: tempCourse() },
    );

    assert.deepEqual(calls, []);
    assert.deepEqual(state.modules['01-intro'].item_order, [
      '01-intro/01-a.md',
      '01-intro/02-b.md',
    ]);
  });

  it('warns that a graded discussion it writes locally is not the whole truth', async () => {
    // Push says this on every create and update. Without it in this direction,
    // an author who has only ever seen the file has no way to learn that
    // points, due date, grading type and group set live only in Canvas.
    const warnings = [];
    const courseDir = tempCourse();
    const state = emptyState();
    state.modules['01-intro'] = {
      canvas_module_id: 10,
      item_order: [],
      items: {},
    };
    mockCanvas([]);

    const outcome = await run(
      {
        actions: [
          {
            type: 'create-local-item',
            folder: '01-intro',
            itemPath: '01-intro/01-debate.md',
            canvasModuleId: 10,
            moduleItemId: 77,
            canvasType: 'discussion',
            canvasId: 600,
            title: 'Debate',
            indent: 0,
            position: 1,
            canvasHash: 'discussion-hash',
          },
        ],
      },
      {
        courseDir,
        state,
        log: {
          info: () => {},
          warn: (line) => warnings.push(line),
          verbose: () => {},
          error: () => {},
        },
        // The cache is the normal path: `gatherCanvas` reads every discussion
        // in one list request, so a pull never calls `getDiscussion`.
        canvasContent: new Map([
          [
            '77',
            {
              item: { id: 77, type: 'Discussion', title: 'Debate', indent: 0 },
              content: {
                id: 600,
                title: 'Debate',
                message: '<p>Argue.</p>',
                assignment_id: 9001,
              },
            },
          ],
        ]),
      },
    );

    assert.deepEqual(outcome.errors, []);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /discussion "Debate" is graded/);
    assert.match(warnings[0], /no push or pull touches them/);
  });

  it('says nothing about an ungraded discussion', async () => {
    const warnings = [];
    const courseDir = tempCourse();
    const state = emptyState();
    state.modules['01-intro'] = {
      canvas_module_id: 10,
      item_order: [],
      items: {},
    };
    mockCanvas([]);

    await run(
      {
        actions: [
          {
            type: 'create-local-item',
            folder: '01-intro',
            itemPath: '01-intro/01-chat.md',
            canvasModuleId: 10,
            moduleItemId: 78,
            canvasType: 'discussion',
            canvasId: 601,
            title: 'Chat',
            indent: 0,
            position: 1,
            canvasHash: 'discussion-hash',
          },
        ],
      },
      {
        courseDir,
        state,
        log: {
          info: () => {},
          warn: (line) => warnings.push(line),
          verbose: () => {},
          error: () => {},
        },
        canvasContent: new Map([
          [
            '78',
            {
              item: { id: 78, type: 'Discussion', title: 'Chat', indent: 0 },
              content: {
                id: 601,
                title: 'Chat',
                message: '<p>Say hello.</p>',
                assignment_id: null,
              },
            },
          ],
        ]),
      },
    );

    assert.deepEqual(warnings, []);
  });

  it('deletes a local file and its row', async () => {
    silence();
    const courseDir = tempCourse({ '01-intro/01-gone.md': 'x\n' });
    const state = emptyState();
    state.modules['01-intro'] = {
      canvas_module_id: 10,
      item_order: ['01-intro/01-gone.md'],
      items: { '01-intro/01-gone.md': { canvas_type: 'page' } },
    };
    mockCanvas([]);

    await run(
      {
        actions: [
          {
            type: 'delete-local-item',
            folder: '01-intro',
            itemPath: '01-intro/01-gone.md',
            canvasType: 'page',
          },
        ],
      },
      { courseDir, state },
    );

    assert.equal(
      fs.existsSync(path.join(courseDir, '01-intro/01-gone.md')),
      false,
    );
    assert.deepEqual(state.modules['01-intro'].items, {});
  });

  it('renames files when Canvas wins the ordering', async () => {
    silence();
    const courseDir = tempCourse({
      '01-intro/01-a.md': 'a\n',
      '01-intro/02-b.md': 'b\n',
    });
    const state = emptyState();
    state.modules['01-intro'] = {
      canvas_module_id: 10,
      item_order: ['01-intro/01-a.md', '01-intro/02-b.md'],
      items: {
        '01-intro/01-a.md': { canvas_type: 'page', canvas_id: 1 },
        '01-intro/02-b.md': { canvas_type: 'page', canvas_id: 2 },
      },
    };
    mockCanvas([]);

    await run(
      {
        actions: [
          {
            type: 'reorder-local-module',
            folder: '01-intro',
            canvasModuleId: 10,
            order: [
              { itemPath: '01-intro/02-b.md', position: 1 },
              { itemPath: '01-intro/01-a.md', position: 2 },
            ],
          },
        ],
      },
      { courseDir, state },
    );

    // The prefix is the local order, so the two files swap slots — through a
    // temporary name, or the second would land on top of the first.
    assert.equal(
      fs.readFileSync(path.join(courseDir, '01-intro/01-b.md'), 'utf8'),
      'b\n',
    );
    assert.equal(
      fs.readFileSync(path.join(courseDir, '01-intro/02-a.md'), 'utf8'),
      'a\n',
    );
    assert.equal(
      state.modules['01-intro'].items['01-intro/01-b.md'].canvas_id,
      2,
    );
    assert.deepEqual(state.modules['01-intro'].item_order, [
      '01-intro/01-b.md',
      '01-intro/02-a.md',
    ]);
  });

  it('renumbers a text header and the children its rename carries along', async () => {
    silence();
    // Parking the whole module up front looked for the children under the
    // folder's new name while the folder itself was sitting under its temporary
    // one. They were at neither name, so every child was skipped in silence and
    // the folder unparked carrying them at their old numbers — while
    // `item_order` recorded the numbers they never got, naming two paths held
    // by neither `items` nor the disk.
    const courseDir = tempCourse({
      '01-intro/01-theory/_category_.json': '{ "label": "Theory" }\n',
      '01-intro/01-theory/01-a.md': 'a\n',
      '01-intro/01-theory/02-b.md': 'b\n',
    });
    const state = emptyState();
    state.modules['01-intro'] = {
      canvas_module_id: 10,
      item_order: [
        '01-intro/01-theory',
        '01-intro/01-theory/01-a.md',
        '01-intro/01-theory/02-b.md',
      ],
      items: {
        '01-intro/01-theory': { canvas_type: 'sub_header', module_item_id: 30 },
        '01-intro/01-theory/01-a.md': { canvas_type: 'page', canvas_id: 1 },
        '01-intro/01-theory/02-b.md': { canvas_type: 'page', canvas_id: 2 },
      },
    };
    mockCanvas([]);

    await run(
      {
        actions: [
          {
            type: 'reorder-local-module',
            folder: '01-intro',
            canvasModuleId: 10,
            order: [
              { itemPath: '01-intro/01-theory', position: 2 },
              { itemPath: '01-intro/01-theory/01-a.md', position: 3 },
              { itemPath: '01-intro/01-theory/02-b.md', position: 4 },
            ],
          },
        ],
      },
      { courseDir, state },
    );

    assert.equal(
      fs.readFileSync(
        path.join(courseDir, '01-intro/02-theory/03-a.md'),
        'utf8',
      ),
      'a\n',
    );
    assert.equal(
      fs.readFileSync(
        path.join(courseDir, '01-intro/02-theory/04-b.md'),
        'utf8',
      ),
      'b\n',
    );
    // Rows and order describe the tree, and therefore each other.
    assert.deepEqual(Object.keys(state.modules['01-intro'].items).sort(), [
      '01-intro/02-theory',
      '01-intro/02-theory/03-a.md',
      '01-intro/02-theory/04-b.md',
    ]);
    assert.equal(
      state.modules['01-intro'].items['01-intro/02-theory/03-a.md'].canvas_id,
      1,
    );
    assert.deepEqual(state.modules['01-intro'].item_order, [
      '01-intro/02-theory',
      '01-intro/02-theory/03-a.md',
      '01-intro/02-theory/04-b.md',
    ]);
    for (const itemPath of state.modules['01-intro'].item_order) {
      assert.equal(
        fs.existsSync(path.join(courseDir, itemPath)),
        true,
        `${itemPath} is named in item_order but is not on disk`,
      );
    }
  });

  it('parks two children that swap slots inside a folder that moved too', async () => {
    silence();
    // What the parking exists for, in the one shape that produces it: two items
    // whose names differ only in the prefix, each moving onto the other's. And
    // in a subfolder that is itself moving, so the swap happens a level below a
    // rename — parking per level is what has to keep holding.
    const courseDir = tempCourse({
      '01-intro/02-part/_category_.json': '{ "label": "Part" }\n',
      '01-intro/02-part/02-exercise.md': 'second\n',
      '01-intro/02-part/03-exercise.md': 'third\n',
    });
    const state = emptyState();
    state.modules['01-intro'] = {
      canvas_module_id: 10,
      item_order: [
        '01-intro/02-part',
        '01-intro/02-part/02-exercise.md',
        '01-intro/02-part/03-exercise.md',
      ],
      items: {
        '01-intro/02-part': { canvas_type: 'sub_header', module_item_id: 30 },
        '01-intro/02-part/02-exercise.md': {
          canvas_type: 'page',
          canvas_id: 2,
        },
        '01-intro/02-part/03-exercise.md': {
          canvas_type: 'page',
          canvas_id: 3,
        },
      },
    };
    mockCanvas([]);

    await run(
      {
        actions: [
          {
            type: 'reorder-local-module',
            folder: '01-intro',
            canvasModuleId: 10,
            order: [
              { itemPath: '01-intro/02-part', position: 1 },
              { itemPath: '01-intro/02-part/03-exercise.md', position: 2 },
              { itemPath: '01-intro/02-part/02-exercise.md', position: 3 },
            ],
          },
        ],
      },
      { courseDir, state },
    );

    assert.equal(
      fs.readFileSync(
        path.join(courseDir, '01-intro/01-part/02-exercise.md'),
        'utf8',
      ),
      'third\n',
    );
    assert.equal(
      fs.readFileSync(
        path.join(courseDir, '01-intro/01-part/03-exercise.md'),
        'utf8',
      ),
      'second\n',
    );
    assert.deepEqual(
      fs
        .readdirSync(path.join(courseDir, '01-intro/01-part'))
        .filter((entry) => entry.startsWith('__cw_order_')),
      [],
    );
    // The Canvas ids swapped with the files, not with the names.
    assert.equal(
      state.modules['01-intro'].items['01-intro/01-part/02-exercise.md']
        .canvas_id,
      3,
    );
    assert.equal(
      state.modules['01-intro'].items['01-intro/01-part/03-exercise.md']
        .canvas_id,
      2,
    );
    assert.deepEqual(state.modules['01-intro'].item_order, [
      '01-intro/01-part',
      '01-intro/01-part/02-exercise.md',
      '01-intro/01-part/03-exercise.md',
    ]);
  });

  it('names the file it was told to renumber and could not find', async () => {
    silence();
    // A source missing at parking time is either a file the author deleted in
    // the seconds since the scan or a caller handing over a path that was never
    // there. Both used to `continue` without a word, which is how a bug of the
    // second kind stayed invisible. The item keeps its number while everything
    // around it moves, so the module ends up in an order nobody asked for —
    // here, two items numbered 02.
    const warnings = [];
    const courseDir = tempCourse({
      '01-intro/01-a.md': 'a\n',
      '01-intro/03-c.md': 'c\n',
    });
    const state = emptyState();
    state.modules['01-intro'] = {
      canvas_module_id: 10,
      item_order: ['01-intro/01-a.md', '01-intro/02-b.md', '01-intro/03-c.md'],
      items: {
        '01-intro/01-a.md': { canvas_type: 'page', canvas_id: 1 },
        '01-intro/02-b.md': { canvas_type: 'page', canvas_id: 2 },
        '01-intro/03-c.md': { canvas_type: 'page', canvas_id: 3 },
      },
    };
    mockCanvas([]);

    const outcome = await run(
      {
        actions: [
          {
            type: 'reorder-local-module',
            folder: '01-intro',
            canvasModuleId: 10,
            order: [
              { itemPath: '01-intro/03-c.md', position: 1 },
              { itemPath: '01-intro/01-a.md', position: 2 },
              { itemPath: '01-intro/02-b.md', position: 3 },
            ],
          },
        ],
      },
      {
        courseDir,
        state,
        log: {
          info: () => {},
          warn: (line) => warnings.push(line),
          verbose: () => {},
          error: () => {},
        },
      },
    );

    assert.equal(outcome.errors.length, 0);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /nothing at 01-intro\/02-b\.md/);

    // The rest of the module still moved.
    assert.equal(
      fs.readFileSync(path.join(courseDir, '01-intro/01-c.md'), 'utf8'),
      'c\n',
    );
    assert.equal(
      fs.readFileSync(path.join(courseDir, '01-intro/02-a.md'), 'utf8'),
      'a\n',
    );
    // And the order says where things are, not where they were sent: the item
    // that did not move keeps the number it had, clashing with the one that
    // took its slot.
    assert.deepEqual(state.modules['01-intro'].item_order, [
      '01-intro/01-c.md',
      '01-intro/02-a.md',
      '01-intro/02-b.md',
    ]);
    assert.equal(
      state.modules['01-intro'].items['01-intro/02-b.md'].canvas_id,
      2,
    );
  });

  it('puts every parked file back when a rename fails partway through', async () => {
    silence();
    // A throw in the parking half used to leave the files it had already moved
    // sitting under a name `scanCourse` skips. The next run read them as
    // locally deleted, and `push --prune-canvas` would offer to delete their
    // Canvas objects — so the failure did not stay local.
    const courseDir = tempCourse({
      '01-intro/01-a.md': 'a\n',
      '01-intro/02-b.md': 'b\n',
      '01-intro/03-c.md': 'c\n',
    });
    const state = emptyState();
    state.modules['01-intro'] = {
      canvas_module_id: 10,
      item_order: ['01-intro/01-a.md', '01-intro/02-b.md', '01-intro/03-c.md'],
      items: {
        '01-intro/01-a.md': { canvas_type: 'page', canvas_id: 1 },
        '01-intro/02-b.md': { canvas_type: 'page', canvas_id: 2 },
        '01-intro/03-c.md': { canvas_type: 'page', canvas_id: 3 },
      },
    };
    mockCanvas([]);

    const realRename = fs.renameSync;
    let renames = 0;
    mock.method(fs, 'renameSync', (from, to) => {
      renames += 1;
      if (renames === 3) throw new Error('EPERM: operation not permitted');
      return realRename(from, to);
    });

    const outcome = await run(
      {
        actions: [
          {
            type: 'reorder-local-module',
            folder: '01-intro',
            canvasModuleId: 10,
            order: [
              { itemPath: '01-intro/02-b.md', position: 1 },
              { itemPath: '01-intro/03-c.md', position: 2 },
              { itemPath: '01-intro/01-a.md', position: 3 },
            ],
          },
        ],
      },
      { courseDir, state },
    );

    assert.equal(outcome.errors.length, 1);
    assert.match(outcome.errors[0].error, /EPERM/);

    // Every file is back under the name it had, and nothing is left parked.
    assert.equal(
      fs.readFileSync(path.join(courseDir, '01-intro/01-a.md'), 'utf8'),
      'a\n',
    );
    assert.equal(
      fs.readFileSync(path.join(courseDir, '01-intro/02-b.md'), 'utf8'),
      'b\n',
    );
    assert.equal(
      fs.readFileSync(path.join(courseDir, '01-intro/03-c.md'), 'utf8'),
      'c\n',
    );
    assert.deepEqual(
      fs
        .readdirSync(path.join(courseDir, '01-intro'))
        .filter((entry) => entry.startsWith('__cw_order_')),
      [],
    );
    assert.deepEqual(state.modules['01-intro'].item_order, [
      '01-intro/01-a.md',
      '01-intro/02-b.md',
      '01-intro/03-c.md',
    ]);
  });

  it('names the files by path when the unwind itself cannot put one back', async () => {
    silence();
    const courseDir = tempCourse({
      '01-intro/01-a.md': 'a\n',
      '01-intro/02-b.md': 'b\n',
    });
    const state = emptyState();
    state.modules['01-intro'] = {
      canvas_module_id: 10,
      item_order: ['01-intro/01-a.md', '01-intro/02-b.md'],
      items: {
        '01-intro/01-a.md': { canvas_type: 'page', canvas_id: 1 },
        '01-intro/02-b.md': { canvas_type: 'page', canvas_id: 2 },
      },
    };
    mockCanvas([]);

    // Park b (it moves first, into slot 1), fail parking a, then fail putting b
    // back. Swallowing that leaves a file on disk under a name nothing would
    // ever look for again.
    const realRename = fs.renameSync;
    let renames = 0;
    mock.method(fs, 'renameSync', (from, to) => {
      renames += 1;
      if (renames >= 2) throw new Error('EPERM: operation not permitted');
      return realRename(from, to);
    });

    const outcome = await run(
      {
        actions: [
          {
            type: 'reorder-local-module',
            folder: '01-intro',
            canvasModuleId: 10,
            order: [
              { itemPath: '01-intro/02-b.md', position: 1 },
              { itemPath: '01-intro/01-a.md', position: 2 },
            ],
          },
        ],
      },
      { courseDir, state },
    );

    assert.equal(outcome.errors.length, 1);
    assert.match(outcome.errors[0].error, /01-intro\/02-b\.md/);
    assert.match(outcome.errors[0].error, /could not be put back/);
    // The name it is stranded under carries the basename, so the recovery
    // sweep in `gatherLocal` can still find it on the next run.
    assert.equal(
      fs.existsSync(path.join(courseDir, '01-intro/__cw_order_02-b.md')),
      true,
    );
  });

  it('re-keys and drops base rows without touching either side', async () => {
    silence();
    const state = emptyState();
    state.modules['01-intro'] = {
      canvas_module_id: 10,
      item_order: ['01-intro/01-old.md', '01-intro/02-stale.md'],
      items: {
        '01-intro/01-old.md': { canvas_type: 'page', canvas_id: 1 },
        '01-intro/02-stale.md': { canvas_type: 'page', canvas_id: 2 },
      },
    };
    const calls = mockCanvas([]);

    await run(
      {
        actions: [
          {
            type: 'rekey-base',
            from: '01-intro/01-old.md',
            to: '01-intro/01-new.md',
          },
          {
            type: 'drop-base-row',
            folder: '01-intro',
            itemPath: '01-intro/02-stale.md',
          },
        ],
      },
      { state, courseDir: tempCourse() },
    );

    assert.equal(calls.length, 0);
    assert.equal(
      state.modules['01-intro'].items['01-intro/01-new.md'].canvas_id,
      1,
    );
    assert.equal(
      state.modules['01-intro'].items['01-intro/02-stale.md'],
      undefined,
    );
  });

  it('keeps going after one action fails, and reports it', async () => {
    silence();
    const state = emptyState();
    state.modules['01-intro'] = {
      canvas_module_id: 10,
      item_order: [],
      items: {},
    };
    mockCanvas([
      // No route for the first module, so it 400s; the second is routed.
      { method: 'POST', path: '/modules', body: { id: 20, name: 'Second' } },
    ]);

    const outcome = await run(
      {
        actions: [
          {
            type: 'create-canvas-item',
            folder: '01-intro',
            canvasModuleId: 10,
            itemPath: '01-intro/01-missing.md',
            title: 'Missing',
            canvasType: 'page',
            indent: 0,
            position: 1,
          },
          {
            type: 'create-canvas-module',
            folder: '02-second',
            name: 'Second',
            position: 2,
          },
        ],
      },
      { state, courseDir: tempCourse() },
    );

    assert.equal(outcome.errors.length, 1);
    assert.equal(outcome.errors[0].action.itemPath, '01-intro/01-missing.md');
    assert.equal(outcome.applied.length, 1);
    assert.equal(state.modules['02-second'].canvas_module_id, 20);
  });

  it('saves the state after a failure as well as at the end', async () => {
    silence();
    const state = emptyState();
    const saves = [];
    mockCanvas([]);

    await applyPlan(
      {
        actions: [
          {
            type: 'create-canvas-module',
            folder: '01-intro',
            name: 'Intro',
            position: 1,
          },
        ],
      },
      {
        courseId: COURSE_ID,
        courseDir: tempCourse(),
        state,
        save: () => saves.push(true),
        now: () => '2026-08-20T12:00:00.000Z',
      },
    );

    // One save for the failure, one at the end: work already done is never
    // lost to a later error.
    assert.equal(saves.length, 2);
  });

  it('saves after every applied action, and claims a sync only in the last save', async () => {
    silence();
    const state = emptyState();
    // Deep copies, because the executor mutates one state object in place:
    // each snapshot is the file a kill straight after that save would leave
    // on disk.
    const saves = [];
    mockCanvas([
      { method: 'POST', path: '/modules', body: { id: 10, name: 'First' } },
      { method: 'POST', path: '/modules', body: { id: 20, name: 'Second' } },
    ]);

    const outcome = await applyPlan(
      {
        actions: [
          {
            type: 'create-canvas-module',
            folder: '01-first',
            name: 'First',
            position: 1,
          },
          {
            type: 'create-canvas-module',
            folder: '02-second',
            name: 'Second',
            position: 2,
          },
        ],
      },
      {
        courseId: COURSE_ID,
        courseDir: tempCourse(),
        state,
        save: (next) => saves.push(structuredClone(next)),
        now: () => '2026-08-20T12:00:00.000Z',
      },
    );

    assert.deepEqual(outcome.errors, []);
    // One save per applied action, plus the end-of-run save.
    assert.equal(saves.length, 3);

    // The first snapshot already carries the first module's Canvas id. That is
    // what a run killed outright during the second action leaves behind, and
    // what lets the next run recognise the module instead of creating a second
    // copy of it on both sides.
    assert.equal(saves[0].modules['01-first'].canvas_module_id, 10);
    assert.equal(saves[0].modules['02-second'], undefined);
    assert.equal(saves[1].modules['02-second'].canvas_module_id, 20);

    // Only the run that reached its end claims a sync: a snapshot a partial
    // run leaves behind keeps the previous run's stamp.
    assert.equal(saves[0].last_sync, null);
    assert.equal(saves[1].last_sync, null);
    assert.equal(saves[2].last_sync, '2026-08-20T12:00:00.000Z');
  });
});

// ---------------------------------------------------------------------------
// Renaming an embedded binary
// ---------------------------------------------------------------------------

/**
 * The whole of the defect, end to end: gather, plan and apply over one real
 * tree.
 *
 * Canvas keys an upload on the filename, so renaming `_files/logo.png` to
 * `_files/brand.png` and fixing the `![](…)` sends the same bytes up under a
 * new name and gets a new file back. Before this, nothing noticed: Canvas kept
 * two copies with nothing pointing at the first, `state.files` grew a second
 * row for a path that no longer exists, and no later run could ever reach
 * either — `--prune-canvas` only ever considered items.
 *
 * It has to be the whole loop rather than a planner test plus an executor test,
 * because the two halves of the answer live on opposite sides of the split: the
 * gather is the only thing that reads the whole tree, and the executor is the
 * only thing that can ask Canvas whether the file is still the one the row
 * describes.
 */
describe('renaming a binary a page embeds', () => {
  const PAGE = '01-intro/01-welcome.md';
  const OLD_REF = '01-intro/_files/logo.png';
  const NEW_REF = '01-intro/_files/brand.png';
  const OLD_FILE = 500;
  const NEW_FILE = 501;

  const page = (body) => ({
    page_id: 501,
    url: 'welcome',
    title: 'Welcome',
    body,
    updated_at: '2026-08-20T11:00:00.000Z',
  });
  const moduleItem = {
    id: 91,
    type: 'Page',
    title: 'Welcome',
    page_url: 'welcome',
    content_id: 501,
    position: 1,
    indent: 0,
  };

  /** The reads a gather of this course makes, specific route first. */
  const canvasReads = (body) => [
    { method: 'GET', path: '/modules/10/items', body: [moduleItem] },
    {
      method: 'GET',
      path: '/modules',
      body: [{ id: 10, name: 'Intro', position: 1 }],
    },
    { method: 'GET', path: '/pages/welcome', body: page(body) },
    {
      method: 'GET',
      path: '/pages',
      body: [
        {
          page_id: 501,
          url: 'welcome',
          title: 'Welcome',
          updated_at: page(body).updated_at,
        },
      ],
    },
  ];

  /** The two hops one upload takes, answered with the file id it lands as. */
  const uploadRoutes = (slug, fileId, displayName) => [
    {
      method: 'POST',
      path: `/api/v1/courses/${COURSE_ID}/files`,
      body: {
        upload_url: `https://canvas.example.com/upload/${slug}`,
        upload_params: {},
      },
    },
    {
      method: 'POST',
      path: `/upload/${slug}`,
      body: { id: fileId, display_name: displayName, size: 7 },
    },
  ];

  const imgFor = (fileId) =>
    `<p><img src="/courses/${COURSE_ID}/files/${fileId}/preview" alt="Logo"></p>`;

  it('leaves one live Canvas file and one state row behind', async () => {
    silence();
    const courseDir = tempCourse({
      '01-intro/_category_.json': '{ "label": "Intro", "position": 1 }\n',
      [PAGE]: '---\ntitle: Welcome\n---\n\n![Logo](./_files/logo.png)\n',
      [OLD_REF]: 'PNG-ONE',
    });
    const state = emptyState();

    // --- A first sync, so the state is one a sync really left ----------------
    mockCanvas([{ method: 'GET', path: '/modules', body: [] }]);
    let canvas = await gatherCanvas({ courseId: COURSE_ID, base: state });
    const first = plan({
      base: state,
      local: gatherLocal({ courseDir, gitDirty: CLEAN }),
      canvas,
    });

    mock.restoreAll();
    mockCanvas([
      { method: 'POST', path: '/modules/10/items', body: moduleItem },
      {
        method: 'POST',
        path: '/modules',
        body: { id: 10, name: 'Intro', position: 1 },
      },
      ...uploadRoutes('logo', OLD_FILE, 'logo.png'),
      { method: 'POST', path: '/pages', body: page(imgFor(OLD_FILE)) },
    ]);
    assert.deepEqual(
      (await run(first, { courseDir, state, canvasContent: canvas.content }))
        .errors,
      [],
    );
    assert.deepEqual(Object.keys(state.files), [OLD_REF]);

    // --- The rename: the binary moves and the reference to it moves with it --
    fs.renameSync(path.join(courseDir, OLD_REF), path.join(courseDir, NEW_REF));
    fs.writeFileSync(
      path.join(courseDir, PAGE),
      '---\ntitle: Welcome\n---\n\n![Logo](./_files/brand.png)\n',
      'utf8',
    );

    mock.restoreAll();
    mockCanvas(canvasReads(imgFor(OLD_FILE)));
    canvas = await gatherCanvas({ courseId: COURSE_ID, base: null });
    const second = plan({
      base: state,
      local: gatherLocal({ courseDir, gitDirty: CLEAN }),
      canvas,
      policy: { pruneCanvas: true },
    });
    assert.deepEqual(
      second.actions.map((action) => action.type),
      ['update-canvas-item', 'delete-canvas-file'],
      'the page is pushed and the file it stopped naming is swept',
    );

    mock.restoreAll();
    const calls = mockCanvas([
      ...uploadRoutes('brand', NEW_FILE, 'brand.png'),
      { method: 'PUT', path: '/pages/501', body: page(imgFor(NEW_FILE)) },
      {
        method: 'GET',
        path: `/api/v1/files/${OLD_FILE}`,
        body: { id: OLD_FILE, display_name: 'logo.png' },
      },
      { method: 'DELETE', path: `/api/v1/files/${OLD_FILE}`, body: {} },
    ]);
    assert.deepEqual(
      (await run(second, { courseDir, state, canvasContent: canvas.content }))
        .errors,
      [],
    );

    // One row, naming the file the page now points at.
    assert.deepEqual(Object.keys(state.files), [NEW_REF]);
    assert.equal(state.files[NEW_REF].canvas_file_id, NEW_FILE);
    // One live Canvas file: the old one was deleted, exactly once.
    const deletes = calls.filter((call) => call.method === 'DELETE');
    assert.equal(deletes.length, 1);
    assert.match(deletes[0].url, new RegExp(`/files/${OLD_FILE}$`));

    // --- And a third run, which must do nothing at all -----------------------
    mock.restoreAll();
    const quiet = mockCanvas(canvasReads(imgFor(NEW_FILE)));
    const third = plan({
      base: state,
      local: gatherLocal({ courseDir, gitDirty: CLEAN }),
      canvas: await gatherCanvas({ courseId: COURSE_ID, base: null }),
      policy: { pruneCanvas: true },
    });

    assert.deepEqual(third.actions, [], 'a sync after a sync must do nothing');
    assert.deepEqual(third.orphans.canvas, [], 'the sweep found nothing left');
    assert.deepEqual(
      quiet.filter((call) => call.method !== 'GET'),
      [],
      'the third run wrote to Canvas',
    );
  });
});
