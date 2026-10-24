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
const { BACKUP_DOC, confirmForcedPull } = require('./backup-warning');
const { describeLocalPrune } = require('./prune-warning');
const {
  buildReport,
  checkModuleFilter,
  plural,
  printErrors,
} = require('./report');
const log = require('./logger');

/**
 * Pull: `sync` with the direction pinned the other way from push.
 *
 * The same four steps `cli/sync.js` takes — gather, plan, apply, report — over
 * the same engine, with one policy nothing can change:
 *
 *     { write: { canvas: false, local: true }, conflict: 'canvas',
 *       adopt: 'canvas' }
 *
 * The working tree is written and Canvas is not. A file that changed on both
 * sides takes the Canvas version. A Canvas object already sitting there under
 * the same type and title is claimed by the local file that matches it rather
 * than written out a second time beside it. None of that is lost when the
 * policy forbids a write: the planner records it in `withheld`, and the report
 * names it.
 *
 * Everything that decides anything lives in `lib/sync/plan.js`, everything that
 * reads the world in `lib/sync/gather.js`, everything that writes in
 * `lib/sync/apply.js`. What is left here is the part that is genuinely pull's:
 * the `--force` confirmation and the `--prune-local` one, both of which run
 * **over the plan or over the working tree**, so neither needs a network.
 *
 * ## The mtime guard is gone, and `--force` means something else
 *
 * Old pull refused to write any file it could not prove was its own output,
 * judged by comparing the file's mtime against `last_sync` — a guess from the
 * shape of the file, which read "cannot tell" as "leave it alone" and so
 * skipped every file on a tree that had never synced. The planner asks the real
 * question instead: it compares each side against the fingerprint the last sync
 * recorded for it, so a file Canvas has not touched is not written, and one it
 * has is written without anybody having to guess.
 *
 * What is still load-bearing is git. `guardDirty` in the planner refuses to
 * write over — or delete — any file `git status` reports as modified or
 * untracked, because git is the only copy of whatever is in it. And
 * `gitDirtyPaths` answers `available: false` outside a git checkout or wherever
 * git cannot be run, at which point `gatherLocal` marks **every** file dirty and
 * a pull writes nothing at all. `--force` is the one lever that switches that
 * guard off, for overwrites and deletes alike. It is dangerous exactly in
 * proportion to how much work git has no copy of, so it asks first.
 *
 * ## A Canvas rename no longer renames the file
 *
 * Old pull derived the local filename from the Canvas title on every run, and
 * renamed the file when the title changed. The local path is the key of a sync
 * row now, so the title lands in the file's frontmatter and the filename stays
 * as the author left it. The numeric prefix still moves: that is the local
 * order, and a Canvas-side reorder is a `reorder-local-module`.
 *
 * ## Writing a Canvas object into the tree moved out
 *
 * `writeCategoryFile`, `downloadReferencedFiles` and `createPullFileResolver`
 * live in `lib/sync/local-write.js`, where the engine that calls them can reach
 * them without requiring a command. Nothing left in this file writes a Canvas
 * object out; what is left decides whether the run may.
 */

/**
 * @param {object} options - Commander's flags, plus four injection points for
 *   tests that commander never sets: `courseDir`, `syncFile`, `gitDirty` and
 *   `interactive`. A test needs its own tree, its own state file, a git answer
 *   that does not depend on the checkout it runs in, and a terminal it does
 *   not have.
 */
async function pull(options = {}) {
  const courseId = process.env.CANVAS_COURSE_ID;
  if (!courseId) {
    log.error(
      '[pull] Error: CANVAS_COURSE_ID is not set. Run "npx course init" first.',
    );
    process.exitCode = 1;
    return;
  }

  const dryRun = options.dryRun === true;
  const force = options.force === true;
  const pruneLocal = options.pruneLocal === true;
  const courseDir = options.courseDir || COURSE_DIR;
  const syncFile = options.syncFile || undefined;
  const interactive =
    options.interactive !== undefined
      ? options.interactive === true
      : Boolean(process.stdin.isTTY);

  const state = loadState(syncFile ? { file: syncFile } : {});

  // One `git status` for the run. Pull writes to the working tree and nowhere
  // else, so this is the guard that decides how much of it may be written at
  // all: a file git holds uncommitted work for is the only copy of that work.
  const gitDirty = options.gitDirty || gitDirtyPaths({ courseDir });
  if (!gitDirty.available) {
    // `refusal` and not `warn`, because this line is the reason the run does
    // less than it was asked to: without `--force` it is the whole explanation
    // for a pull that writes nothing. `--quiet` silences chatter, and gated
    // there this run was a silent non-zero exit. See `cli/logger.js`.
    log.refusal(
      `[pull] ${gitDirty.reason}. Every local file is treated as holding ` +
        'uncommitted work, so ' +
        (force
          ? '--force is the only reason this run writes anything at all.'
          : 'nothing here is overwritten or deleted; --force overrides that.'),
    );
  }

  const local = gatherLocal({ courseDir, gitDirty });
  for (const warning of local.warnings) log.warn(`[pull] ${warning}`);

  // Asked before Canvas is read, so a cancelled run costs no request at all:
  // what --force is about is the working tree, and the working tree is already
  // in hand. A course that turns out to hold no modules is the one case where
  // that means asking about a run with nothing to do, and a wasted question is
  // cheaper than a wasted course read.
  //
  // Counted from git's own answer, not from the scanned items. The items are
  // what `scanCourse` returns, and it never descends into a `_`-prefixed
  // folder, so a tree whose only uncommitted work is a `_files/` binary or a
  // `_category_.json` produced a count of zero and `--force` overrode every
  // guard without asking anything at all. `gitDirty.files` is the raw set git
  // named, without the ancestor directories `paths` adds — those are not files
  // and counting them would inflate the number the question quotes.
  //
  // The question this asks is not "which destinations will be written", which
  // is genuinely unknowable before Canvas answers. It is "is there uncommitted
  // work under `course/` that `--force` will override", and git answered that
  // in full above, before `gatherLocal` and before any request.
  //
  // **Where git could not answer, the items are still what is counted.** There
  // is no file set to read — `available: false` carries empty ones — so
  // counting them would be counting zero, and the question would vanish for
  // the run that most needs it: outside a checkout `--force` is the only reason
  // anything is written locally at all.
  const guarded = gitDirty.available
    ? gitDirty.files.size
    : local.modules.flatMap((module) => module.items).length;
  const proceed = await confirmForcedPull({
    force,
    guarded,
    gitReason: gitDirty.available ? null : gitDirty.reason,
    pruneLocal,
    dryRun,
  });
  if (!proceed) {
    // Asked to pull, pulled nothing. A caller that cannot see that from the
    // exit code reads a cancelled run as a completed one, and goes on to build
    // from a tree that was never updated. The answer's provenance makes no
    // difference: a deliberate "n" and a scripted run with no answer to give
    // both leave the command having not done the one thing it was told to do.
    process.exitCode = 1;
    return;
  }

  // The whole of what --force does. The planner reads `dirty` per item and
  // nothing else, so clearing it here is the flag, stated once, rather than a
  // second condition threaded through every guard the engine has.
  //
  // The executor needs the same answer said its own way. Its one guarded write
  // is the binary behind an embedded image, which lands in `_files/` — a folder
  // the scanner never descends into, so no item's `dirty` can speak for it and
  // the loop above cannot reach it. Handing the executor a clean git answer is
  // the same sentence as that loop: for the rest of this run, treat the tree as
  // holding nothing that needs protecting.
  let writeGuard = gitDirty;
  if (force) {
    for (const module of local.modules) {
      // The folder's own flag as well as its items'. It is what guards
      // `delete-local-module` against uncommitted work the scanner cannot see,
      // and `--force --prune-local` is exactly the run that is allowed to
      // delete such a folder anyway. Leave it set and the flag would half work:
      // files overwritten, folders spared.
      module.dirty = false;
      // And the module's `_category_.json`, which is its own flag because it is
      // its own write — the one `update-local-module` makes. Left set, a forced
      // pull would take the Canvas label everywhere except the file that holds
      // it.
      module.categoryDirty = false;
      for (const item of module.items) item.dirty = false;
    }
    writeGuard = {
      available: true,
      paths: new Set(),
      files: new Set(),
      reason: null,
    };
  }

  log.info(`[pull] Reading Canvas course ${courseId}...`);
  const canvas = await gatherCanvas({ courseId, base: state });
  for (const warning of canvas.warnings) log.warn(`[pull] ${warning}`);

  // Pulling from an empty course is always a mistake rather than an
  // instruction: every item in the tree would read as gone from Canvas, and
  // under `--prune-local` that is the whole course. The mirror of push refusing
  // to push from an empty tree.
  if (canvas.modules.length === 0) {
    log.info('[pull] No modules found in Canvas course.');
    return;
  }

  // Checked here rather than up front, because the folder a Canvas module will
  // be written into need not exist yet: `-m` may name one nothing but Canvas
  // has heard of. So the answer needs both sides and the state that links them,
  // and so does a number standing in for that name.
  let modules;
  try {
    modules = resolveModuleFilter(options.module, { local, state, canvas });
  } catch (err) {
    log.error(`[pull] Error: ${err.message}`);
    process.exitCode = 1;
    return;
  }
  if (!checkModuleFilter(modules, { local, canvas, state, tag: 'pull' })) {
    process.exitCode = 1;
    return;
  }

  const policy = {
    write: { canvas: false, local: true },
    conflict: 'canvas',
    adopt: 'canvas',
    pruneLocal,
    modules,
  };
  const inputs = { base: state, local, canvas };
  let report = plan({ ...inputs, policy });

  // Whether this run is still one that prunes, which a declined confirmation
  // makes it not. The report reads the answer rather than the flag: "nothing
  // above was deleted; each line says why" is a claim about the plan, and after
  // a decline there is no plan behind it to say why.
  let pruning = pruneLocal;
  if (pruneLocal) {
    pruning = await confirmPrune(report, { interactive, dryRun, force });
    if (!pruning) {
      // Re-planned rather than filtered, so the report is built from a plan
      // that never held those deletes: the orphans go back to being listed as
      // orphans, with the flag's own line under them.
      report = plan({ ...inputs, policy: { ...policy, pruneLocal: false } });
    }
  }

  let outcome = { applied: [], errors: [] };
  if (dryRun) {
    log.info('[pull] DRY RUN — nothing was written.');
  } else if (report.actions.length > 0) {
    outcome = await applyPlan(report, {
      courseId,
      courseDir,
      state,
      gitDirty: writeGuard,
      canvasContent: canvas.content,
      save: (next) => saveState(next, syncFile),
      log,
    });
    // A refusal the executor made belongs in the same section as the planner's,
    // and is read by the same two things below: the "Skipped" listing and the
    // exit code. Merged before the report is built, never after.
    report.skipped.push(...outcome.skipped);
  } else {
    state.last_sync = new Date().toISOString();
    saveState(state, syncFile);
  }

  const lines = buildReport(report, {
    // A dry run executed nothing, so it gets no applied list and the report
    // reads as the preview it is. Every other run hands over what actually ran.
    applied: dryRun ? undefined : outcome.applied,
    pruneLocal: pruning,
    baseUrl: state.canvas_base_url,
    courseId,
  });
  if (lines.length > 0) {
    for (const line of lines) log.info(line);
  } else if (outcome.errors.length > 0) {
    // A bare report is not agreement: nothing got as far as being applied, and
    // the errors below are the whole account of this run.
    log.info('[pull] Nothing was applied. See the errors below.');
  } else {
    log.info('[pull] course/ already holds everything in Canvas.');
  }

  printErrors(outcome.errors, { tag: 'pull' });

  // A skip is a refusal pull could not carry out, which under this policy means
  // a file holding uncommitted work that Canvas wanted to overwrite. Orphans
  // and the informational sections do not fail the run: a course mid-edit is a
  // normal state.
  if (outcome.errors.length > 0 || report.skipped.length > 0) {
    process.exitCode = 1;
  }
}

/**
 * List what `--prune-local` is about to delete, say what the undo is, and ask.
 *
 * The listing is `describeLocalPrune`, the same one `sync --prune-local`
 * prints: it is the same delete against the same working tree, and a listing
 * that differed between the two would be one the author could not rely on. It
 * reads the plan's delete actions rather than the tree, so what is listed is
 * exactly what would run — including nothing, when the planner declined to emit
 * a delete it had a reason not to.
 *
 * What is pull's own is the question and the sentence above it. `--force` is
 * pull's flag, and it changes what saying yes costs, which is not something a
 * listing shared with `sync` should have to know about.
 *
 * A dry run deletes nothing, so it gets the listing and no question: hiding the
 * deletes behind a prompt the run will never act on is the opposite of what a
 * preview is for.
 *
 * @returns {Promise<boolean>} Whether the deletes should stay in the plan.
 */
async function confirmPrune(report, { interactive, dryRun, force }) {
  const { count } = describeLocalPrune(report.actions || [], { tag: 'pull' });
  if (count === 0) return true;

  if (dryRun) return true;

  if (!interactive) {
    log.warn(
      `[pull] ${plural(count, 'thing')} would be deleted, and this run cannot ` +
        'ask. Nothing was pruned; run it in a terminal.',
    );
    return false;
  }

  // What the undo is, and it is not the same sentence in both cases. Without
  // --force nothing dirty ever reaches this list, so everything on it is
  // committed and git has all of it; with --force the guard that guaranteed
  // that is off, whether or not it was holding anything back this run.
  log.info(
    force
      ? '\n[pull] --force is on, so the git guard is not standing between ' +
          'these files and their deletion. Anything among them git has no ' +
          `copy of is gone for good. See ${BACKUP_DOC}.`
      : '\n[pull] Nothing above holds uncommitted work — the git guard keeps ' +
          `those out of the list — so git brings all of it back. See ${BACKUP_DOC}.`,
  );
  const rl = createRL();
  const answer = await prompt(rl, '[pull] Delete these from course/? (y/N)');
  rl.close();
  const ok = answer.trim().toLowerCase() === 'y';
  if (!ok) log.info('[pull] Nothing was deleted.');
  return ok;
}

module.exports = pull;
