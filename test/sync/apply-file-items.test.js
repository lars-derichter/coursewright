const { describe, it, mock, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { mockCanvas, silence } = require('../helpers/canvas-mock');

process.env.CANVAS_API_URL = 'https://canvas.example.com';
process.env.CANVAS_API_TOKEN = 'test-token-123';

const { applyPlan } = require('../../lib/sync/apply');
const { gatherLocal } = require('../../lib/sync/gather');
const {
  canvasFingerprint,
  hashLocalFile,
} = require('../../lib/sync/fingerprint');

/**
 * What a `file` item does to the Canvas file behind it.
 *
 * Canvas keys an upload on the filename, so renaming a binary lands it as a new
 * Canvas file and leaves the previous one in the course Files area with nothing
 * pointing at it. Deleting that one is the only cleanup this tool does without
 * a flag, which is why the tests below spend more effort on the cases that must
 * *not* delete than on the one that must.
 *
 * The mock's route table is the assertion: a route is spliced out once it
 * matches, so a call the code should not make finds no route and fails the
 * action instead of passing quietly. Every test here also counts the DELETEs
 * that reached `/api/v1/files/`, because "one" and "none" are the whole
 * behaviour.
 */

const COURSE_ID = 4242;
const MODULE_ID = 10;
const MODULE_ITEM_ID = 91;
const OLD_FILE_ID = 770;
const NEW_FILE_ID = 771;
const WRAPPER = '01-intro/03-syllabus.md';

/** Every path clean, which is what lets `gatherLocal` answer at all. */
const CLEAN = { available: true, paths: new Set(), reason: null };

afterEach(() => mock.restoreAll());

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A module holding one file item: a markdown wrapper and the binary it names. */
function tempCourse(binaryName = 'handbook.pdf') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apply-file-test-'));
  fs.mkdirSync(path.join(dir, '01-intro/_files'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '01-intro/_category_.json'),
    '{ "label": "Intro", "position": 1 }\n',
    'utf8',
  );
  fs.writeFileSync(
    path.join(dir, '01-intro/03-syllabus.md'),
    `---\ntitle: Syllabus\ncanvas_type: file\nfile_ref: _files/${binaryName}\n---\n`,
    'utf8',
  );
  fs.writeFileSync(
    path.join(dir, `01-intro/_files/${binaryName}`),
    'PDF-BYTES',
    'utf8',
  );
  return dir;
}

/** The state a previous sync left: the item points at the old Canvas file. */
function stateWithFileItem() {
  return {
    schema_version: 4,
    canvas_base_url: 'https://canvas.example.com',
    course_id: COURSE_ID,
    last_sync: '2026-08-19T10:00:00.000Z',
    modules: {
      '01-intro': {
        canvas_module_id: MODULE_ID,
        name: 'Intro',
        position: 1,
        item_order: ['01-intro/03-syllabus.md'],
        items: {
          '01-intro/03-syllabus.md': {
            canvas_type: 'file',
            canvas_id: OLD_FILE_ID,
            module_item_id: MODULE_ITEM_ID,
            title: 'Syllabus',
            local_hash: 'stale',
            canvas_hash: 'stale',
            synced_at: '2026-08-19T10:00:00.000Z',
          },
        },
      },
    },
    icons: {},
    files: {},
  };
}

function updateAction() {
  return {
    type: 'update-canvas-item',
    folder: '01-intro',
    canvasModuleId: MODULE_ID,
    itemPath: '01-intro/03-syllabus.md',
    title: 'Syllabus',
    canvasType: 'file',
    canvasId: OLD_FILE_ID,
    pageUrl: null,
    moduleItemId: MODULE_ITEM_ID,
    indent: 0,
  };
}

/** The two hops an upload takes: the grant, then the form post it points at. */
function uploadRoutes(fileId, displayName) {
  return [
    {
      method: 'POST',
      path: `/api/v1/courses/${COURSE_ID}/files`,
      body: {
        upload_url: 'https://canvas.example.com/upload/binary',
        upload_params: {},
      },
    },
    {
      method: 'POST',
      path: '/upload/binary',
      body: { id: fileId, display_name: displayName, size: 9 },
    },
  ];
}

/** What a new Canvas file costs the module item, which cannot be repointed. */
function recreateItemRoutes() {
  return [
    {
      method: 'DELETE',
      path: `/modules/${MODULE_ID}/items/${MODULE_ITEM_ID}`,
      body: {},
    },
    {
      method: 'POST',
      path: `/modules/${MODULE_ID}/items`,
      body: { id: 92, title: 'Syllabus', indent: 0 },
    },
  ];
}

function run(actions, options) {
  return applyPlan(
    { actions },
    {
      courseId: COURSE_ID,
      save: () => {},
      now: () => '2026-08-22T12:00:00.000Z',
      ...options,
    },
  );
}

/** Every DELETE aimed at a Canvas file, which is the number under test. */
function fileDeletes(calls) {
  return calls.filter(
    (call) =>
      call.method === 'DELETE' && /\/api\/v1\/files\/\d+/.test(call.url),
  );
}

/** Every read of a Canvas file's metadata. */
function fileReads(calls) {
  return calls.filter(
    (call) => call.method === 'GET' && /\/api\/v1\/files\/\d+/.test(call.url),
  );
}

// ---------------------------------------------------------------------------

describe('the local fingerprint a push records for a wrapper', () => {
  it('is the one gather computes, and it covers the binary', async () => {
    silence();
    // Two claims in one test because either alone is satisfied by the defect.
    // The sides *agreeing* is what stops the item being pushed again on every
    // run for ever (`lib/sync/fingerprint.js:1-25`); the hash covering the
    // binary is what makes an edited PDF reach Canvas at all. Before the fix
    // both sides agreed on a hash of the wrapper's text, so agreement held and
    // the edit was invisible.
    const courseDir = tempCourse();
    const state = stateWithFileItem();
    mockCanvas([
      ...uploadRoutes(OLD_FILE_ID, 'handbook.pdf'),
      {
        method: 'PUT',
        path: `/modules/${MODULE_ID}/items/${MODULE_ITEM_ID}`,
        body: { id: MODULE_ITEM_ID, title: 'Syllabus', indent: 0 },
      },
    ]);

    const outcome = await run([updateAction()], { courseDir, state });
    assert.deepEqual(outcome.errors, []);

    const recorded = state.modules['01-intro'].items[WRAPPER].local_hash;
    const { modules } = gatherLocal({ courseDir, gitDirty: CLEAN });
    const gathered = modules
      .flatMap((mod) => mod.items)
      .find((item) => item.itemPath === WRAPPER);

    assert.equal(
      recorded,
      gathered.localHash,
      'apply and gather must fingerprint the same wrapper identically',
    );
    assert.notEqual(
      recorded,
      hashLocalFile(path.join(courseDir, WRAPPER)),
      'the wrapper’s text alone is not a fingerprint of the file it stands for',
    );
  });
});

describe('a renamed binary leaves no orphan behind', () => {
  it('deletes the previous Canvas file, exactly once', async () => {
    silence();
    const courseDir = tempCourse();
    const state = stateWithFileItem();
    const calls = mockCanvas([
      ...uploadRoutes(NEW_FILE_ID, 'handbook.pdf'),
      ...recreateItemRoutes(),
      {
        method: 'GET',
        path: `/api/v1/files/${OLD_FILE_ID}`,
        body: { id: OLD_FILE_ID, display_name: 'syllabus.pdf' },
      },
      { method: 'DELETE', path: `/api/v1/files/${OLD_FILE_ID}`, body: {} },
    ]);

    const outcome = await run([updateAction()], { courseDir, state });

    assert.deepEqual(outcome.errors, []);
    const deletes = fileDeletes(calls);
    assert.equal(deletes.length, 1, 'the orphan must be deleted once');
    assert.match(deletes[0].url, new RegExp(`/api/v1/files/${OLD_FILE_ID}$`));

    // The row names the file that now exists, not the one just deleted.
    assert.equal(
      state.modules['01-intro'].items['01-intro/03-syllabus.md'].canvas_id,
      NEW_FILE_ID,
    );
  });

  it('carries on when the delete fails, rather than failing the run', async () => {
    silence();
    const courseDir = tempCourse();
    const state = stateWithFileItem();
    const calls = mockCanvas([
      ...uploadRoutes(NEW_FILE_ID, 'handbook.pdf'),
      ...recreateItemRoutes(),
      {
        method: 'GET',
        path: `/api/v1/files/${OLD_FILE_ID}`,
        body: { id: OLD_FILE_ID, display_name: 'syllabus.pdf' },
      },
      {
        method: 'DELETE',
        path: `/api/v1/files/${OLD_FILE_ID}`,
        body: { message: 'gone already' },
        status: 404,
      },
    ]);

    const outcome = await run([updateAction()], { courseDir, state });

    // A file somebody already deleted by hand, or one the token may not touch,
    // is not a reason to fail a push whose every other write landed.
    assert.deepEqual(outcome.errors, []);
    assert.equal(outcome.applied.length, 1);
    assert.equal(fileDeletes(calls).length, 1);
  });
});

describe('a title change that the content did not cause', () => {
  it('retitles the module item without touching the binary', async () => {
    silence();
    // The fence that matters most. `contentUnchanged` says the planner proved
    // the local content did not move, so the upload is provably redundant — and
    // an upload here is not merely wasteful: Canvas keys one on the filename, a
    // renamed binary comes back with a new id, and the cleanup then deletes the
    // file every student's existing link points at.
    //
    // The route table is the assertion. It offers the module-item PUT and
    // nothing else, so an upload, a re-create or a delete finds no route and
    // fails the action instead of passing quietly.
    const courseDir = tempCourse();
    const state = stateWithFileItem();
    const calls = mockCanvas([
      {
        method: 'PUT',
        path: `/modules/${MODULE_ID}/items/${MODULE_ITEM_ID}`,
        body: { id: MODULE_ITEM_ID, title: 'Course Syllabus', indent: 0 },
      },
    ]);

    const outcome = await run(
      [
        {
          ...updateAction(),
          title: 'Course Syllabus',
          contentUnchanged: true,
        },
      ],
      {
        courseDir,
        state,
        // What the gather already read for this item, which is where the file
        // object comes from once nothing re-uploads it.
        canvasContent: new Map([
          [
            String(MODULE_ITEM_ID),
            {
              item: { id: MODULE_ITEM_ID, title: 'Syllabus', indent: 0 },
              content: {
                id: OLD_FILE_ID,
                display_name: 'handbook.pdf',
                size: 9,
                modified_at: '2026-08-19T09:00:00.000Z',
                updated_at: '2026-08-19T09:00:00.000Z',
              },
            },
          ],
        ]),
      },
    );

    assert.deepEqual(outcome.errors, []);
    assert.deepEqual(
      calls.filter((call) => call.method === 'POST'),
      [],
      'nothing may be uploaded to change a title',
    );
    assert.deepEqual(fileDeletes(calls), []);
    assert.deepEqual(fileReads(calls), []);

    const put = calls.find((call) => call.method === 'PUT');
    assert.equal(put.body.module_item.title, 'Course Syllabus');

    const row = state.modules['01-intro'].items[WRAPPER];
    assert.equal(
      row.canvas_id,
      OLD_FILE_ID,
      'the Canvas file id must not churn over a rename',
    );
    assert.equal(row.title, 'Course Syllabus');
  });

  it('records a fingerprint the next gather will agree with', async () => {
    silence();
    // The half a skipped upload is easiest to get wrong. `recordCanvasWrite`
    // rebuilds `canvas_hash` from the module item *and* the object behind it,
    // and a `file`'s half of that is `display_name`, `size` and `modified_at`.
    // Record it with no content object and all three read as null, which no
    // gather ever produces — the item would read as changed on Canvas on the
    // very next run and pull the remote copy over the author's file.
    const courseDir = tempCourse();
    const state = stateWithFileItem();
    const content = {
      id: OLD_FILE_ID,
      display_name: 'handbook.pdf',
      size: 9,
      modified_at: '2026-08-19T09:00:00.000Z',
      updated_at: '2026-08-19T09:00:00.000Z',
    };
    const item = { id: MODULE_ITEM_ID, title: 'Course Syllabus', indent: 0 };
    mockCanvas([
      {
        method: 'PUT',
        path: `/modules/${MODULE_ID}/items/${MODULE_ITEM_ID}`,
        body: item,
      },
    ]);

    const outcome = await run(
      [{ ...updateAction(), title: 'Course Syllabus', contentUnchanged: true }],
      {
        courseDir,
        state,
        canvasContent: new Map([
          [
            String(MODULE_ITEM_ID),
            { item: { ...item, title: 'Syllabus' }, content },
          ],
        ]),
      },
    );

    assert.deepEqual(outcome.errors, []);
    assert.equal(
      state.modules['01-intro'].items[WRAPPER].canvas_hash,
      canvasFingerprint({ item, content }, 'file'),
      'the row must describe the item Canvas now holds, file object included',
    );
  });

  it('uploads after all when nothing can say what Canvas holds', async () => {
    silence();
    // `gatherCanvas` records a null content object when `GET /files/:id` fails,
    // and that leaves `canvasHash` null too — which reads as "Canvas unchanged"
    // and lets the item reach the skipped-upload path. Skipping it there would
    // record a `canvas_hash` built from three nulls, and the next run would read
    // the item as changed on Canvas and pull the remote copy over the file.
    // Falling back to the upload is what this always did.
    const courseDir = tempCourse();
    const state = stateWithFileItem();
    const calls = mockCanvas([
      ...uploadRoutes(OLD_FILE_ID, 'handbook.pdf'),
      {
        method: 'PUT',
        path: `/modules/${MODULE_ID}/items/${MODULE_ITEM_ID}`,
        body: { id: MODULE_ITEM_ID, title: 'Course Syllabus', indent: 0 },
      },
    ]);

    const outcome = await run(
      [{ ...updateAction(), title: 'Course Syllabus', contentUnchanged: true }],
      {
        courseDir,
        state,
        canvasContent: new Map([
          [
            String(MODULE_ITEM_ID),
            { item: { id: MODULE_ITEM_ID, title: 'Syllabus' }, content: null },
          ],
        ]),
      },
    );

    assert.deepEqual(outcome.errors, []);
    assert.equal(
      calls.filter((call) => call.url.includes('/upload/binary')).length,
      1,
      'an unprovable skip has to fall back to the upload',
    );
  });
});

/**
 * `writeTitleIfAbsent` puts a `title:` into a markdown item that declares none,
 * so that what the item is called on Canvas stops depending on what its file is
 * called. Until now it ran on the create handler alone — and `adoptPair` does
 * not create anything, it claims an object that is already there and emits an
 * `update-canvas-item`. So an item this tool adopted kept taking its name from
 * its filename indefinitely, and `renumber`, which renames files by the dozen,
 * then silently renamed it on Canvas.
 *
 * A `file` wrapper is the shape that makes the ordering constraint bite. Its
 * `local_hash` covers the binary *and* the wrapper's text (`fileItemHash` in
 * `lib/sync/gather.js`), so the line this adds moves that hash: write it after
 * the row is recorded and the wrapper reads as changed locally on the very next
 * run, for ever.
 */
describe('an item this tool adopted rather than created', () => {
  /** The wrapper as an author leaves it: no `title:`, so the filename is it. */
  function untitledWrapper(courseDir) {
    fs.writeFileSync(
      path.join(courseDir, WRAPPER),
      '---\ncanvas_type: file\nfile_ref: _files/handbook.pdf\n---\n',
      'utf8',
    );
  }

  /** The module linked, and no row for the item — which is what adoption is. */
  function stateAwaitingAdoption() {
    const state = stateWithFileItem();
    state.modules['01-intro'].items = {};
    state.modules['01-intro'].item_order = [];
    return state;
  }

  /** What the next `gatherLocal` will say the wrapper hashes to. */
  function gatheredHash(courseDir) {
    return gatherLocal({ courseDir, gitDirty: CLEAN })
      .modules.flatMap((module) => module.items)
      .find((item) => item.itemPath === WRAPPER).localHash;
  }

  it('writes the title in, and fingerprints the file including it', async () => {
    silence();
    // Two claims, because either alone is satisfied by a defect. The title has
    // to reach the file at all — that is the hole — and the row has to describe
    // the file *with* it, which is the ordering the docblock spells out and the
    // half that `cfa6919` made easy to get wrong.
    const courseDir = tempCourse();
    untitledWrapper(courseDir);
    const state = stateAwaitingAdoption();
    const before = gatheredHash(courseDir);

    mockCanvas([
      ...uploadRoutes(OLD_FILE_ID, 'handbook.pdf'),
      {
        method: 'PUT',
        path: `/modules/${MODULE_ID}/items/${MODULE_ITEM_ID}`,
        body: { id: MODULE_ITEM_ID, title: 'Syllabus', indent: 0 },
      },
    ]);

    const outcome = await run([{ ...updateAction(), adopted: true }], {
      courseDir,
      state,
    });
    assert.deepEqual(outcome.errors, []);

    assert.match(
      fs.readFileSync(path.join(courseDir, WRAPPER), 'utf8'),
      /^title: Syllabus$/m,
      'an adopted item still takes its name from its filename',
    );

    const recorded = state.modules['01-intro'].items[WRAPPER].local_hash;
    assert.notEqual(
      recorded,
      before,
      'the line moved the wrapper’s hash, so the row cannot predate it',
    );
    assert.equal(
      recorded,
      gatheredHash(courseDir),
      'the row must describe the file the next gather will read',
    );
  });

  it('does not write into the author’s file on an ordinary update', async () => {
    silence();
    // The fence that matters most. Every push of an edited item comes through
    // the same handler, and writing a `title:` into each one would be sync
    // editing the author's tree unasked — a different and worse thing than the
    // one being fixed. The only difference between this and the case above is
    // the flag.
    const courseDir = tempCourse();
    untitledWrapper(courseDir);
    const original = fs.readFileSync(path.join(courseDir, WRAPPER), 'utf8');
    const state = stateWithFileItem();

    mockCanvas([
      ...uploadRoutes(OLD_FILE_ID, 'handbook.pdf'),
      {
        method: 'PUT',
        path: `/modules/${MODULE_ID}/items/${MODULE_ITEM_ID}`,
        body: { id: MODULE_ITEM_ID, title: 'Syllabus', indent: 0 },
      },
    ]);

    const outcome = await run([updateAction()], { courseDir, state });
    assert.deepEqual(outcome.errors, []);
    assert.equal(
      fs.readFileSync(path.join(courseDir, WRAPPER), 'utf8'),
      original,
      'an ordinary push may not touch the file it is pushing',
    );
    assert.equal(
      state.modules['01-intro'].items[WRAPPER].local_hash,
      gatheredHash(courseDir),
      'and the row still has to agree with the file either way',
    );
  });

  it('leaves a title the author wrote exactly as it is', async () => {
    silence();
    // The wrapper the shared fixture builds already declares one. Adoption is
    // not licence to rename the author's item: what it is called is theirs.
    const courseDir = tempCourse();
    const original = fs.readFileSync(path.join(courseDir, WRAPPER), 'utf8');
    const state = stateAwaitingAdoption();

    mockCanvas([
      ...uploadRoutes(OLD_FILE_ID, 'handbook.pdf'),
      {
        method: 'PUT',
        path: `/modules/${MODULE_ID}/items/${MODULE_ITEM_ID}`,
        body: { id: MODULE_ITEM_ID, title: 'Syllabus', indent: 0 },
      },
    ]);

    const outcome = await run(
      [{ ...updateAction(), title: 'Something Else', adopted: true }],
      { courseDir, state },
    );
    assert.deepEqual(outcome.errors, []);
    assert.equal(
      fs.readFileSync(path.join(courseDir, WRAPPER), 'utf8'),
      original,
    );
  });
});

describe('an upload that renamed nothing deletes nothing', () => {
  it('costs no lookup at all when the upload landed on the same file', async () => {
    silence();
    const courseDir = tempCourse();
    const state = stateWithFileItem();
    const calls = mockCanvas([
      ...uploadRoutes(OLD_FILE_ID, 'handbook.pdf'),
      {
        method: 'PUT',
        path: `/modules/${MODULE_ID}/items/${MODULE_ITEM_ID}`,
        body: { id: MODULE_ITEM_ID, title: 'Syllabus', indent: 0 },
      },
    ]);

    const outcome = await run([updateAction()], { courseDir, state });

    assert.deepEqual(outcome.errors, []);
    assert.deepEqual(fileDeletes(calls), []);
    assert.deepEqual(
      fileReads(calls),
      [],
      'the same id proves there is no orphan, so nothing needs fetching',
    );
  });

  it('is not fooled by a Canvas id that changed under an unchanged name', async () => {
    silence();
    // The case `1ee4bb1` declined to bet against, and the reason the id
    // comparison is only half the test: Canvas answers `on_duplicate=overwrite`
    // by replacing the file of that name, and nothing here has ever verified
    // which id comes back. If it is a new one, the old file was consumed by the
    // overwrite and deleting it would be deleting the author's live binary.
    const courseDir = tempCourse();
    const state = stateWithFileItem();
    const calls = mockCanvas([
      ...uploadRoutes(NEW_FILE_ID, 'handbook.pdf'),
      ...recreateItemRoutes(),
      {
        method: 'GET',
        path: `/api/v1/files/${OLD_FILE_ID}`,
        body: { id: OLD_FILE_ID, display_name: 'handbook.pdf' },
      },
    ]);

    const outcome = await run([updateAction()], { courseDir, state });

    assert.deepEqual(outcome.errors, []);
    assert.equal(fileReads(calls).length, 1, 'the name has to be checked');
    assert.deepEqual(
      fileDeletes(calls),
      [],
      'the same name means the upload replaced it, so there is no orphan',
    );
  });

  it('leaves a renamed-away file alone while something else still names it', async () => {
    silence();
    // The same binary is linked from a page, so `state.files` holds a row for
    // it and the page's HTML in Canvas points at that id. Deleting the file
    // would break an image or a download in a page this run never touched.
    const courseDir = tempCourse();
    const state = stateWithFileItem();
    state.files['01-intro/_files/syllabus.pdf'] = {
      canvas_file_id: OLD_FILE_ID,
      canvas_url: `/courses/${COURSE_ID}/files/${OLD_FILE_ID}/preview`,
      sha256: 'whatever',
    };
    const calls = mockCanvas([
      ...uploadRoutes(NEW_FILE_ID, 'handbook.pdf'),
      ...recreateItemRoutes(),
      {
        method: 'GET',
        path: `/api/v1/files/${OLD_FILE_ID}`,
        body: { id: OLD_FILE_ID, display_name: 'syllabus.pdf' },
      },
    ]);

    const outcome = await run([updateAction()], { courseDir, state });

    assert.deepEqual(outcome.errors, []);
    assert.deepEqual(
      fileDeletes(calls),
      [],
      'a file another row still points at is not this run’s to delete',
    );
  });

  it('deletes nothing on the first upload of a file item', async () => {
    silence();
    // A create has no previous file to orphan. Stated as its own test because
    // the cheapest way to reintroduce the defect in reverse is a cleanup that
    // reads a missing id as "delete everything you can find".
    const courseDir = tempCourse();
    const state = stateWithFileItem();
    delete state.modules['01-intro'].items['01-intro/03-syllabus.md'];
    const calls = mockCanvas([
      ...uploadRoutes(NEW_FILE_ID, 'handbook.pdf'),
      {
        method: 'POST',
        path: `/modules/${MODULE_ID}/items`,
        body: { id: 92, title: 'Syllabus', indent: 0 },
      },
    ]);

    const outcome = await run(
      [{ ...updateAction(), type: 'create-canvas-item', canvasId: null }],
      { courseDir, state },
    );

    assert.deepEqual(outcome.errors, []);
    assert.deepEqual(fileDeletes(calls), []);
    assert.deepEqual(fileReads(calls), []);
  });
});

// ---------------------------------------------------------------------------
// Pruning a wrapper whose Canvas file something else still shows
// ---------------------------------------------------------------------------

/**
 * `--prune-canvas` over a deleted wrapper plans a `delete-canvas-item`, and for
 * a `file` item that delete used to go straight to the Canvas file, with none
 * of the checking every other file delete does. But the id is not always the
 * item's alone: Canvas deduplicates uploads, so a wrapper and a page's embedded
 * image can share one file id — and the embed's `state.files` row holds the
 * binary's sha256, which tells every later run "already uploaded". Deleting the
 * file broke the page's embed for good: nothing ever re-uploads bytes the state
 * still vouches for.
 *
 * So the prune now takes the `fileStillReferenced` sweep too, minus the row
 * being pruned, and removes only the module item when anything else still
 * names the id.
 */
describe('pruning a file item whose Canvas file something else still names', () => {
  function deleteAction() {
    return {
      type: 'delete-canvas-item',
      folder: '01-intro',
      canvasModuleId: MODULE_ID,
      itemPath: WRAPPER,
      moduleItemId: MODULE_ITEM_ID,
      canvasType: 'file',
      canvasId: OLD_FILE_ID,
    };
  }

  /** The tree a prune sees: the wrapper is gone, which is what planned this. */
  function courseWithoutWrapper() {
    const dir = tempCourse();
    fs.rmSync(path.join(dir, WRAPPER));
    return dir;
  }

  it('keeps the file a page still embeds, and unlinks only the item', async () => {
    silence();
    const state = stateWithFileItem();
    state.files['01-intro/_files/handbook.pdf'] = {
      canvas_file_id: OLD_FILE_ID,
      canvas_url: `/courses/${COURSE_ID}/files/${OLD_FILE_ID}/preview`,
      sha256: 'matches-the-binary-on-disk',
    };
    const lines = [];
    const calls = mockCanvas([
      {
        method: 'DELETE',
        path: `/modules/${MODULE_ID}/items/${MODULE_ITEM_ID}`,
        body: {},
      },
    ]);

    const outcome = await run([deleteAction()], {
      courseDir: courseWithoutWrapper(),
      state,
      log: {
        info: () => {},
        warn: () => {},
        error: () => {},
        verbose: (line) => lines.push(line),
      },
    });

    assert.deepEqual(outcome.errors, []);
    assert.deepEqual(
      fileDeletes(calls),
      [],
      'the binary is the page’s as much as the wrapper’s',
    );
    assert.equal(calls.length, 1, 'the module item is all that may go');
    // The wrapper's own row goes — it is the thing being pruned — while the
    // embed's row stays, sha256 and all, so the page keeps working.
    assert.equal(state.modules['01-intro'].items[WRAPPER], undefined);
    assert.notEqual(state.files['01-intro/_files/handbook.pdf'], undefined);
    // And the run says who kept the file, by path — otherwise the kept binary
    // reads as a delete that silently did not happen.
    assert.equal(
      lines.some(
        (line) =>
          line.includes('01-intro/_files/handbook.pdf') &&
          line.includes(String(OLD_FILE_ID)),
      ),
      true,
      'the verbose log must name the row that kept the file',
    );
  });

  it('keeps a file a second wrapper still names', async () => {
    silence();
    // The item-row mirror of the embed case: two wrappers whose binaries were
    // byte-identical under one name got one file id from Canvas's dedup.
    // Pruning one must not take the file out from under the other.
    const state = stateWithFileItem();
    state.modules['01-intro'].items['01-intro/04-copy.md'] = {
      canvas_type: 'file',
      canvas_id: OLD_FILE_ID,
      module_item_id: 92,
    };
    const calls = mockCanvas([
      {
        method: 'DELETE',
        path: `/modules/${MODULE_ID}/items/${MODULE_ITEM_ID}`,
        body: {},
      },
    ]);

    const outcome = await run([deleteAction()], {
      courseDir: courseWithoutWrapper(),
      state,
    });

    assert.deepEqual(outcome.errors, []);
    assert.deepEqual(fileDeletes(calls), []);
    assert.equal(state.modules['01-intro'].items[WRAPPER], undefined);
    assert.notEqual(
      state.modules['01-intro'].items['01-intro/04-copy.md'],
      undefined,
      'the surviving wrapper keeps its row, and with it the file',
    );
  });

  it('still deletes the file no other row names', async () => {
    silence();
    // The unchanged case, pinned: the item's own row naming the id is not
    // "something else", or every prune would answer "yes, itself" and the
    // Files area would never be cleaned up again.
    const state = stateWithFileItem();
    const calls = mockCanvas([
      { method: 'DELETE', path: `/api/v1/files/${OLD_FILE_ID}`, body: {} },
    ]);

    const outcome = await run([deleteAction()], {
      courseDir: courseWithoutWrapper(),
      state,
    });

    assert.deepEqual(outcome.errors, []);
    assert.equal(fileDeletes(calls).length, 1, 'the orphan is still swept');
    assert.equal(state.modules['01-intro'].items[WRAPPER], undefined);
  });
});

// ---------------------------------------------------------------------------
// The git guard on the binary a pulled `file` item brings down
// ---------------------------------------------------------------------------

/**
 * What stops a pulled `file` item landing on bytes git holds no copy of.
 *
 * `writeLocalFileItem` writes twice: the wrapper markdown at `action.itemPath`,
 * and the binary beside it under `_files/`. `guardDirty` in `lib/sync/plan.js`
 * protects the first and has never known about the second — the binary's name
 * is Canvas's `display_name` put through `toFileSlug`, so the destination does
 * not exist as a fact until Canvas has answered, and the planner never touches
 * the network. An author's own `handout.pdf` and a Canvas file of that name are
 * therefore one path, and the Canvas one won by simply being written over it.
 *
 * This is `downloadReferencedFiles`'s case (see `apply-embedded-files.test.js`)
 * with a different destination, and it takes the same remedy: the run's single
 * git answer threaded down to the executor, asked by the same predicate,
 * refused as a `skipped` entry with a remedy rather than as a failed run.
 *
 * **A refusal takes the whole item**, which is the one thing that differs from
 * the embedded case. The row here is the item's identity, not an embedded
 * file's bookkeeping, and a row naming a path with no file at it reads to the
 * next `gatherLocal` as an item deleted locally — which under `--prune-canvas`
 * deletes the Canvas object. So nothing is written at all and the base row is
 * left exactly as it was, which is what makes the next run ask again.
 *
 * The fences are the last three: a clean tree still writes the file, a
 * destination that is not there is never guarded, and a committed binary is
 * still overwritten. A guard that quietly turned `file` items off would pass
 * every test above it.
 */

const AUTHOR_BYTES = 'MY-ONLY-COPY';
const CANVAS_BYTES = 'CANVAS-PDF-BYTES';
const BINARY_REF = '01-intro/_files/handbook.pdf';

const NO_GIT = {
  available: false,
  paths: new Set(),
  reason: 'the tree is not inside a git repository',
};
/** What `gitDirtyPaths` returns for a dirty binary: the path and its ancestors. */
const DIRTY_BINARY = {
  available: true,
  paths: new Set(['01-intro', '01-intro/_files', BINARY_REF]),
  reason: null,
};

/** A tree holding the wrapper and nothing under `_files/` at all. */
function courseWithoutBinary() {
  const dir = tempCourse();
  fs.rmSync(path.join(dir, BINARY_REF), { force: true });
  return dir;
}

/** The action a pull plans for this item, and what `gatherCanvas` hands over. */
function pullAction(type = 'update-local-item') {
  return {
    type,
    folder: '01-intro',
    itemPath: WRAPPER,
    canvasModuleId: MODULE_ID,
    moduleItemId: MODULE_ITEM_ID,
    canvasType: 'file',
    canvasId: OLD_FILE_ID,
    title: 'Syllabus',
    indent: 0,
    position: 1,
    canvasHash: 'canvas-file-hash',
  };
}

function pullContent() {
  return new Map([
    [
      String(MODULE_ITEM_ID),
      {
        item: {
          id: MODULE_ITEM_ID,
          type: 'File',
          title: 'Syllabus',
          indent: 0,
          content_id: OLD_FILE_ID,
        },
        content: {
          id: OLD_FILE_ID,
          display_name: 'handbook.pdf',
          size: 16,
          updated_at: '2026-08-21T10:00:00.000Z',
        },
      },
    ],
  ]);
}

/** The metadata read and the byte fetch one download costs. */
function pullRoutes() {
  return [
    {
      method: 'GET',
      path: `/api/v1/files/${OLD_FILE_ID}`,
      body: {
        id: OLD_FILE_ID,
        display_name: 'handbook.pdf',
        url: `https://files.example.com/blob/${OLD_FILE_ID}`,
      },
    },
    { method: 'GET', path: `/blob/${OLD_FILE_ID}`, body: CANVAS_BYTES },
  ];
}

/** Whether the run went past the metadata read to fetch the bytes. */
function fetchedBytes(calls) {
  return calls.some((call) => call.url.includes(`/blob/${OLD_FILE_ID}`));
}

function bytesAt(courseDir) {
  return fs.readFileSync(path.join(courseDir, BINARY_REF), 'utf8');
}

describe('a pulled file item onto an uncommitted binary', () => {
  it('leaves the binary alone, and reports the item it did not write', async () => {
    silence();
    const courseDir = tempCourse();
    fs.writeFileSync(path.join(courseDir, BINARY_REF), AUTHOR_BYTES, 'utf8');
    const state = stateWithFileItem();
    const calls = mockCanvas(pullRoutes());

    const outcome = await run([pullAction()], {
      courseDir,
      state,
      canvasContent: pullContent(),
      gitDirty: DIRTY_BINARY,
    });

    assert.deepEqual(outcome.errors, []);
    assert.equal(
      bytesAt(courseDir),
      AUTHOR_BYTES,
      'the only copy of the author’s bytes must survive',
    );
    assert.equal(fetchedBytes(calls), false, 'no bytes may be pulled down');

    // Shaped like `guardDirty`: the run does not fail, it says what it would
    // not do and how to let it.
    assert.equal(outcome.skipped.length, 1);
    assert.equal(outcome.skipped[0].reason, 'git-dirty');
    assert.equal(outcome.skipped[0].itemPath, WRAPPER);
    assert.equal(outcome.skipped[0].action, 'update-local-item');
    assert.match(outcome.skipped[0].remedy, new RegExp(BINARY_REF));
    assert.match(outcome.skipped[0].remedy, /Commit or stash/);
  });

  it('writes no wrapper and no row, so the next run asks the same question', async () => {
    silence();
    // Either half on its own is worse than nothing. The wrapper alone would put
    // `local_hash` over the author's binary — `fileItemHash` spans both halves
    // — against a `canvas_hash` describing Canvas's, and both sides would read
    // as unchanged for ever after. The row alone names a path with no file at
    // it, which the next `gatherLocal` reads as an item deleted locally.
    const courseDir = tempCourse();
    fs.writeFileSync(path.join(courseDir, BINARY_REF), AUTHOR_BYTES, 'utf8');
    const state = stateWithFileItem();
    const wrapperBefore = fs.readFileSync(
      path.join(courseDir, WRAPPER),
      'utf8',
    );
    const rowBefore = {
      ...state.modules['01-intro'].items[WRAPPER],
    };
    mockCanvas(pullRoutes());

    const outcome = await run([pullAction()], {
      courseDir,
      state,
      canvasContent: pullContent(),
      gitDirty: DIRTY_BINARY,
    });

    assert.equal(
      fs.readFileSync(path.join(courseDir, WRAPPER), 'utf8'),
      wrapperBefore,
      'the wrapper must not be rewritten either',
    );
    assert.deepEqual(
      state.modules['01-intro'].items[WRAPPER],
      rowBefore,
      'the base row is what makes the next run plan this write again',
    );
    // And the refusal is not an application: a report that lists this item as
    // applied while `skipped` says it never happened contradicts itself, and
    // tells the author their bytes are in git when nothing was written.
    assert.deepEqual(outcome.applied, []);
  });

  it('creates no row for a brand-new item it refused', async () => {
    silence();
    // The `create-local-item` half, where there is no base row to fall back on.
    // A row written here would be the whole identity of an item with no file
    // behind it — and the next run reads that as deleted locally, which under
    // `--prune-canvas` deletes the Canvas file.
    const courseDir = tempCourse();
    fs.writeFileSync(path.join(courseDir, BINARY_REF), AUTHOR_BYTES, 'utf8');
    fs.rmSync(path.join(courseDir, WRAPPER));
    const state = stateWithFileItem();
    delete state.modules['01-intro'].items[WRAPPER];
    mockCanvas(pullRoutes());

    const outcome = await run([pullAction('create-local-item')], {
      courseDir,
      state,
      canvasContent: pullContent(),
      gitDirty: DIRTY_BINARY,
    });

    assert.deepEqual(outcome.errors, []);
    assert.equal(outcome.skipped.length, 1);
    assert.equal(fs.existsSync(path.join(courseDir, WRAPPER)), false);
    assert.deepEqual(Object.keys(state.modules['01-intro'].items), []);
    assert.equal(bytesAt(courseDir), AUTHOR_BYTES);
  });

  it('protects what is on disk when no git answer was handed in at all', async () => {
    silence();
    // The default is the refusal, not the write. A caller that forgets to pass
    // the git answer must not be the one place the guard is quietly off.
    const courseDir = tempCourse();
    fs.writeFileSync(path.join(courseDir, BINARY_REF), AUTHOR_BYTES, 'utf8');
    const state = stateWithFileItem();
    const calls = mockCanvas(pullRoutes());

    const outcome = await run([pullAction()], {
      courseDir,
      state,
      canvasContent: pullContent(),
    });

    assert.equal(fetchedBytes(calls), false);
    assert.equal(outcome.skipped.length, 1);
    assert.equal(bytesAt(courseDir), AUTHOR_BYTES);
  });

  it('downloads into a clean tree, so the guard has not turned file items off', async () => {
    silence();
    // This is also the `--force` pin. `cli/pull.js` states the flag by handing
    // the executor `{ available: true, paths: new Set() }` — `CLEAN`, exactly —
    // rather than threading a second condition through every guard, so a run
    // that forces its way past this refusal takes precisely this path.
    const courseDir = tempCourse();
    fs.writeFileSync(path.join(courseDir, BINARY_REF), AUTHOR_BYTES, 'utf8');
    const state = stateWithFileItem();
    mockCanvas(pullRoutes());

    const outcome = await run([pullAction()], {
      courseDir,
      state,
      canvasContent: pullContent(),
      gitDirty: CLEAN,
    });

    assert.deepEqual(outcome.errors, []);
    assert.deepEqual(outcome.skipped, []);
    // A tracked binary with nothing uncommitted in it is one `git checkout`
    // away, so Canvas wins it exactly as it wins a tracked markdown file.
    assert.equal(bytesAt(courseDir), CANVAS_BYTES);
    assert.match(
      fs.readFileSync(path.join(courseDir, WRAPPER), 'utf8'),
      /file_ref: _files\/handbook\.pdf/,
    );
    assert.equal(
      state.modules['01-intro'].items[WRAPPER].canvas_hash,
      'canvas-file-hash',
      'the row has to describe what landed',
    );
    assert.equal(outcome.applied.length, 1);
  });

  it('still writes a binary that is not there at all when git cannot answer', async () => {
    silence();
    // "I cannot tell" is a reason to protect what exists, and nothing more.
    // Refusing to create a file that is not there destroys nothing and would
    // disable `file` items entirely outside a checkout.
    const courseDir = courseWithoutBinary();
    const state = stateWithFileItem();
    mockCanvas(pullRoutes());

    const outcome = await run([pullAction()], {
      courseDir,
      state,
      canvasContent: pullContent(),
      gitDirty: NO_GIT,
    });

    assert.deepEqual(outcome.errors, []);
    assert.deepEqual(outcome.skipped, []);
    assert.equal(bytesAt(courseDir), CANVAS_BYTES);
  });

  it('guards the destination Canvas named, not the one the wrapper names', async () => {
    silence();
    // The reason this cannot be a planner-side guard. The wrapper says
    // `_files/handbook.pdf` and that file is clean; Canvas calls its file
    // "Course Notes.pdf", which slugs to a different path — and the author has
    // an untracked file sitting exactly there. Nothing the planner can read
    // names that path.
    const courseDir = tempCourse();
    const collision = '01-intro/_files/course-notes.pdf';
    fs.writeFileSync(path.join(courseDir, collision), AUTHOR_BYTES, 'utf8');
    const state = stateWithFileItem();
    const content = pullContent();
    content.get(String(MODULE_ITEM_ID)).content.display_name =
      'Course Notes.pdf';
    const calls = mockCanvas(pullRoutes());

    const outcome = await run([pullAction()], {
      courseDir,
      state,
      canvasContent: content,
      gitDirty: {
        available: true,
        paths: new Set(['01-intro', '01-intro/_files', collision]),
        reason: null,
      },
    });

    assert.equal(fetchedBytes(calls), false);
    assert.equal(outcome.skipped.length, 1);
    assert.match(outcome.skipped[0].remedy, /course-notes\.pdf/);
    assert.equal(
      fs.readFileSync(path.join(courseDir, collision), 'utf8'),
      AUTHOR_BYTES,
    );
  });
});

// ---------------------------------------------------------------------------
// A pulled wrapper that already says what Canvas says
// ---------------------------------------------------------------------------

/**
 * What a pull leaves of a wrapper it had nothing to change in.
 *
 * `writeLocalFileItem` used to regenerate the wrapper on every pull of the
 * item, through `serializeFrontmatter` and `writeMarkdown`, and that rewrite
 * normalised the author's bytes whatever Canvas had to say: a quoted title came
 * back unquoted and a file with no final newline gained one. The binary is the
 * half that changed; the wrapper is rewritten only when its title, its type or
 * the path its `file_ref` resolves to would read differently.
 *
 * The first two pin the bytes and the fingerprint together, because a wrapper
 * left alone with a row hashed from the regenerated text would read as changed
 * locally on the very next run. The last two are the fences: a new title and a
 * `file_ref` naming somewhere other than the download still rewrite.
 */

const QUOTED_WRAPPER =
  "---\ntitle: 'Syllabus'\ncanvas_type: file\nfile_ref: _files/handbook.pdf\n---\n";

/** Pull the item onto a clean tree, with whatever wrapper the test wrote. */
async function pullOnto(courseDir, state, { title = 'Syllabus' } = {}) {
  const content = pullContent();
  content.get(String(MODULE_ITEM_ID)).item.title = title;
  mockCanvas(pullRoutes());
  return run([{ ...pullAction(), title }], {
    courseDir,
    state,
    canvasContent: content,
    gitDirty: CLEAN,
  });
}

/** The `local_hash` the next `gatherLocal` computes for the wrapper. */
function gatheredHash(courseDir) {
  const { modules } = gatherLocal({ courseDir, gitDirty: CLEAN });
  return modules
    .flatMap((mod) => mod.items)
    .find((item) => item.itemPath === WRAPPER).localHash;
}

function wrapperAt(courseDir) {
  return fs.readFileSync(path.join(courseDir, WRAPPER), 'utf8');
}

describe('a pulled file item whose wrapper already says what Canvas says', () => {
  it('leaves a quoted title as written, and records the hash gather computes', async () => {
    silence();
    const courseDir = tempCourse();
    fs.writeFileSync(path.join(courseDir, WRAPPER), QUOTED_WRAPPER, 'utf8');
    const state = stateWithFileItem();

    const outcome = await pullOnto(courseDir, state);

    assert.deepEqual(outcome.errors, []);
    assert.equal(outcome.applied.length, 1);
    assert.equal(bytesAt(courseDir), CANVAS_BYTES, 'the binary still lands');
    assert.equal(
      wrapperAt(courseDir),
      QUOTED_WRAPPER,
      'the author’s wrapper must come through byte for byte',
    );
    assert.equal(
      state.modules['01-intro'].items[WRAPPER].local_hash,
      gatheredHash(courseDir),
      'the row has to describe the wrapper left on disk and the binary beside it',
    );
  });

  it('leaves a wrapper with no final newline byte for byte', async () => {
    silence();
    const courseDir = tempCourse();
    const unterminated =
      '---\ntitle: Syllabus\ncanvas_type: file\nfile_ref: _files/handbook.pdf\n---';
    fs.writeFileSync(path.join(courseDir, WRAPPER), unterminated, 'utf8');
    const state = stateWithFileItem();

    const outcome = await pullOnto(courseDir, state);

    assert.deepEqual(outcome.errors, []);
    assert.equal(wrapperAt(courseDir), unterminated);
    assert.equal(
      state.modules['01-intro'].items[WRAPPER].local_hash,
      gatheredHash(courseDir),
    );
  });

  it('still rewrites the wrapper when Canvas retitled the item', async () => {
    silence();
    const courseDir = tempCourse();
    fs.writeFileSync(path.join(courseDir, WRAPPER), QUOTED_WRAPPER, 'utf8');
    const state = stateWithFileItem();

    const outcome = await pullOnto(courseDir, state, {
      title: 'Course Handbook',
    });

    assert.deepEqual(outcome.errors, []);
    const text = wrapperAt(courseDir);
    assert.match(text, /^title: Course Handbook$/m);
    assert.doesNotMatch(text, /Syllabus/);
    assert.match(text, /^file_ref: _files\/handbook\.pdf$/m);
    assert.equal(
      state.modules['01-intro'].items[WRAPPER].local_hash,
      gatheredHash(courseDir),
    );
  });

  it('still repoints a file_ref into the shared folder at the module-local copy', async () => {
    silence();
    // The repoint `docs/limitations.md` documents. Same title, same type, and a
    // `file_ref` naming a file of the same name, but in `course/_files/`: the
    // download lands in the module's own `_files/`, so the wrapper no longer
    // says where the bytes are and has to be rewritten to say it.
    const courseDir = tempCourse();
    const shared = path.join(courseDir, '_files/handbook.pdf');
    fs.mkdirSync(path.dirname(shared), { recursive: true });
    fs.writeFileSync(shared, AUTHOR_BYTES, 'utf8');
    fs.rmSync(path.join(courseDir, BINARY_REF));
    fs.writeFileSync(
      path.join(courseDir, WRAPPER),
      '---\ntitle: Syllabus\ncanvas_type: file\nfile_ref: ../_files/handbook.pdf\n---\n',
      'utf8',
    );
    const state = stateWithFileItem();

    const outcome = await pullOnto(courseDir, state);

    assert.deepEqual(outcome.errors, []);
    assert.match(wrapperAt(courseDir), /^file_ref: _files\/handbook\.pdf$/m);
    assert.equal(bytesAt(courseDir), CANVAS_BYTES);
    assert.equal(
      fs.readFileSync(shared, 'utf8'),
      AUTHOR_BYTES,
      'the shared copy is not the pull’s to touch',
    );
  });
});
