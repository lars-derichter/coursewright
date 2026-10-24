const { plan } = require('../lib/sync/plan');
const {
  gatherCanvas,
  gatherLocal,
  gitDirtyPaths,
} = require('../lib/sync/gather');
const { loadState } = require('../lib/sync/state');
const { COURSE_DIR, resolveModuleFilter } = require('./module-utils');
const { buildReport, checkModuleFilter } = require('./report');
const log = require('./logger');

/**
 * Status: `sync`, up to the point where it would write.
 *
 * The same steps `cli/sync.js` takes — gather, plan, report — over the same
 * engine, with one policy nothing can change:
 *
 *     { write: { canvas: false, local: false }, conflict: 'newest',
 *       adopt: null }
 *
 * Neither side is written. Both flags off is what makes this a preview of
 * `sync` rather than of push or pull: no direction is pinned, so the planner
 * decides each item the way a plain `sync` would, and every write it may not
 * make lands in `withheld`, which the report prints under "Left alone".
 *
 * `buildReport` does the rest. Handed no `applied` list it renders the plan as
 * a preview rather than as a record of what ran, which is the same shape
 * `--dry-run` gets. One consequence worth knowing: under a policy that writes
 * to neither side every action is withheld, so nothing ever reaches "Would
 * apply" and the writes a real sync would make are read off "Left alone", one
 * line per side.
 *
 * ## mtime is gone as a change signal
 *
 * Old status called a file modified when its mtime was later than `last_sync`.
 * A `git clone` stamps every file with the checkout time, so a fresh clone
 * reported the entire course as modified — a report that cries wolf on every
 * file is a report nobody reads. The planner compares each side against the
 * fingerprint the last sync recorded for it instead, so a clone reports
 * nothing and an edited file reports itself.
 *
 * Old `--remote` had the same trouble one layer up: it rebuilt a set of Canvas
 * ids by hand and called anything missing from it "CANVAS-ONLY", which was
 * systematically wrong for pages, whose local id is the numeric `page_id` while
 * the module item exposes only the slug. Matching the two sides is the
 * planner's job and it does it against a base.
 *
 * ## There is no offline status any more
 *
 * "What would a sync do" cannot be answered without knowing what Canvas holds,
 * so the flag that used to gate the Canvas read has nothing left to gate and is
 * gone. Both ways of not reaching Canvas — no `CANVAS_COURSE_ID`, or a course
 * that will not answer — end the run with an error that says why the command
 * needs it, rather than with a partial report built from half the facts.
 *
 * ## What the exit code means
 *
 * Zero for a course mid-edit, whatever is waiting in it: both sides holding
 * work is the normal state, and a report that fails the run for being
 * interesting is one nobody can put in a script. Non-zero for the two things
 * that are not that. One is status not answering at all — no course id, a
 * course it cannot read, a `-m` naming nothing. The other is a course a `sync`
 * would refuse rather than work through: a collision, or two Canvas modules
 * deriving one folder name. Neither clears by syncing, both need a person, and
 * a refusal fails the run everywhere else in this tool — `sync --dry-run` over
 * either course exits non-zero too.
 *
 * @param {object} options - Commander's flags, plus three injection points for
 *   tests that commander never sets: `courseDir`, `syncFile` and `gitDirty`. A
 *   test needs its own tree, its own state file, and a git answer that does not
 *   depend on the checkout it runs in.
 */
async function status(options = {}) {
  const courseId = process.env.CANVAS_COURSE_ID;
  if (!courseId) {
    log.error(
      '[status] Error: CANVAS_COURSE_ID is not set. Status reports what a ' +
        'sync would do, so it has to read the Canvas course. Run ' +
        '"npx course init" first.',
    );
    process.exitCode = 1;
    return;
  }

  const courseDir = options.courseDir || COURSE_DIR;
  const syncFile = options.syncFile || undefined;

  // Loading the state is also what refuses a clone pointed at somebody else's
  // Canvas course, the same refusal the other three commands get from the same
  // call. A preview of a sync into the wrong course is worth refusing too.
  const state = loadState(syncFile ? { file: syncFile } : {});

  // Asked for the reason push asks: the answer feeds `gatherLocal`, and a
  // command that told the planner the tree was clean would be asserting
  // something it has not checked. It comes with no warning of its own, because
  // the guard it feeds protects the working tree from a write and this command
  // makes none.
  const gitDirty = options.gitDirty || gitDirtyPaths({ courseDir });

  const local = gatherLocal({ courseDir, gitDirty });
  for (const warning of local.warnings) log.warn(`[status] ${warning}`);

  log.info(`[status] Reading Canvas course ${courseId}...`);
  let canvas;
  try {
    canvas = await gatherCanvas({ courseId, base: state });
  } catch (err) {
    log.error(
      `[status] Error: could not read Canvas course ${courseId} ` +
        `(${err.message}). Status reports what a sync would do, which it ` +
        'cannot work out from the local side alone.',
    );
    process.exitCode = 1;
    return;
  }
  for (const warning of canvas.warnings) log.warn(`[status] ${warning}`);

  // Checked once both sides are in hand, for pull's reason: a module `-m` names
  // may exist only in Canvas, and previewing what a sync would do with it is
  // exactly the kind of question worth scoping.
  let modules;
  try {
    modules = resolveModuleFilter(options.module, { local, state, canvas });
  } catch (err) {
    log.error(`[status] Error: ${err.message}`);
    process.exitCode = 1;
    return;
  }
  if (!checkModuleFilter(modules, { local, canvas, state, tag: 'status' })) {
    process.exitCode = 1;
    return;
  }

  const report = plan({
    base: state,
    local,
    canvas,
    policy: {
      write: { canvas: false, local: false },
      // What a plain `sync` resolves a two-sided change by. `ask` would be the
      // other candidate and it is the wrong one: a preview is permanently
      // non-interactive, so it would preview a question instead of an answer.
      // The winner still cannot be written here, so it surfaces under
      // "Skipped" naming the side that would win and the command that settles
      // it.
      conflict: 'newest',
      // Nothing is adopted, deliberately. Adoption is what lets a pinned run
      // claim a Canvas object that already exists; taking it here would hide
      // the collision refusal a real `sync` would hit, which is the one thing
      // an author most needs a preview to show them.
      adopt: null,
      modules,
      // `order` is deliberately absent. The planner's default is `skip`,
      // because a caller that has not said it can ask cannot, and this one
      // never can: a contested order is reported and left alone.
    },
  });

  // No `applied`, so the report renders the plan as the preview it is.
  const lines = buildReport(report, {
    baseUrl: state.canvas_base_url,
    courseId,
  });
  if (lines.length === 0) {
    log.info('[status] Nothing to do: course/ and the Canvas course agree.');
    return;
  }

  // Whose plan this is, and who did not carry it out. Without it, "Left alone"
  // over a list of writes reads as sync's verdict rather than as status's.
  log.info('[status] What `npx course sync` would do. Status wrote nothing.');
  for (const line of lines) log.info(line);

  // Two kinds of skip reach this, and both on purpose: a Canvas module whose
  // derived folder another module has already taken (`writesNothing` in
  // `lib/sync/plan.js`), and a module whose items Canvas would not list
  // (`canvas-unreadable`, recorded unconditionally). Every other entry in
  // `skipped` is gated on the write landing, and under this policy no write
  // lands, so none of those can. The difference is what the refusal is about.
  // The rest protect a write this command does not make; these two describe
  // the Canvas course itself — two modules deriving one folder name, or a
  // module this run could not read — which is a state a sync refuses rather
  // than works through, until somebody renames a module or Canvas answers.
  // `sync` exits 1 over either and so does `sync --dry-run`, and a preview
  // that exited 0 on a course its own subject refuses would be answering a
  // different question than the one it advertises.
  if (report.skipped.length > 0 || report.collision) process.exitCode = 1;
}

module.exports = status;
