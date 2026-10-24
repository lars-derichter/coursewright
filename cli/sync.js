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
const { BACKUP_HINT, submissionRiskSuffix } = require('./backup-warning');
const { warnGradeImpact } = require('./grade-impact');
const { describeCanvasPrune, describeLocalPrune } = require('./prune-warning');
const {
  buildReport,
  checkModuleFilter,
  plural,
  printErrors,
  stamp,
} = require('./report');
const log = require('./logger');

/**
 * Two-way sync: newest wins, nothing is deleted unless asked.
 *
 * The command is deliberately thin. Everything that decides anything lives in
 * `lib/sync/plan.js`, everything that reads the world lives in
 * `lib/sync/gather.js`, and everything that writes lives in
 * `lib/sync/apply.js`. What is left here is policy — the flags and the
 * questions — which is exactly the part that differs between `sync`, `push`,
 * `pull` and `status`. The report is the part that must not differ between
 * them, so it lives in `cli/report.js`, which all four import.
 *
 * **Prompts re-plan; they never patch.** When the planner cannot decide
 * something on its own it says so in `pending` and emits no action for it. This
 * asks the author, then calls `plan()` a second time with the answers in
 * `policy.resolved`. Nothing is fetched again, so the second pass is free, and
 * it keeps the planner a pure function of its inputs rather than something that
 * blocks on a terminal halfway through. It also means an answer is applied to
 * the same course it was asked about.
 */

const CONFLICT_POLICIES = ['newest', 'local', 'canvas', 'ask'];
const ORDER_POLICIES = ['local', 'canvas', 'ask'];

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

/** Ask one multiple-choice question, defaulting to the safe answer. */
async function ask(rl, question, choices, fallback) {
  const answer = (await prompt(rl, `${question} [${choices.join('/')}]`))
    .trim()
    .toLowerCase();
  return choices.includes(answer) ? answer : fallback;
}

/**
 * Put every question the plan raised to the author, and hand the answers back
 * for a second planning pass.
 *
 * Non-interactively the answers are the ones that change nothing: a conflict is
 * skipped and reported, an ordering question is left alone and reported. Both
 * end up in the report with a remedy, which is the point — a silent skip would
 * be worse than either wrong answer.
 *
 * @returns {object|null} `policy.resolved`, or null when there was nothing to
 *   ask, in which case the caller keeps its first plan.
 */
async function askPending(report, { interactive }) {
  const pending = report.pending;
  const count =
    pending.conflicts.length + pending.order.length + pending.renames.length;
  if (count === 0) return null;

  const resolved = { conflicts: {}, order: {}, renames: {} };

  if (!interactive) {
    for (const conflict of pending.conflicts) {
      resolved.conflicts[conflict.itemPath || conflict.moduleFolder] = 'skip';
    }
    for (const entry of pending.order) resolved.order[entry.folder] = 'skip';
    // A rename left unanswered keeps both paths out of the truth table, which
    // is the only answer that neither deletes the Canvas object nor creates a
    // second copy of it. It is reported instead.
    return resolved;
  }

  const rl = createRL();
  try {
    for (const conflict of pending.conflicts) {
      const key = conflict.itemPath || conflict.moduleFolder;
      log.info(`\n[sync] Both sides of ${key} changed since the last sync.`);
      if (conflict.kind === 'item') {
        log.info(`[sync]   here:   ${stamp(conflict.localMtimeMs)}`);
        log.info(`[sync]   Canvas: ${stamp(conflict.canvasUpdatedAt)}`);
      } else {
        log.info(`[sync]   here:   "${conflict.localName}"`);
        log.info(`[sync]   Canvas: "${conflict.canvasName}"`);
      }
      resolved.conflicts[key] = await ask(
        rl,
        '[sync] Which one wins?',
        ['local', 'canvas', 'skip'],
        'skip',
      );
    }

    for (const entry of pending.order) {
      log.info(`\n[sync] ${entry.folder} was reordered on both sides.`);
      log.info(`[sync]   here:   ${entry.local.join(' → ')}`);
      log.info(`[sync]   Canvas: ${entry.canvas.join(' → ')}`);
      resolved.order[entry.folder] = await ask(
        rl,
        '[sync] Which order wins?',
        ['local', 'canvas', 'skip'],
        'skip',
      );
    }

    for (const rename of pending.renames) {
      log.info(
        `\n[sync] ${rename.from} is gone and ${rename.to} is new, with the ` +
          'same title in the same folder.',
      );
      const answer = await ask(
        rl,
        '[sync] Is that the same item, renamed?',
        ['y', 'n'],
        'n',
      );
      resolved.renames[rename.from] = answer === 'y' ? rename.to : false;
    }
  } finally {
    rl.close();
  }

  return resolved;
}

/**
 * List what a prune is about to delete on each side, name the student work
 * behind the Canvas half of it, and ask.
 *
 * Sync is the only command that prunes both ways, so it is the only one that
 * lists both. The Canvas listing is the same one `push --prune-canvas` prints,
 * from the same module: it is the same delete against the same course, and a
 * warning that differed between the two would be a warning the author could not
 * rely on. Only the Canvas side carries a submission risk — deleting a local
 * file costs whatever git has no copy of, which is a different sentence, and
 * the git guard has already kept anything uncommitted out of the plan.
 *
 * The listing runs before every early return, so a run that will not ask still
 * says what it found: a dry run, `--yes`, and a run with no terminal all print
 * it. A preview drops the orphans a plan means to prune out of the report,
 * which used to leave `--dry-run` with the count as its whole account.
 *
 * @returns {Promise<boolean>} Whether the deletes should stay in the plan.
 */
async function confirmPrune(courseId, report, { interactive, yes, dryRun }) {
  const actions = report.actions || [];
  const doomed = actions.filter((action) =>
    action.type.startsWith('delete-'),
  ).length;
  if (doomed === 0) return true;

  const { risk } = await describeCanvasPrune(courseId, actions, {
    tag: 'sync',
  });
  describeLocalPrune(actions, { tag: 'sync' });

  if (dryRun) return true;
  if (yes) return true;
  if (!interactive) {
    log.warn(
      `[sync] ${plural(doomed, 'thing')} would be deleted, and this run cannot ` +
        'ask. Nothing was pruned; run it in a terminal, or pass --yes.',
    );
    return false;
  }

  log.info(`\n[sync] ${BACKUP_HINT}`);
  const rl = createRL();
  const answer = await prompt(
    rl,
    `[sync] Delete them${submissionRiskSuffix(risk)}? (y/N)`,
  );
  rl.close();
  const ok = answer.trim().toLowerCase() === 'y';
  if (!ok) log.info('[sync] Nothing was deleted.');
  return ok;
}

// ---------------------------------------------------------------------------
// The command
// ---------------------------------------------------------------------------

/** Refuse a misspelled policy rather than falling back to one nobody asked for. */
function checkPolicy(name, value, allowed) {
  if (allowed.includes(value)) return true;
  log.error(
    `[sync] Error: --${name} ${value} is not one of ${allowed.join(', ')}.`,
  );
  return false;
}

/**
 * @param {object} options - Commander's flags, plus four injection points for
 *   tests that commander never sets: `courseDir`, `syncFile`, `gitDirty` and
 *   `interactive`. A test needs its own tree, its own state file, a git answer
 *   that does not depend on the checkout it runs in, and a terminal it does not
 *   have.
 */
async function sync(options = {}) {
  const courseId = process.env.CANVAS_COURSE_ID;
  if (!courseId) {
    log.error(
      '[sync] Error: CANVAS_COURSE_ID is not set. Run "npx course init" first.',
    );
    process.exitCode = 1;
    return;
  }

  const conflict = options.conflict || 'newest';
  const order = options.order || 'ask';
  if (
    !checkPolicy('conflict', conflict, CONFLICT_POLICIES) ||
    !checkPolicy('order', order, ORDER_POLICIES)
  ) {
    process.exitCode = 1;
    return;
  }

  const dryRun = options.dryRun === true;
  const yes = options.yes === true;
  const interactive =
    options.interactive !== undefined
      ? options.interactive === true
      : Boolean(process.stdin.isTTY) && !yes;
  const wantsPruneCanvas =
    options.prune === true || options.pruneCanvas === true;
  const wantsPruneLocal = options.prune === true || options.pruneLocal === true;
  const courseDir = options.courseDir || COURSE_DIR;
  const syncFile = options.syncFile || undefined;

  const state = loadState(syncFile ? { file: syncFile } : {});

  // One `git status` for the run. A file with uncommitted changes cannot be
  // overwritten by Canvas winning, because git is the undo for this whole
  // system — and outside a repository nothing can be proved safe, so nothing
  // local is written at all.
  const gitDirty = options.gitDirty || gitDirtyPaths({ courseDir });
  if (!gitDirty.available) {
    // `refusal` and not `warn`: this is the reason the local half of the run
    // did nothing, and `--quiet` must not take the reason away with the
    // chatter. See `cli/logger.js`.
    log.refusal(
      `[sync] ${gitDirty.reason}. Every local file is treated as holding ` +
        'uncommitted work, so nothing here is overwritten or deleted this run.',
    );
  }

  const local = gatherLocal({ courseDir, gitDirty });
  for (const warning of local.warnings) log.warn(`[sync] ${warning}`);

  log.info(`[sync] Reading Canvas course ${courseId}...`);
  const canvas = await gatherCanvas({ courseId, base: state });
  for (const warning of canvas.warnings) log.warn(`[sync] ${warning}`);

  // Checked once both sides are in hand, because sync writes both ways: `-m`
  // may name a module that exists only in Canvas and that this very run is
  // about to write here for the first time. A number is resolved against the
  // same three sides, and only a name nothing answers to reaches the check.
  let modules;
  try {
    modules = resolveModuleFilter(options.module, { local, state, canvas });
  } catch (err) {
    log.error(`[sync] Error: ${err.message}`);
    process.exitCode = 1;
    return;
  }
  if (!checkModuleFilter(modules, { local, canvas, state, tag: 'sync' })) {
    process.exitCode = 1;
    return;
  }

  const policy = {
    write: { canvas: true, local: true },
    conflict,
    order,
    pruneCanvas: wantsPruneCanvas,
    pruneLocal: wantsPruneLocal,
    modules,
  };
  const inputs = { base: state, local, canvas };
  let report = plan({ ...inputs, policy });

  // Answers go back through the planner rather than being patched into the
  // plan: nothing was refetched, so the second pass costs nothing and stays a
  // pure function of the same three inputs.
  const resolved = await askPending(report, { interactive });
  if (resolved) report = plan({ ...inputs, policy: { ...policy, resolved } });

  // Three of the fields an assignment update sends move grades that are already
  // in the gradebook, and the plan is what says which assignments this run
  // updates at all. Asked after the questions rather than before them, because
  // a conflict the author gave to Canvas is a local edit that never reaches the
  // assignment — warning about it off the first plan would name a change this
  // run has just decided not to make.
  await warnGradeImpact(courseId, report, { courseDir, tag: 'sync' });

  // Whether this run is still one that prunes, which a declined confirmation
  // makes it not. The report reads the answer rather than the flag: "nothing
  // above was deleted; each line says why" is a claim about the plan, and after
  // a decline there is no plan behind it to say why — the planner emitted no
  // delete, so no orphan carries a reason and every line would be silent.
  let pruningCanvas = wantsPruneCanvas;
  let pruningLocal = wantsPruneLocal;

  // A dry run deletes nothing, so it gets the listing and the warnings and no
  // question: hiding the deletes behind a prompt the run will never act on is
  // the opposite of what a preview is for. `confirmPrune` draws that line
  // itself, so the flags alone decide whether it runs.
  if (wantsPruneCanvas || wantsPruneLocal) {
    const ok = await confirmPrune(courseId, report, {
      interactive,
      yes,
      dryRun,
    });
    if (!ok) {
      pruningCanvas = false;
      pruningLocal = false;
      report = plan({
        ...inputs,
        policy: {
          ...policy,
          resolved: resolved || undefined,
          pruneCanvas: false,
          pruneLocal: false,
        },
      });
    }
  }

  let outcome = { applied: [], errors: [] };
  if (report.collision) {
    // Nothing is decided about a collided module until the author picks a
    // direction, so nothing is executed for the whole run either.
    log.error('[sync] Refusing to reconcile; no changes were made.');
  } else if (dryRun) {
    log.info('[sync] DRY RUN — nothing was written.');
  } else if (report.actions.length > 0) {
    outcome = await applyPlan(report, {
      courseId,
      courseDir,
      state,
      gitDirty,
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
    // reads as the preview it is. Every other run — including one the collision
    // refused and one the icon upload aborted — hands over what actually ran,
    // which for those two is nothing.
    applied: dryRun ? undefined : outcome.applied,
    pruneCanvas: pruningCanvas,
    pruneLocal: pruningLocal,
    baseUrl: state.canvas_base_url,
    courseId,
  });
  if (lines.length > 0) {
    for (const line of lines) log.info(line);
  } else if (outcome.errors.length > 0) {
    // A bare report is not agreement: nothing got as far as being applied, and
    // the errors below are the whole account of this run.
    log.info('[sync] Nothing was applied. See the errors below.');
  } else {
    log.info('[sync] Everything is already in sync.');
  }

  printErrors(outcome.errors, { tag: 'sync' });

  // A refusal fails the run, which is this tool's convention everywhere else.
  // Orphans and the informational sections do not: a course mid-edit is a
  // normal state, not a failure.
  if (
    outcome.errors.length > 0 ||
    report.skipped.length > 0 ||
    report.collision
  ) {
    process.exitCode = 1;
  }
}

module.exports = sync;
