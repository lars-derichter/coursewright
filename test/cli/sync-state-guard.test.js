const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  COMMAND_SYNC_STATE_POLICY,
  GUARD,
  NEVER_OPENS,
  READS_ANY_COURSE,
  guardCourseMatch,
  requiresMatchingCourse,
} = require('../../cli/sync-state-guard');
const { RefusalError } = require('../../lib/errors');
const { SCHEMA_VERSION } = require('../../lib/sync/state');

const CLI = path.join(__dirname, '..', '..', 'cli', 'index.js');
const CANVAS_URL = 'https://canvas.example.com';
const STATE_COURSE = 45083;
const ENV_COURSE = '58155';

const made = [];

afterEach(() => {
  while (made.length) fs.rmSync(made.pop(), { recursive: true, force: true });
});

/**
 * A throwaway project with two items in one module, and a sync state describing
 * a course `.env` does not name. `{ synced: false }` leaves the sync state out
 * altogether.
 *
 * Out of the repository and run as a child, for the reason
 * `test/cli/delete-module.test.js` gives: `COURSE_DIR` and `SYNC_FILE` are
 * module-level constants resolved from `process.cwd()` at require time, so a run
 * in this process would edit the repository's own course.
 */
function project({ synced = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-'));
  made.push(dir);
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    '{ "name": "fixture", "private": true }\n',
    'utf8',
  );
  fs.mkdirSync(path.join(dir, 'course', '01-intro'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'course', '01-intro', '01-welcome.md'),
    '---\ntitle: Welcome\n---\n\nWelcome body\n',
    'utf8',
  );
  fs.writeFileSync(
    path.join(dir, 'course', '01-intro', '02-second.md'),
    '---\ntitle: Second\n---\n\nSecond body\n',
    'utf8',
  );
  if (!synced) return dir;

  fs.writeFileSync(
    path.join(dir, '.canvas-sync.json'),
    JSON.stringify(
      {
        schema_version: SCHEMA_VERSION,
        canvas_base_url: CANVAS_URL,
        course_id: STATE_COURSE,
        last_sync: null,
        modules: {
          '01-intro': {
            canvas_module_id: 67890,
            name: 'Intro',
            position: 1,
            item_order: ['01-intro/01-welcome.md', '01-intro/02-second.md'],
            items: {
              '01-intro/01-welcome.md': { canvas_type: 'page', canvas_id: 1 },
              '01-intro/02-second.md': { canvas_type: 'page', canvas_id: 2 },
            },
          },
        },
        icons: {},
        files: {},
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );
  return dir;
}

/** Run the CLI in `dir` against an environment that names another course. */
function run(dir, args, input = '') {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: dir,
    input,
    encoding: 'utf8',
    // Every guarded run below refuses before it asks anything. The timeout is
    // what turns a regression in that into a failure rather than a hung suite.
    timeout: 30000,
    env: {
      ...process.env,
      CANVAS_API_URL: CANVAS_URL,
      CANVAS_COURSE_ID: ENV_COURSE,
    },
  });
}

/** The names of every file in the module, sorted. */
function items(dir) {
  return fs.readdirSync(path.join(dir, 'course', '01-intro')).sort();
}

describe('the course-mismatch guard, before anything is written', () => {
  it('stops merge-items before it has merged anything', () => {
    // The worst of the nine. `_mergeFiles` wrote the source's body into the
    // target and only then called `removeFromSyncState`, so the refusal landed
    // with the target holding both bodies and the source still on disk — one
    // item duplicated into another, and nothing said which half to undo.
    const dir = project();
    const target = path.join(dir, 'course', '01-intro', '01-welcome.md');
    const before = fs.readFileSync(target, 'utf8');

    const result = run(dir, [
      'merge-items',
      '--source',
      'course/01-intro/02-second.md',
      '--target',
      'course/01-intro/01-welcome.md',
    ]);

    assert.notEqual(result.status, 0, 'a refused run must not report success');
    assert.match(result.stderr, /describes course 45083/);
    assert.equal(
      fs.readFileSync(target, 'utf8'),
      before,
      'the target must not be holding the source body after a refusal',
    );
    assert.deepEqual(
      items(dir),
      ['01-welcome.md', '02-second.md'],
      'and the source must still be there',
    );
  });

  it('stops move-item before it has renumbered the module', () => {
    const dir = project();

    const result = run(dir, [
      'move-item',
      '--path',
      'course/01-intro/01-welcome.md',
      '--position',
      '2',
    ]);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /describes course 45083/);
    assert.deepEqual(
      items(dir),
      ['01-welcome.md', '02-second.md'],
      'the renumber has to be the thing that did not happen',
    );
  });

  it('stops new-module before it renumbers the modules above it', () => {
    // The command that reaches the sync state without looking like it does.
    // Inserting at an occupied position shifts every module above it up one,
    // and each of those folders is a key in the sync state. Unguarded, the
    // renumber ran, `recordRenames` refused on the way out, and the module the
    // author asked for was never created: a course renumbered for an insert
    // that did not happen. The same half-done state the two above describe.
    const dir = project();

    const result = run(dir, [
      'new-module',
      '--name',
      'Kickoff',
      '--position',
      '1',
    ]);

    assert.notEqual(result.status, 0, 'a refused run must not report success');
    assert.match(result.stderr, /describes course 45083/);
    assert.deepEqual(
      fs.readdirSync(path.join(dir, 'course')),
      ['01-intro'],
      'the renumber has to be the thing that did not happen',
    );
  });

  it('refuses a run that would have renamed nothing, too', () => {
    // The intermittency this replaced. `recordRenames` returns before it loads
    // the state when a batch is empty, so moving an item to the position it is
    // already at never reached the refusal and reported success, while the same
    // command one position over refused. Whether the sync state describes this
    // course cannot depend on how many files a command happens to shift.
    const dir = project();

    const result = run(dir, [
      'move-item',
      '--path',
      'course/01-intro/01-welcome.md',
      '--position',
      '1',
    ]);

    assert.notEqual(
      result.status,
      0,
      'a guard that fires on some runs and not others teaches nobody anything',
    );
    assert.match(result.stderr, /describes course 45083/);
    assert.doesNotMatch(
      result.stdout,
      /already at that position/,
      'and it refuses instead of the command, not after it',
    );
  });
});

describe('the course-mismatch guard, on what it must let through', () => {
  it('leaves a command that never opens the sync state alone', () => {
    // The fence. A guard that refused everything would pass every test above,
    // and make the tool unusable for local work until the mismatch was sorted
    // out — which is exactly when an author is reading their own course.
    const dir = project();

    const result = run(dir, ['search', 'Welcome']);

    assert.equal(result.status, 0, 'searching the markdown touches no ids');
    assert.match(result.stdout, /01-welcome\.md/);
    assert.doesNotMatch(result.stderr, /describes course 45083/);
  });

  it('leaves the way out of the mismatch open', () => {
    // The refusal's own message says to run `reset-sync-state`. Guarding that
    // would close the loop it opens: told to run one command, refused by it.
    const dir = project();

    const result = run(dir, ['reset-sync-state'], 'y\n');

    assert.equal(result.status, 0);
    assert.doesNotMatch(result.stderr, /describes course 45083/);
    assert.equal(
      fs.existsSync(path.join(dir, '.canvas-sync.json')),
      false,
      'the command whose whole job is deleting that file has to delete it',
    );
  });

  it('does not read a project with no sync state as a mismatch', () => {
    // Nothing to disagree with. A course that has never been pushed has no
    // `.canvas-sync.json`, and every guarded command has to work there — it is
    // where every course starts.
    const dir = project({ synced: false });

    const result = run(dir, [
      'move-item',
      '--path',
      'course/01-intro/01-welcome.md',
      '--position',
      '2',
    ]);

    assert.equal(result.status, 0);
    assert.deepEqual(items(dir), ['01-second.md', '02-welcome.md']);
  });
});

describe('guardCourseMatch', () => {
  /** A sync state file naming `course_id`, outside the repository. */
  function stateFile(courseId) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-unit-'));
    made.push(dir);
    const file = path.join(dir, '.canvas-sync.json');
    fs.writeFileSync(
      file,
      JSON.stringify({
        schema_version: SCHEMA_VERSION,
        canvas_base_url: CANVAS_URL,
        course_id: courseId,
        modules: {},
        icons: {},
        files: {},
      }),
      'utf8',
    );
    return file;
  }

  const env = { CANVAS_API_URL: CANVAS_URL, CANVAS_COURSE_ID: ENV_COURSE };

  it('refuses a guarded command with a RefusalError', () => {
    // The class is what gets the three-paragraph message printed as itself
    // rather than under a stack trace; see `lib/errors.js`.
    assert.throws(
      () => guardCourseMatch('push', { file: stateFile(STATE_COURSE), env }),
      (err) =>
        err instanceof RefusalError && /describes course 45083/.test(err),
    );
  });

  it('lets an exempt command past the same file', () => {
    const file = stateFile(STATE_COURSE);
    assert.doesNotThrow(() => guardCourseMatch('init', { file, env }));
    assert.doesNotThrow(() => guardCourseMatch('export', { file, env }));
    assert.doesNotThrow(() =>
      guardCourseMatch('reset-sync-state', { file, env }),
    );
  });

  it('writes nothing', () => {
    // The hook runs before the command it guards, so a save here would be a
    // write by the run that is about to refuse.
    const file = stateFile(STATE_COURSE);
    const before = fs.readFileSync(file, 'utf8');
    assert.throws(() => guardCourseMatch('push', { file, env }));
    assert.equal(fs.readFileSync(file, 'utf8'), before);
    assert.equal(fs.existsSync(file + '.tmp'), false);
  });

  it('guards a command the table has never heard of', () => {
    // The safe default. A command added without a line in the table refuses
    // loudly rather than editing another course's ids in silence.
    assert.equal(requiresMatchingCourse('some-future-command'), true);
  });
});

describe('the command-to-policy table', () => {
  it('agrees with what the docs promise authors', () => {
    // `docs/troubleshooting.md` and `docs/advanced-commands.md` both list these
    // by name. Two prose copies and one table drift the moment nothing checks.
    const named = (policy) =>
      Object.entries(COMMAND_SYNC_STATE_POLICY)
        .filter(([, value]) => value === policy)
        .map(([name]) => name)
        .sort();

    assert.deepEqual(named(READS_ANY_COURSE), ['export', 'init']);
    assert.deepEqual(named(NEVER_OPENS), [
      'build-glossary',
      'check-links',
      'export-toc',
      'reset-canvas',
      'reset-sync-state',
      'search',
      'setup',
      'validate',
    ]);
    assert.deepEqual(named(GUARD), [
      'delete-item',
      'delete-module',
      'merge-items',
      'move-item',
      'move-module',
      'movetomodule-item',
      'new-item',
      'new-module',
      'pull',
      'push',
      'rename-item',
      'rename-module',
      'split-item',
      'status',
      'sync',
    ]);
  });
});
