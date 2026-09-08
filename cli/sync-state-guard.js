const { loadState } = require('../lib/sync/state');

/**
 * Stop a command that would edit the wrong course's sync state, before it has
 * done anything.
 *
 * `assertStateMatchesEnv` in `lib/sync/state.js` is the refusal itself and says
 * why it exists. This is only the question of *when* it fires. Five commands
 * load the state up front and hit it there; the rest used to reach it through
 * `recordRenames` or `removeFromSyncState` (since removed), which run at the
 * end of the work rather than the start, so the refusal arrived after the
 * damage:
 *
 * - `merge-items` had already written the source's body into the target and
 *   still had the source on disk, leaving two copies of one item and no undo
 *   but git.
 * - `move-item` had already renumbered every file in the module.
 * - Worse than either, it was not even reliable. `recordRenames` returns before
 *   it loads anything when a batch renamed nothing, so a `move-item` that
 *   happened to shift no file succeeded against a mismatched state while the
 *   same command one position over refused. A guard that fires on some runs and
 *   not others teaches nobody anything.
 *
 * One `preAction` hook in `cli/index.js` asks the question for every command
 * instead, before the action runs. That does make a run that used to succeed
 * harmlessly — the `move-item` that renumbers nothing — refuse. It is the point:
 * whether the sync state describes this course does not depend on how many files
 * a command happens to touch.
 *
 * The hook is deliberately not the *only* check. `cli/delete-module.js` still
 * loads the state itself, because it needs the object anyway, and a command
 * called as a function rather than through the CLI — `cli/setup.js` invokes
 * `init` directly — never reaches a commander hook at all.
 */

/** Refuse this command when the sync state describes another Canvas course. */
const GUARD = 'guard';

/**
 * Opens a mismatched sync state on purpose, and must not be stopped. Neither of
 * these writes to Canvas: `init` is the command that repairs the mismatch, and
 * `export` reads the ids only to footnote cross-links, so which course `.env`
 * names is no business of its own. Both already pass `skipEnvCheck` to
 * `loadState`; this is the same exemption one layer up.
 */
const READS_ANY_COURSE = 'reads-any-course';

/**
 * Never opens the sync state, so there is nothing to guard and refusing would
 * be pure obstruction — most of these are local content tools that have to keep
 * working while the author sorts the mismatch out, and two of them are how the
 * author sorts it out. `reset-sync-state` is the remedy the refusal's own
 * message names: guarding it would leave the author in a loop, told to run the
 * one command that then refuses. `reset-canvas` deletes from the course `.env`
 * names and consults no local ids, and it is the natural next step for someone
 * who did mean to switch.
 */
const NEVER_OPENS = 'never-opens';

/**
 * What every registered command is, and why.
 *
 * Every name in `cli/index.js` appears here, and a test in
 * `test/cli/index.test.js` fails when one does not — which is what keeps this
 * from rotting into a list somebody forgot. An unclassified command is guarded
 * anyway, so the failure mode of ignoring that test is a loud refusal rather
 * than a silent hole: a new command that touches the sync state is protected on
 * the day it is written.
 *
 * The same split is documented for authors in `docs/troubleshooting.md`
 * under ".canvas-sync.json describes course N", which holds the one full
 * list; `docs/advanced-commands.md` links it instead of keeping a copy, and
 * `docs/new-academic-year.md` repeats just the two facts its rollover steps
 * turn on. `test/cli/sync-state-guard-docs.test.js` reads all three against
 * this table, so a command that changes class here fails a test until the
 * prose moves with it.
 */
const COMMAND_SYNC_STATE_POLICY = {
  // Reconcile against Canvas: the ids are the whole of what they act on.
  sync: GUARD,
  push: GUARD,
  pull: GUARD,
  status: GUARD,

  // Move or delete something the sync state has a row for, and record it.
  // `new-module` is in this group despite creating one: inserting at an
  // occupied position renumbers every module above it, and each of those
  // folders is a key.
  'new-module': GUARD,
  'delete-module': GUARD,
  'move-module': GUARD,
  'rename-module': GUARD,
  'new-item': GUARD,
  'move-item': GUARD,
  'movetomodule-item': GUARD,
  'rename-item': GUARD,
  'delete-item': GUARD,
  'merge-items': GUARD,
  'split-item': GUARD,

  init: READS_ANY_COURSE,
  export: READS_ANY_COURSE,

  setup: NEVER_OPENS,
  validate: NEVER_OPENS,
  search: NEVER_OPENS,
  'build-glossary': NEVER_OPENS,
  'check-links': NEVER_OPENS,
  'export-toc': NEVER_OPENS,
  'reset-sync-state': NEVER_OPENS,
  'reset-canvas': NEVER_OPENS,
};

/**
 * Whether this command has to agree with `.env` about which course it is.
 *
 * A name the table does not carry is guarded, so the answer to "somebody added
 * a command and forgot" is the safe one.
 *
 * @param {string} commandName - As `commander` reports it: `search`, not `search <keyword>`.
 * @returns {boolean}
 */
function requiresMatchingCourse(commandName) {
  return (COMMAND_SYNC_STATE_POLICY[commandName] || GUARD) === GUARD;
}

/**
 * Run the course-identity check for a command that needs it, and nothing else.
 *
 * `loadState` is what asks the question, so this inherits its answers exactly,
 * and only a file that parses and names a different course is a mismatch. A
 * project with no `.canvas-sync.json` is not one: the check sits past a missing
 * file, so it does not refuse. A file that is there and unreadable stops the
 * command all the same, one refusal earlier than this one and for its own
 * reason — see `loadState`. A file that names no course adopts the
 * environment's identity in memory only — nothing is written here, which
 * matters, because a hook that saved the file would be a write by the run that
 * is about to refuse.
 *
 * `allowNull` is belt and braces rather than the thing that spares an unsynced
 * project: it only decides whether a fabricated empty state comes back in place
 * of `null`, and neither answer is read. It is passed because inventing a state
 * for a caller that is about to discard it is the wrong shape, and last so a
 * caller cannot switch it off.
 *
 * @param {string} commandName
 * @param {object} [options]
 * @param {string} [options.file] - Injection point for tests, to `loadState`.
 * @param {object} [options.env]  - Injection point for tests, to `loadState`.
 * @throws {RefusalError} When the sync state describes another Canvas course —
 *   and, inherited from `loadState` rather than added here, when it was written
 *   by a schema this version does not read, or cannot be read at all. The
 *   command would have refused those anyway; this only moves them to the same
 *   place as the other.
 */
function guardCourseMatch(commandName, options = {}) {
  if (!requiresMatchingCourse(commandName)) return;
  loadState({ ...options, allowNull: true });
}

module.exports = {
  COMMAND_SYNC_STATE_POLICY,
  GUARD,
  NEVER_OPENS,
  READS_ANY_COURSE,
  guardCourseMatch,
  requiresMatchingCourse,
};
