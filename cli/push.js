const { listModules } = require('../lib/canvas/modules');
const { listPages } = require('../lib/canvas/pages');
const { listAssignments } = require('../lib/canvas/assignments');
const { plan } = require('../lib/sync/plan');
const { applyPlan } = require('../lib/sync/apply');
const {
  gatherCanvas,
  gatherLocal,
  gitDirtyPaths,
} = require('../lib/sync/gather');
const { loadState, saveState } = require('../lib/sync/state');
const {
  COURSE_DIR,
  createRL,
  prompt,
  resolveModuleFilter,
} = require('./module-utils');
const {
  BACKUP_HINT,
  confirmFirstPush,
  submissionRiskSuffix,
} = require('./backup-warning');
const { warnGradeImpact } = require('./grade-impact');
const { describeCanvasPrune } = require('./prune-warning');
const { buildReport, plural, printErrors } = require('./report');
const log = require('./logger');

/**
 * Push: `sync` with the direction pinned.
 *
 * The same four steps `cli/sync.js` takes — gather, plan, apply, report — over
 * the same engine, with one policy nothing can change:
 *
 *     { write: { canvas: true, local: false }, conflict: 'local',
 *       adopt: 'local' }
 *
 * Canvas is written and the working tree is not. A file that moved on both
 * sides is pushed rather than pulled. A Canvas object already sitting there
 * under the same type and title is claimed by the local file rather than
 * duplicated. None of that is lost when the policy forbids a write: the planner
 * records it in `withheld`, and the report names it.
 *
 * Everything that decides anything lives in `lib/sync/plan.js`, everything that
 * reads the world in `lib/sync/gather.js`, everything that writes in
 * `lib/sync/apply.js`. What is left here is the part that is genuinely push's:
 * the first-push confirmation, the warning that an assignment update moves
 * grades already in the gradebook, and the `--prune-canvas` confirmation. Each
 * of those runs **between plan and apply, over the plan**, which is what makes
 * them answerable without a network.
 *
 * A Canvas-only reorder is deliberately left alone. `policy.order` bites only
 * when both sides moved; when only Canvas moved the planner gives it to Canvas,
 * which under push is a local write, so it is withheld and reported. Old push
 * imposed the local order on every run because it rebuilt every item list, and
 * that silently reverted anyone who reordered a module in the Canvas UI.
 * Settling a contested order is `sync`'s job, so push takes no `--order` flag.
 *
 * What this tool sends Canvas per type is no longer here: the three content
 * strategies, `buildFileResolver`, `pushQuiz`, `pushExternalTool` and
 * `refuseQuizBackedDelete` live in `lib/sync/canvas-write.js`, where the engine
 * that calls them can reach them without requiring a command. Two warnings left
 * for the same reason: `sync` writes assignments and deletes Canvas objects
 * too, and has to say the same words about both, so the grade check lives in
 * `cli/grade-impact.js` and the prune listing in `cli/prune-warning.js`. What is
 * left here is the question itself, which is push's own.
 */

/**
 * @param {object} options - Commander's flags, plus four injection points for
 *   tests that commander never sets: `courseDir`, `syncFile`, `gitDirty` and
 *   `interactive`. A test needs its own tree, its own state file, a git answer
 *   that does not depend on the checkout it runs in, and a terminal it does
 *   not have.
 */
async function push(options = {}) {
  const courseId = process.env.CANVAS_COURSE_ID;
  if (!courseId) {
    log.error(
      '[push] Error: CANVAS_COURSE_ID is not set. Run "npx course init" first.',
    );
    process.exitCode = 1;
    return;
  }

  // Registered in `cli/index.js` only so the old spelling gets a pointer rather
  // than commander's bare "unknown option".
  if (options.prune === true) {
    log.error(
      '[push] Error: --prune is now --prune-canvas. Push writes to one side, ' +
        'so it prunes one side; `npx course sync --prune-local` is what ' +
        'deletes local files.',
    );
    process.exitCode = 1;
    return;
  }

  const dryRun = options.dryRun === true;
  const pruneCanvas = options.pruneCanvas === true;
  const courseDir = options.courseDir || COURSE_DIR;
  const syncFile = options.syncFile || undefined;
  const interactive =
    options.interactive !== undefined
      ? options.interactive === true
      : Boolean(process.stdin.isTTY);

  const state = loadState(syncFile ? { file: syncFile } : {});

  // One `git status` for the run, the same answer every other command asks
  // for. The guard it feeds stops a Canvas copy overwriting uncommitted work,
  // and push writes to no local file it could destroy — the planner knows that
  // on its own and withholds those writes rather than reporting them as
  // skipped. It is asked anyway because the tree is not untouched: the engine
  // writes `title:` into a file it creates the Canvas object from, and a
  // command that told the planner the tree was clean would be asserting
  // something it has not checked.
  const gitDirty = options.gitDirty || gitDirtyPaths({ courseDir });
  if (!gitDirty.available) {
    // `refusal` and not `warn`, for the reason sync and pull use it: this is
    // the same guard saying the same thing, and push is the direction where it
    // costs the most to miss — the run goes ahead and changes Canvas with no
    // undo behind it. See `cli/logger.js`.
    log.refusal(
      `[push] ${gitDirty.reason}. Git is the undo for everything this writes, ` +
        'so there is nothing to fall back on if a push goes wrong.',
    );
  }

  const local = gatherLocal({ courseDir, gitDirty });
  for (const warning of local.warnings) log.warn(`[push] ${warning}`);

  // Pushing from an empty tree is always a mistake rather than an instruction:
  // every item in the course would read as gone from here, and under
  // `--prune-canvas` that is the whole course. `reset-canvas` is the command
  // for emptying a Canvas course on purpose.
  if (local.modules.length === 0) {
    log.info('[push] No modules found in course/ directory.');
    return;
  }

  // Resolved against the state as well as the tree, so a number names a module
  // deleted here the way its full name does: as one push has no folder for.
  let modules;
  try {
    modules = resolveModuleFilter(options.module, { local, state });
  } catch (err) {
    log.error(`[push] Error: ${err.message}`);
    process.exitCode = 1;
    return;
  }
  if (modules) {
    const known = new Set(local.modules.map((mod) => mod.folder));
    const missing = modules.filter((name) => !known.has(name));
    if (missing.length > 0) {
      log.error(
        `[push] Error: no module folder named ${missing.join(', ')} under ` +
          'course/.',
      );
      process.exitCode = 1;
      return;
    }
  }

  // The first push to a course that already holds content is the moment this
  // tool starts managing something it did not create. Asked before Canvas is
  // read in full, so a cancelled run costs three list requests and nothing else
  // — and on a course this project already tracks it costs none.
  const proceed = await confirmFirstPush({
    courseId,
    syncData: state,
    dryRun,
    fetchCounts: async () => {
      const [remoteModules, pages, assignments] = await Promise.all([
        listModules(courseId),
        listPages(courseId),
        listAssignments(courseId),
      ]);
      return {
        modules: remoteModules.length,
        pages: pages.length,
        assignments: assignments.length,
        files: 0,
      };
    },
  });
  if (!proceed) {
    // Asked to push, pushed nothing. A caller that cannot see that from the
    // exit code reads a cancelled run as a completed one, and `push && deploy`
    // deploys. The answer's provenance makes no difference: a deliberate "n"
    // and a scripted run with no answer to give both leave the command having
    // not done the one thing it was told to do.
    process.exitCode = 1;
    return;
  }

  log.info(`[push] Reading Canvas course ${courseId}...`);
  const canvas = await gatherCanvas({ courseId, base: state });
  for (const warning of canvas.warnings) log.warn(`[push] ${warning}`);

  const policy = {
    write: { canvas: true, local: false },
    conflict: 'local',
    adopt: 'local',
    pruneCanvas,
    modules,
  };
  const inputs = { base: state, local, canvas };
  let report = plan({ ...inputs, policy });

  // Three of the fields an assignment update sends move grades that are already
  // in the gradebook, and the plan is what says which assignments this run
  // updates at all.
  await warnGradeImpact(courseId, report, { courseDir, tag: 'push' });

  // Whether this run is still one that prunes, which a declined confirmation
  // makes it not. The report reads the answer rather than the flag: "nothing
  // above was deleted; each line says why" is a claim about the plan, and after
  // a decline there is no plan behind it to say why.
  let pruning = pruneCanvas;
  if (pruneCanvas) {
    pruning = await confirmPrune(courseId, report, { interactive, dryRun });
    if (!pruning) {
      // Re-planned rather than filtered, so the report is built from a plan
      // that never held those deletes: the orphans go back to being listed as
      // orphans, with the flag's own line under them.
      report = plan({ ...inputs, policy: { ...policy, pruneCanvas: false } });
    }
  }

  let outcome = { applied: [], errors: [] };
  if (dryRun) {
    log.info('[push] DRY RUN — nothing was written.');
  } else if (report.actions.length > 0) {
    outcome = await applyPlan(report, {
      courseId,
      courseDir,
      state,
      canvasContent: canvas.content,
      save: (next) => saveState(next, syncFile),
      log,
    });
  } else {
    state.last_sync = new Date().toISOString();
    saveState(state, syncFile);
  }

  const lines = buildReport(report, {
    // A dry run executed nothing, so it gets no applied list and the report
    // reads as the preview it is. Every other run hands over what actually ran,
    // which for one the icon upload aborted is nothing.
    applied: dryRun ? undefined : outcome.applied,
    pruneCanvas: pruning,
    baseUrl: state.canvas_base_url,
    courseId,
  });
  if (lines.length > 0) {
    for (const line of lines) log.info(line);
  } else if (outcome.errors.length > 0) {
    // A bare report is not agreement: nothing got as far as being applied, and
    // the errors below are the whole account of this run.
    log.info('[push] Nothing was applied. See the errors below.');
  } else {
    log.info('[push] Canvas already holds everything in course/.');
  }

  printErrors(outcome.errors, { tag: 'push' });

  // A skip is a refusal push could not carry out, which under this policy means
  // a file whose `canvas_type` no longer matches the Canvas object it names.
  // Orphans and the informational sections do not fail the run: a course
  // mid-edit is a normal state.
  if (outcome.errors.length > 0 || report.skipped.length > 0) {
    process.exitCode = 1;
  }
}

/**
 * List what `--prune-canvas` is about to delete, name the student work behind
 * each item, and ask.
 *
 * Read off the plan's delete actions rather than off the sync state, so what is
 * listed is exactly what would run — including nothing, when the planner
 * declined to emit a delete it had a reason not to.
 *
 * A dry run deletes nothing, so it gets the listing and the warnings and no
 * question: hiding the deletes behind a prompt the run will never act on is the
 * opposite of what a preview is for.
 *
 * @returns {Promise<boolean>} Whether the deletes should stay in the plan.
 */
async function confirmPrune(courseId, report, { interactive, dryRun }) {
  const { count, risk } = await describeCanvasPrune(
    courseId,
    report.actions || [],
    { tag: 'push' },
  );
  if (count === 0) return true;

  if (dryRun) return true;

  if (!interactive) {
    log.warn(
      `[push] ${plural(count, 'thing')} would be deleted, and this run cannot ` +
        'ask. Nothing was pruned; run it in a terminal.',
    );
    return false;
  }

  log.info(`\n[push] ${BACKUP_HINT}`);
  const rl = createRL();
  const answer = await prompt(
    rl,
    `[push] Delete these from Canvas${submissionRiskSuffix(risk)}? (y/N)`,
  );
  rl.close();
  const ok = answer.trim().toLowerCase() === 'y';
  if (!ok) log.info('[push] Nothing was deleted.');
  return ok;
}

module.exports = push;
