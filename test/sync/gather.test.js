const { describe, it, mock, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { mockCanvas, silence } = require('../helpers/canvas-mock');

// Set before anything that loads the Canvas client reads them.
process.env.CANVAS_API_URL = 'https://canvas.example.com';
process.env.CANVAS_API_TOKEN = 'test-token-123';

const {
  gatherCanvas,
  gatherLocal,
  gitDirtyPaths,
  runGit,
  subHeaderHash,
} = require('../../lib/sync/gather');
const {
  hashBinaryFile,
  hashLocalFile,
  legacyFileFingerprint,
} = require('../../lib/sync/fingerprint');

const COURSE_ID = 4242;

afterEach(() => mock.restoreAll());

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function tempCourse(tree) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gather-test-'));
  for (const [relative, contents] of Object.entries(tree)) {
    const full = path.join(dir, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents, 'utf8');
  }
  return dir;
}

/** Every path clean, which is the answer that lets local writes happen. */
const CLEAN = { available: true, paths: new Set(), reason: null };

/** How many times a URL fragment was requested. */
function countCalls(calls, fragment, method = 'GET') {
  return calls.filter(
    (call) => call.method === method && call.url.includes(fragment),
  ).length;
}

// ---------------------------------------------------------------------------
// gatherLocal
// ---------------------------------------------------------------------------

describe('gatherLocal', () => {
  it('gives a subfolder a sub_header item keyed by the subfolder path', () => {
    const dir = tempCourse({
      '01-intro/01-welcome.md': '---\ntitle: Welcome\n---\n\nHello.\n',
      '01-intro/02-theory/_category_.json': '{ "label": "Theory" }\n',
      '01-intro/02-theory/01-types.md': '---\ntitle: Types\n---\n\nBody.\n',
    });

    const { modules } = gatherLocal({ courseDir: dir, gitDirty: CLEAN });

    assert.equal(modules.length, 1);
    const [header] = modules[0].items.filter(
      (item) => item.canvasType === 'sub_header',
    );
    assert.ok(header, 'the subfolder produced no sub_header item');
    assert.equal(header.itemPath, '01-intro/02-theory');
    assert.equal(header.title, 'Theory');
    assert.equal(
      header.localHash,
      subHeaderHash({ title: 'Theory', indent: 0 }),
    );

    // Positions run straight through the module, the way Canvas counts them,
    // rather than restarting inside the subfolder.
    assert.deepEqual(
      modules[0].items.map((item) => [item.itemPath, item.position]),
      [
        ['01-intro/01-welcome.md', 1],
        ['01-intro/02-theory', 2],
        ['01-intro/02-theory/01-types.md', 3],
      ],
    );
  });

  it('hashes each markdown file exactly as fingerprint.js would', () => {
    const dir = tempCourse({
      '01-intro/01-welcome.md': '---\ntitle: Welcome\n---\n\nHello.\n',
    });

    const { modules } = gatherLocal({ courseDir: dir, gitDirty: CLEAN });

    assert.equal(
      modules[0].items[0].localHash,
      hashLocalFile(path.join(dir, '01-intro/01-welcome.md')),
    );
    assert.equal(typeof modules[0].items[0].localMtimeMs, 'number');
  });

  it('marks only the paths git reported as dirty', () => {
    const dir = tempCourse({
      '01-intro/01-welcome.md': 'a\n',
      '01-intro/02-second.md': 'b\n',
    });

    const { modules } = gatherLocal({
      courseDir: dir,
      gitDirty: {
        available: true,
        paths: new Set(['01-intro/02-second.md']),
        reason: null,
      },
    });

    assert.deepEqual(
      modules[0].items.map((item) => [item.itemPath, item.dirty]),
      [
        ['01-intro/01-welcome.md', false],
        ['01-intro/02-second.md', true],
      ],
    );
  });

  it('marks everything dirty when git could not answer', () => {
    // "Cannot tell" has to read as "do not overwrite": git is the only undo
    // this system has, so a run that cannot consult it never writes locally.
    const dir = tempCourse({
      '01-intro/01-welcome.md': 'a\n',
      '01-intro/02-theory/01-types.md': 'b\n',
    });

    const { modules } = gatherLocal({
      courseDir: dir,
      gitDirty: { available: false, paths: new Set(), reason: 'no git' },
    });

    assert.ok(modules[0].items.every((item) => item.dirty === true));
    assert.equal(modules[0].dirty, true, 'the folder cannot be told either');
  });

  it('marks the folder dirty for work no item can speak for', () => {
    // The whole point of the module-level flag. `_files/` is skipped by the
    // scanner, so an untracked binary in it produces no item at all — and
    // `delete-local-module` is recursive, so the folder is what the delete
    // actually removes and the folder is what has to be asked.
    const dir = tempCourse({
      '01-intro/01-welcome.md': 'a\n',
      '01-intro/_files/diagram.png': 'PNG\n',
    });

    const { modules } = gatherLocal({
      courseDir: dir,
      // What `gitDirtyPaths` returns for one untracked `_files/` binary:
      // the path plus every ancestor of it.
      gitDirty: {
        available: true,
        paths: new Set([
          '01-intro',
          '01-intro/_files',
          '01-intro/_files/diagram.png',
        ]),
        reason: null,
      },
    });

    assert.deepEqual(
      modules[0].items.map((item) => [item.itemPath, item.dirty]),
      [['01-intro/01-welcome.md', false]],
      'no scanned item can carry this fact',
    );
    assert.equal(modules[0].dirty, true);
  });

  it('leaves the folder clean when nothing under it is dirty', () => {
    // The fence. A flag that were always true would refuse every local module
    // delete for ever, and every test above it would still pass.
    const dir = tempCourse({
      '01-intro/01-welcome.md': 'a\n',
      '02-loops/01-while.md': 'b\n',
      '02-loops/_files/diagram.png': 'PNG\n',
    });

    const { modules } = gatherLocal({
      courseDir: dir,
      gitDirty: {
        available: true,
        paths: new Set([
          '02-loops',
          '02-loops/_files',
          '02-loops/_files/diagram.png',
        ]),
        reason: null,
      },
    });

    assert.deepEqual(
      modules.map((module) => [module.folder, module.dirty]),
      [
        ['01-intro', false],
        ['02-loops', true],
      ],
      'dirtiness is per folder, not per course',
    );
  });

  it('flags an uncommitted _category_.json on its own, not through the folder', () => {
    // What guards `update-local-module`, which writes that one file. The
    // folder's flag cannot do it: `gitDirtyPaths` adds every ancestor, so it is
    // true for anything uncommitted anywhere under the module, and no scanned
    // item can either — the scanner never returns `_category_.json` as an item.
    const dir = tempCourse({
      '01-intro/01-welcome.md': 'a\n',
      '01-intro/_category_.json': '{ "label": "My Own Title" }\n',
    });

    const { modules } = gatherLocal({
      courseDir: dir,
      gitDirty: {
        available: true,
        paths: new Set(['01-intro', '01-intro/_category_.json']),
        reason: null,
      },
    });

    assert.equal(modules[0].categoryDirty, true);
    assert.deepEqual(
      modules[0].items.map((item) => item.dirty),
      [false],
      'no scanned item carries this fact either',
    );
  });

  it('leaves _category_.json clean when the dirt is elsewhere in the folder', () => {
    // The fence, and the one that matters: the folder reads dirty for the
    // lesson beside it, and a guard resting on that would refuse to relabel any
    // module its author is in the middle of working on.
    const dir = tempCourse({
      '01-intro/01-welcome.md': 'a\n',
      '01-intro/_category_.json': '{ "label": "Intro" }\n',
      '01-intro/_files/diagram.png': 'PNG\n',
    });

    const { modules } = gatherLocal({
      courseDir: dir,
      gitDirty: {
        available: true,
        paths: new Set([
          '01-intro',
          '01-intro/_files',
          '01-intro/_files/diagram.png',
        ]),
        reason: null,
      },
    });

    assert.equal(modules[0].dirty, true, 'the folder holds uncommitted work');
    assert.equal(modules[0].categoryDirty, false, 'but not in this file');
  });

  it('does not flag a _category_.json that is not there, even blind', () => {
    // Existence first, the rule `wouldDestroyUnsavedWork` states. Where git
    // cannot answer everything reads dirty, and without this a module with no
    // `_category_.json` would be refused its Canvas label — a refusal to
    // overwrite nothing.
    const dir = tempCourse({ '01-intro/01-welcome.md': 'a\n' });

    const { modules } = gatherLocal({
      courseDir: dir,
      gitDirty: { available: false, paths: new Set(), reason: 'no git' },
    });

    assert.equal(modules[0].dirty, true, 'the folder cannot be told');
    assert.equal(modules[0].categoryDirty, false, 'the file is not there');
  });
});

// ---------------------------------------------------------------------------
// gatherLocal: a file item and the binary behind it
// ---------------------------------------------------------------------------

/**
 * A `file` item in wrapper form is two files pretending to be one: a markdown
 * stub carrying `canvas_type: file` and `file_ref:`, and the binary that
 * `file_ref` names. What a push sends Canvas is the **binary**, so a fingerprint
 * taken over the wrapper's text alone answers the wrong question — replace last
 * year's PDF with this year's and the run reports nothing while students go on
 * downloading the old one.
 */
describe('gatherLocal: a file item and the binary behind it', () => {
  const WRAPPER = '01-intro/03-syllabus.md';

  function wrapperText(ref = '_files/handbook.pdf') {
    return `---\ntitle: Syllabus\ncanvas_type: file\nfile_ref: ${ref}\n---\n`;
  }

  /** What `gatherLocal` recorded for one path, hash and warnings together. */
  function gathered(dir, itemPath = WRAPPER) {
    const { modules, warnings } = gatherLocal({
      courseDir: dir,
      gitDirty: CLEAN,
    });
    const item = modules
      .flatMap((mod) => mod.items)
      .find((entry) => entry.itemPath === itemPath);
    return { item, warnings };
  }

  it('reads the wrapper as changed when only the binary behind it moved', () => {
    const dir = tempCourse({
      [WRAPPER]: wrapperText(),
      '01-intro/_files/handbook.pdf': 'last year’s handbook',
    });
    const before = gathered(dir).item.localHash;

    // The author swaps in this year's PDF and touches nothing else — the whole
    // of the defect, in one line.
    fs.writeFileSync(
      path.join(dir, '01-intro/_files/handbook.pdf'),
      'this year’s handbook',
      'utf8',
    );

    assert.notEqual(
      gathered(dir).item.localHash,
      before,
      'a wrapper whose binary was replaced must not read as unchanged',
    );
  });

  it('keeps the hash across a rename that carried the binary along', () => {
    // Rename detection pairs a vanished path with a new one by `local_hash`
    // (`lib/sync/rename-detect.js`), so a hash that moved for a rename alone
    // turns a re-key into a delete plus a create. Nothing about *where* the two
    // files sit may reach the hash: only the wrapper's text and the bytes.
    const dir = tempCourse({
      [WRAPPER]: wrapperText(),
      '01-intro/_files/handbook.pdf': 'handbook bytes',
    });
    const original = gathered(dir).item.localHash;

    fs.renameSync(
      path.join(dir, WRAPPER),
      path.join(dir, '01-intro/07-syllabus.md'),
    );
    assert.equal(
      gathered(dir, '01-intro/07-syllabus.md').item.localHash,
      original,
      'renumbering the wrapper changed its fingerprint',
    );

    // And the same again when the module folder itself moves, which carries
    // the wrapper and its `_files/` together.
    fs.renameSync(path.join(dir, '01-intro'), path.join(dir, '04-intro'));
    assert.equal(
      gathered(dir, '04-intro/07-syllabus.md').item.localHash,
      original,
      'moving the whole module changed the wrapper’s fingerprint',
    );
  });

  it('warns instead of throwing when the file_ref names nothing', () => {
    // Whether the reference is honourable at all is `npx course validate`'s
    // question, and it already errors on both halves of it (`cli/validate.js`).
    // All that is owed here is a run that survives: no hash, so the item reads
    // as unchanged locally and nothing is written over on either side.
    const dir = tempCourse({
      [WRAPPER]: wrapperText('_files/missing.pdf'),
      '01-intro/01-welcome.md': '---\ntitle: Welcome\n---\n\nHello.\n',
    });

    const { item, warnings } = gathered(dir);

    assert.equal(item.localHash, null);
    assert.ok(
      warnings.some((line) => line.includes(WRAPPER)),
      `no warning named the wrapper; got ${JSON.stringify(warnings)}`,
    );
    // One bad item costs that item and nothing else.
    assert.ok(gathered(dir, '01-intro/01-welcome.md').item.localHash);
  });
});

// ---------------------------------------------------------------------------
// gatherLocal: what a killed reorder left behind
// ---------------------------------------------------------------------------

/**
 * A process killed outright between the two halves of `reorderLocalModule`
 * never runs its unwind, so files stay parked under `__cw_order_*`.
 * `scanCourse` skips every `_`-prefixed name, so without recovery the next run
 * reads those items as locally deleted — and `push --prune-canvas` offers to
 * delete the Canvas objects behind them. Hence: before the scan, in every
 * direction.
 */
describe('gatherLocal: recovering an interrupted renumbering', () => {
  const pathsOf = (module) => module.items.map((item) => item.itemPath);

  it('puts a parked file back under its own name before scanning', () => {
    const dir = tempCourse({
      '01-intro/__cw_order_01-welcome.md': '---\ntitle: Welcome\n---\n\nA.\n',
      '01-intro/02-theory.md': '---\ntitle: Theory\n---\n\nB.\n',
    });

    const { modules, warnings } = gatherLocal({
      courseDir: dir,
      gitDirty: CLEAN,
    });

    assert.equal(
      fs.existsSync(path.join(dir, '01-intro/01-welcome.md')),
      true,
      'the parked file is restored',
    );
    assert.equal(
      fs.existsSync(path.join(dir, '01-intro/__cw_order_01-welcome.md')),
      false,
    );
    // The item is in the scan, which is the whole point: it is not reported as
    // locally deleted, so nothing offers to delete its Canvas object.
    assert.deepEqual(pathsOf(modules[0]), [
      '01-intro/01-welcome.md',
      '01-intro/02-theory.md',
    ]);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /Recovered 01-intro\/01-welcome\.md/);
  });

  it('reaches a parked file one level further down, inside a subfolder', () => {
    const dir = tempCourse({
      '01-intro/02-theory/__cw_order_01-types.md':
        '---\ntitle: Types\n---\n\nC.\n',
      '01-intro/02-theory/_category_.json': '{ "label": "Theory" }\n',
    });

    const { modules } = gatherLocal({ courseDir: dir, gitDirty: CLEAN });

    assert.equal(
      fs.existsSync(path.join(dir, '01-intro/02-theory/01-types.md')),
      true,
    );
    assert.deepEqual(pathsOf(modules[0]), [
      '01-intro/02-theory',
      '01-intro/02-theory/01-types.md',
    ]);
  });

  it('recovers a parked subfolder, and everything the rename carries with it', () => {
    // A subfolder is a text header, so a reorder parks directories too — and one
    // rename takes the whole subtree back with it.
    const dir = tempCourse({
      '01-intro/__cw_order_02-theory/_category_.json':
        '{ "label": "Theory" }\n',
      '01-intro/__cw_order_02-theory/01-types.md':
        '---\ntitle: Types\n---\n\nD.\n',
    });

    const { modules, warnings } = gatherLocal({
      courseDir: dir,
      gitDirty: CLEAN,
    });

    assert.deepEqual(pathsOf(modules[0]), [
      '01-intro/02-theory',
      '01-intro/02-theory/01-types.md',
    ]);
    assert.match(warnings[0], /Recovered 01-intro\/02-theory/);
  });

  it('leaves a parked file alone when its own name is occupied, and says so', () => {
    // Deleting one of the two is how a recoverable interruption becomes lost
    // work, so neither is touched. The occupant is scanned as usual, which is
    // what keeps the run from reporting the item as deleted.
    const dir = tempCourse({
      '01-intro/__cw_order_01-welcome.md': 'the parked copy\n',
      '01-intro/01-welcome.md': '---\ntitle: Welcome\n---\n\nthe occupant\n',
    });

    const { modules, warnings } = gatherLocal({
      courseDir: dir,
      gitDirty: CLEAN,
    });

    assert.equal(
      fs.readFileSync(
        path.join(dir, '01-intro/__cw_order_01-welcome.md'),
        'utf8',
      ),
      'the parked copy\n',
    );
    assert.match(
      fs.readFileSync(path.join(dir, '01-intro/01-welcome.md'), 'utf8'),
      /the occupant/,
    );
    assert.deepEqual(pathsOf(modules[0]), ['01-intro/01-welcome.md']);
    assert.equal(warnings.length, 1);
    assert.match(
      warnings[0],
      /01-intro\/__cw_order_01-welcome\.md .*occupied.*Nothing was deleted/s,
    );
  });

  it('says nothing at all about a tree with no leftovers', () => {
    const dir = tempCourse({ '01-intro/01-welcome.md': 'a\n' });

    const { warnings } = gatherLocal({ courseDir: dir, gitDirty: CLEAN });

    assert.deepEqual(warnings, []);
  });
});

// ---------------------------------------------------------------------------
// gitDirtyPaths
// ---------------------------------------------------------------------------

describe('gitDirtyPaths', () => {
  const fakeRun = (statusOutput) => (args) => {
    if (args[0] === 'rev-parse') return '/repo\n';
    return statusOutput;
  };

  it('reads modified, untracked and renamed paths, relative to the course', () => {
    const status = [
      ' M course/01-intro/01-welcome.md\0',
      '?? course/01-intro/03-new.md\0',
      'R  course/01-intro/05-to.md\0course/01-intro/04-from.md\0',
      '?? course/02-loops/_files/diagram.png\0',
      ' M docs/user-guide.md\0',
    ].join('');

    const result = gitDirtyPaths({
      courseDir: '/repo/course',
      cwd: '/repo',
      run: fakeRun(status),
    });

    assert.equal(result.available, true);
    assert.ok(result.paths.has('01-intro/01-welcome.md'));
    assert.ok(result.paths.has('01-intro/03-new.md'));
    // Both halves of a rename are uncommitted work.
    assert.ok(result.paths.has('01-intro/05-to.md'));
    assert.ok(result.paths.has('01-intro/04-from.md'));
    // A folder inherits the state of what is inside it, so a text header can
    // be asked the same question as a file.
    assert.ok(result.paths.has('01-intro'));
    // Every ancestor, not just the immediate one — which is what lets a module
    // folder answer for a binary two levels down, in a folder the course
    // scanner never descends into. The module-level delete guard rests on it.
    assert.ok(result.paths.has('02-loops/_files/diagram.png'));
    assert.ok(result.paths.has('02-loops/_files'));
    assert.ok(result.paths.has('02-loops'));
    // Anything outside course/ is none of a sync's business.
    assert.ok(!result.paths.has('docs/user-guide.md'));

    // `files` is the same answer without the ancestors: exactly what git named,
    // and the only one of the two that can be counted. `pull --force` counts it
    // to decide whether to ask before overriding the guards, and counting
    // `paths` would quote a number inflated by every directory on the way down.
    assert.deepEqual(
      [...result.files].sort(),
      [
        '01-intro/01-welcome.md',
        '01-intro/03-new.md',
        '01-intro/04-from.md',
        '01-intro/05-to.md',
        '02-loops/_files/diagram.png',
      ],
      'the files git named, and no directory it did not',
    );
  });

  it('says everything is dirty when git is not there', () => {
    const result = gitDirtyPaths({
      courseDir: '/repo/course',
      cwd: '/repo',
      run: () => {
        throw new Error('spawn git ENOENT');
      },
    });

    assert.equal(result.available, false);
    assert.match(result.reason, /git could not be run/);
    assert.equal(result.paths.size, 0);
    // Empty, and it has to be read as "no answer" rather than "no dirty files":
    // `pull --force` falls back to counting scanned items here, or its question
    // would vanish for the run that most needs it.
    assert.equal(result.files.size, 0);
  });

  it('reads more from git than the default buffer holds', () => {
    // `execFileSync` stops at 1 MB unless told otherwise, and stopping is a
    // throw. One `--porcelain -z` entry costs its path plus four bytes, so a
    // checkout that has stopped ignoring an `npm install` blows through the
    // default on the untracked list alone — and the guard then refuses every
    // local write for the rest of the run.
    //
    // Driven through `cat-file` rather than by making a tree with tens of
    // thousands of files in it: the buffer is a property of `runGit`, which
    // both commands go through, and this asks git for two megabytes in a
    // fraction of the time.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gather-buffer-'));
    try {
      const big = 'x'.repeat(2 * 1024 * 1024);
      fs.writeFileSync(path.join(dir, 'big.txt'), big, 'utf8');
      runGit(['init'], dir);
      runGit(['add', 'big.txt'], dir);

      const out = runGit(['cat-file', '-p', ':big.txt'], dir);

      assert.equal(out.length, big.length);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('says a tree is too big to list rather than quoting ENOBUFS', () => {
    // The safe direction is unchanged — nothing can be proved safe to
    // overwrite, so everything is dirty — but the line the user gets has to
    // say what to go and look at. `spawnSync git ENOBUFS` reads as git having
    // broken.
    const result = gitDirtyPaths({
      courseDir: '/repo/course',
      cwd: '/repo',
      run: (args) => {
        if (args[0] === 'rev-parse') return '/repo\n';
        const err = new Error('spawnSync git ENOBUFS');
        err.code = 'ENOBUFS';
        throw err;
      },
    });

    assert.equal(result.available, false);
    assert.match(result.reason, /listed more than \d+ MB of paths/);
    assert.doesNotMatch(result.reason, /ENOBUFS/);
    assert.equal(result.paths.size, 0);
    assert.equal(result.files.size, 0);
  });

  it('issues exactly two git commands, whatever the course holds', () => {
    const calls = [];
    gitDirtyPaths({
      courseDir: '/repo/course',
      cwd: '/repo',
      run: (args) => {
        calls.push(args[0]);
        return args[0] === 'rev-parse' ? '/repo\n' : '';
      },
    });
    assert.deepEqual(calls, ['rev-parse', 'status']);
  });
});

// ---------------------------------------------------------------------------
// gatherCanvas
// ---------------------------------------------------------------------------

describe('gatherCanvas', () => {
  it('skips getPage for a page whose updated_at has not moved, and fetches the one that has', async () => {
    silence();
    const base = {
      modules: {
        '01-intro': {
          canvas_module_id: 10,
          items: {
            '01-intro/01-stable.md': {
              canvas_type: 'page',
              canvas_id: 501,
              page_url: 'stable',
              module_item_id: 91,
              title: 'Stable',
              canvas_hash: 'stored-stable-hash',
              canvas_updated_at: '2026-08-01T10:00:00.000Z',
            },
            '01-intro/02-moved.md': {
              canvas_type: 'page',
              canvas_id: 502,
              page_url: 'moved',
              module_item_id: 92,
              title: 'Moved',
              canvas_hash: 'stored-moved-hash',
              canvas_updated_at: '2026-08-01T10:00:00.000Z',
            },
          },
        },
      },
    };

    const calls = mockCanvas([
      {
        method: 'GET',
        path: '/modules/10/items',
        body: [
          {
            id: 91,
            type: 'Page',
            title: 'Stable',
            page_url: 'stable',
            content_id: 501,
            position: 1,
            indent: 0,
          },
          {
            id: 92,
            type: 'Page',
            title: 'Moved',
            page_url: 'moved',
            content_id: 502,
            position: 2,
            indent: 0,
          },
        ],
      },
      {
        method: 'GET',
        path: '/modules',
        body: [{ id: 10, name: 'Intro', position: 1 }],
      },
      {
        method: 'GET',
        path: '/pages/moved',
        body: {
          page_id: 502,
          url: 'moved',
          title: 'Moved',
          body: '<p>new</p>',
          updated_at: '2026-08-19T10:00:00.000Z',
        },
      },
      {
        method: 'GET',
        path: '/pages',
        body: [
          {
            page_id: 501,
            url: 'stable',
            title: 'Stable',
            updated_at: '2026-08-01T10:00:00.000Z',
          },
          {
            page_id: 502,
            url: 'moved',
            title: 'Moved',
            updated_at: '2026-08-19T10:00:00.000Z',
          },
        ],
      },
    ]);

    const { modules } = await gatherCanvas({ courseId: COURSE_ID, base });

    // One page list for the whole course, and one body fetch: the page that
    // moved. The unchanged one costs nothing at all.
    assert.equal(countCalls(calls, '/pages/moved'), 1);
    assert.equal(
      calls.filter((call) => /\/pages\/[a-z]/.test(call.url)).length,
      1,
      'a page whose updated_at is unchanged must not be fetched',
    );

    const [stable, moved] = modules[0].items;
    assert.equal(stable.canvasHash, 'stored-stable-hash');
    assert.equal(stable.canvasUpdatedAt, '2026-08-01T10:00:00.000Z');
    assert.notEqual(moved.canvasHash, 'stored-moved-hash');
    assert.equal(moved.canvasUpdatedAt, '2026-08-19T10:00:00.000Z');
  });

  it('fetches a page whose module item was renamed even though the page did not move', async () => {
    silence();
    const base = {
      modules: {
        '01-intro': {
          canvas_module_id: 10,
          items: {
            '01-intro/01-stable.md': {
              canvas_type: 'page',
              canvas_id: 501,
              page_url: 'stable',
              module_item_id: 91,
              title: 'Old label',
              canvas_hash: 'stored-hash',
              canvas_updated_at: '2026-08-01T10:00:00.000Z',
            },
          },
        },
      },
    };

    mockCanvas([
      {
        method: 'GET',
        path: '/modules/10/items',
        body: [
          {
            id: 91,
            type: 'Page',
            title: 'New label',
            page_url: 'stable',
            content_id: 501,
            position: 1,
            indent: 0,
          },
        ],
      },
      {
        method: 'GET',
        path: '/modules',
        body: [{ id: 10, name: 'Intro', position: 1 }],
      },
      {
        method: 'GET',
        path: '/pages/stable',
        body: {
          page_id: 501,
          url: 'stable',
          title: 'Stable',
          body: '<p>same</p>',
          updated_at: '2026-08-01T10:00:00.000Z',
        },
      },
      {
        method: 'GET',
        path: '/pages',
        body: [
          {
            page_id: 501,
            url: 'stable',
            title: 'Stable',
            updated_at: '2026-08-01T10:00:00.000Z',
          },
        ],
      },
    ]);

    const { modules } = await gatherCanvas({ courseId: COURSE_ID, base });
    assert.notEqual(modules[0].items[0].canvasHash, 'stored-hash');
  });

  it('costs one list request for assignments and one for discussions, whatever the item count', async () => {
    silence();
    const items = [];
    const assignments = [];
    const discussions = [];
    for (let i = 1; i <= 3; i++) {
      items.push({
        id: 100 + i,
        type: 'Assignment',
        title: `A${i}`,
        content_id: 200 + i,
        position: i,
        indent: 0,
      });
      assignments.push({
        id: 200 + i,
        name: `A${i}`,
        description: `<p>${i}</p>`,
        updated_at: '2026-08-01T10:00:00.000Z',
      });
    }
    for (let i = 1; i <= 2; i++) {
      items.push({
        id: 300 + i,
        type: 'Discussion',
        title: `D${i}`,
        content_id: 400 + i,
        position: 3 + i,
        indent: 0,
      });
      discussions.push({
        id: 400 + i,
        title: `D${i}`,
        message: `<p>${i}</p>`,
        updated_at: '2026-08-01T10:00:00.000Z',
      });
    }

    const calls = mockCanvas([
      { method: 'GET', path: '/modules/10/items', body: items },
      {
        method: 'GET',
        path: '/modules',
        body: [{ id: 10, name: 'Intro', position: 1 }],
      },
      { method: 'GET', path: '/assignments', body: assignments },
      { method: 'GET', path: '/discussion_topics', body: discussions },
    ]);

    const { modules } = await gatherCanvas({ courseId: COURSE_ID, base: null });

    assert.equal(countCalls(calls, '/assignments'), 1);
    assert.equal(countCalls(calls, '/discussion_topics'), 1);
    assert.equal(modules[0].items.length, 5);
    assert.ok(modules[0].items.every((item) => item.canvasHash != null));
  });

  it('reports an unrecognised item type instead of throwing', async () => {
    silence();
    mockCanvas([
      {
        method: 'GET',
        path: '/modules/10/items',
        body: [
          {
            id: 91,
            type: 'Sasquatch',
            title: 'Something new',
            position: 1,
            indent: 0,
          },
        ],
      },
      {
        method: 'GET',
        path: '/modules',
        body: [{ id: 10, name: 'Intro', position: 1 }],
      },
    ]);

    const { modules } = await gatherCanvas({ courseId: COURSE_ID, base: null });

    const [item] = modules[0].items;
    assert.equal(item.recognised, false);
    assert.equal(item.canvasHash, null);
    assert.equal(item.rawType, 'Sasquatch');
    assert.equal(item.canvasType, null);
  });

  it('fingerprints a text header and the reference types from the module item alone', async () => {
    silence();
    const calls = mockCanvas([
      {
        method: 'GET',
        path: '/modules/10/items',
        body: [
          {
            id: 91,
            type: 'SubHeader',
            title: 'Theory',
            position: 1,
            indent: 0,
          },
          {
            id: 92,
            type: 'ExternalUrl',
            title: 'Docs',
            external_url: 'https://example.com',
            new_tab: true,
            position: 2,
            indent: 1,
          },
          {
            id: 93,
            type: 'Quiz',
            title: 'Test',
            content_id: 700,
            position: 3,
            indent: 0,
          },
        ],
      },
      {
        method: 'GET',
        path: '/modules',
        body: [{ id: 10, name: 'Intro', position: 1 }],
      },
    ]);

    const { modules } = await gatherCanvas({ courseId: COURSE_ID, base: null });

    // Two requests for the whole run: the module list and its items.
    assert.equal(calls.length, 2);
    assert.ok(modules[0].items.every((item) => item.canvasHash != null));
    assert.equal(modules[0].items[0].suggestedPath, '01-intro/01-theory');
    assert.equal(
      modules[0].items[1].suggestedPath,
      '01-intro/01-theory/01-docs.md',
    );
    assert.equal(modules[0].items[2].canvasId, 700);
  });

  it("times a file item by the file's modified_at, and by updated_at only without one", async () => {
    // The `newest` tiebreak reads `canvasUpdatedAt`, and for a file it has to
    // be the clock the fingerprint reads. The first file was locked with its
    // module after the upload, which moved `updated_at` and nothing else; a
    // tiebreak reading that would call Canvas newer than it is.
    silence();
    mockCanvas([
      {
        method: 'GET',
        path: '/modules/10/items',
        body: [
          {
            id: 91,
            type: 'File',
            title: 'Syllabus',
            content_id: 770,
            position: 1,
            indent: 0,
          },
          {
            id: 92,
            type: 'File',
            title: 'Handbook',
            content_id: 771,
            position: 2,
            indent: 0,
          },
        ],
      },
      {
        method: 'GET',
        path: '/modules',
        body: [{ id: 10, name: 'Intro', position: 1 }],
      },
      {
        method: 'GET',
        path: '/api/v1/files/770',
        body: {
          id: 770,
          display_name: 'syllabus.pdf',
          size: 10,
          locked: true,
          modified_at: '2026-10-01T09:00:00Z',
          updated_at: '2026-10-01T09:05:00Z',
        },
      },
      {
        method: 'GET',
        path: '/api/v1/files/771',
        body: {
          id: 771,
          display_name: 'handbook.pdf',
          size: 20,
          updated_at: '2026-10-01T09:07:00Z',
        },
      },
    ]);

    const { modules } = await gatherCanvas({ courseId: COURSE_ID, base: null });

    const [syllabus, handbook] = modules[0].items;
    assert.equal(syllabus.canvasUpdatedAt, '2026-10-01T09:00:00Z');
    assert.equal(handbook.canvasUpdatedAt, '2026-10-01T09:07:00Z');

    // The 1.5.2 migration bridge rides along: what 1.5.1 would have recorded
    // for the same file, for the planner to recognise an old row by.
    assert.equal(
      syllabus.legacyCanvasHash,
      legacyFileFingerprint({
        item: {
          id: 91,
          type: 'File',
          title: 'Syllabus',
          content_id: 770,
          position: 1,
          indent: 0,
        },
        content: {
          id: 770,
          display_name: 'syllabus.pdf',
          size: 10,
          locked: true,
          modified_at: '2026-10-01T09:00:00Z',
          updated_at: '2026-10-01T09:05:00Z',
        },
      }),
    );
  });

  it('carries a module whose items cannot be listed as unreadable, not as gone', async () => {
    // The defect this pins: the module used to be dropped from the gather
    // entirely, and a dropped module is byte for byte what a module deleted on
    // Canvas looks like — `--prune-local` then offered to delete its local
    // folder. A plain 403 (no "Rate Limit Exceeded" in the body) is not
    // retried, so the failure is one request.
    silence();
    mockCanvas([
      {
        method: 'GET',
        path: '/modules/10/items',
        body: { message: 'unauthorized' },
        status: 403,
      },
      {
        method: 'GET',
        path: '/modules/20/items',
        body: [
          {
            id: 91,
            type: 'SubHeader',
            title: 'Theory',
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
          { id: 20, name: 'Basics', position: 2 },
        ],
      },
    ]);

    const { modules, warnings } = await gatherCanvas({
      courseId: COURSE_ID,
      base: null,
    });

    // Both modules arrive: the unreadable one flagged, with its identity
    // intact and no item list at all — an empty list would be a claim about
    // what the module holds, and that claim is exactly what could not be read.
    assert.equal(modules.length, 2);
    const [intro, basics] = modules;
    assert.equal(intro.canvasModuleId, 10);
    assert.equal(intro.name, 'Intro');
    assert.equal(intro.suggestedFolder, '01-intro');
    assert.match(intro.unreadable, /403/);
    assert.equal('items' in intro, false);

    // The failure stays confined: the next module is gathered in full.
    assert.equal(basics.unreadable, undefined);
    assert.equal(basics.items.length, 1);
    assert.equal(basics.items[0].canvasType, 'sub_header');

    assert.equal(
      warnings.filter((warning) => /module 10/.test(warning)).length,
      1,
    );
  });
});

// ---------------------------------------------------------------------------
// gatherLocal: what the whole course embeds
// ---------------------------------------------------------------------------

/**
 * The reference set, and the flag that says whether it can be believed.
 *
 * It is collected here rather than where it is used, because this is the only
 * place that reads the whole of `course/`. The planner is handed whichever
 * modules `-m` named, and the executor sees only the items a run wrote — an
 * unchanged page never passes through it at all. Anything that decides a
 * `state.files` row is dead from either of those views declares the entire
 * course unreferenced and deletes live images out of a live course, so
 * `complete` is the licence, and it is default-deny.
 */
describe('gatherLocal: what the whole course embeds', () => {
  it('collects every reference in the tree, whatever module it is in', () => {
    const dir = tempCourse({
      '01-intro/01-welcome.md':
        '---\ntitle: Welcome\n---\n\n![Logo](./_files/logo.png)\n',
      '01-intro/_files/logo.png': 'PNG',
      '01-intro/02-theory/01-types.md':
        '---\ntitle: Types\n---\n\n[Slides](../_files/slides.pdf)\n',
      '01-intro/_files/slides.pdf': 'PDF',
      '02-html/01-tags.md':
        '---\ntitle: Tags\n---\n\n![Shared](../01-intro/_files/logo.png)\n',
      // Neither of these is a reference: one is an example inside a fence, the
      // other is a link to another item. The set is built by the same extractor
      // that created the rows, so the two can never disagree about which is
      // which.
      '02-html/02-links.md':
        '---\ntitle: Links\n---\n\n```md\n![Nope](./_files/example.png)\n```\n\n[Tags](./01-tags.md)\n',
    });

    const { embedded } = gatherLocal({ courseDir: dir, gitDirty: CLEAN });

    assert.equal(embedded.complete, true);
    assert.deepEqual(
      [...embedded.refs.keys()].sort(),
      ['01-intro/_files/logo.png', '01-intro/_files/slides.pdf'],
      'a binary embedded from two modules is one reference, found from both',
    );
  });

  it('hashes each binary as bytes, and each item carries what it embeds', () => {
    // The two things the planner needs to see an image edited in place: the
    // paths one item points at, and what the bytes behind them are now. Hashed
    // as bytes and not as text, because a 0x0d inside a PNG is data — normalise
    // it and the digest matches no file that has ever been uploaded.
    const dir = tempCourse({
      '01-intro/01-welcome.md':
        '---\ntitle: Welcome\n---\n\n![Logo](./_files/logo.png)\n[Slides](./_files/slides.pdf)\n',
      '01-intro/_files/logo.png': 'PNG\r\nBYTES',
      '01-intro/_files/slides.pdf': 'PDF',
      '01-intro/02-theory.md': '---\ntitle: Theory\n---\n\nNo images here.\n',
    });

    const { modules, embedded } = gatherLocal({
      courseDir: dir,
      gitDirty: CLEAN,
    });

    assert.equal(
      embedded.refs.get('01-intro/_files/logo.png'),
      hashBinaryFile(path.join(dir, '01-intro/_files/logo.png')),
    );
    assert.notEqual(
      embedded.refs.get('01-intro/_files/logo.png'),
      hashLocalFile(path.join(dir, '01-intro/_files/logo.png')),
      'the bytes of an image are not text and must not be normalised',
    );
    assert.deepEqual(modules[0].items[0].embeds, [
      '01-intro/_files/logo.png',
      '01-intro/_files/slides.pdf',
    ]);
    assert.deepEqual(modules[0].items[1].embeds, []);
  });

  it('records no hash for a binary it cannot read, and stays whole', () => {
    // A `![](…)` pointing at nothing is still a reference the tree makes, so
    // the row for it is not an orphan and `complete` has no business moving.
    // What the missing file costs is one conclusion about one path: `null` says
    // "conclude nothing", which is what `uploadEmbeddedFiles` does with it too.
    const dir = tempCourse({
      '01-intro/01-welcome.md':
        '---\ntitle: Welcome\n---\n\n![Gone](./_files/missing.png)\n',
    });

    const { embedded } = gatherLocal({ courseDir: dir, gitDirty: CLEAN });

    assert.equal(
      embedded.complete,
      true,
      'one broken image is not a blind run',
    );
    assert.equal(embedded.refs.has('01-intro/_files/missing.png'), true);
    assert.equal(embedded.refs.get('01-intro/_files/missing.png'), null);
  });

  it('refuses to claim the set is whole when an item is still parked', () => {
    // A file left under `__cw_order_*` that recovery could not put back is an
    // item `scanCourse` never sees, so whatever it embedded is missing from the
    // set. That is precisely the shape of a false "nothing references this".
    const dir = tempCourse({
      '01-intro/01-welcome.md': '---\ntitle: Welcome\n---\n\nA.\n',
      '01-intro/__cw_order_01-welcome.md':
        '---\ntitle: Welcome\n---\n\n![Logo](./_files/logo.png)\n',
    });

    const { embedded, warnings } = gatherLocal({
      courseDir: dir,
      gitDirty: CLEAN,
    });

    assert.equal(embedded.complete, false);
    assert.ok(warnings.some((line) => line.includes('occupied')));
  });

  it('refuses to claim it is whole when an item could not be read', () => {
    const dir = tempCourse({
      '01-intro/01-welcome.md':
        '---\ntitle: Welcome\n---\n\n![Logo](./_files/logo.png)\n',
      '01-intro/02-theory.md': '---\ntitle: Theory\n---\n\nB.\n',
    });
    silence();
    // One item the scan lists and nothing can read — a permissions failure on a
    // tree somebody else owns, or a file that vanished mid-run. Mocked rather
    // than acted out, because `chmod 000` proves nothing when the tests run as
    // root.
    const unreadable = path.join(dir, '01-intro/02-theory.md');
    const realRead = fs.readFileSync;
    mock.method(fs, 'readFileSync', (target, ...rest) => {
      if (target === unreadable) throw new Error('EACCES: permission denied');
      return realRead(target, ...rest);
    });

    const { embedded } = gatherLocal({ courseDir: dir, gitDirty: CLEAN });

    assert.equal(embedded.complete, false);
    assert.ok(
      embedded.refs.has('01-intro/_files/logo.png'),
      'the items that did read are still collected',
    );
  });

  it('says nothing is known when there is no course directory at all', () => {
    const { embedded } = gatherLocal({
      courseDir: path.join(os.tmpdir(), 'gather-test-nothing-here'),
      gitDirty: CLEAN,
    });

    // An empty set that called itself whole reads as "the course embeds
    // nothing", which is a licence to delete every file in the course.
    assert.equal(embedded.complete, false);
    assert.equal(embedded.refs.size, 0);
  });
});
