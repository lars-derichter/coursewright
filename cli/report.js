const { BACKUP_HINT } = require('./backup-warning');
const log = require('./logger');

/**
 * The closing report `sync`, `push`, `pull` and `status` all print.
 *
 * The four commands are one engine under four policies, and a run's account of
 * itself is the part of them that must not differ: the same sections in the same
 * order, whichever of the four asked for them. So it lives in a module all four
 * import rather than in any one of them. It used to hang off `cli/sync.js` as
 * `sync._buildReport`, which made the other three commands import a command to
 * print their own output, and made a change to sync's own policy look like a
 * change to everybody's report.
 *
 * Nothing here reaches the network or the disk. `buildReport` is a function of
 * its arguments alone, which is what lets `status` be this over a plan that
 * writes to neither side, and what lets the whole report be tested without
 * running a sync.
 *
 * `plural` is here for the same reason the report is: the counts a command
 * prints outside the report, in a prune listing or an error heading, read as one
 * voice with the ones inside it. There were four copies of that one-liner, in
 * two different signatures.
 *
 * `printErrors` and `checkModuleFilter` are the two things here that print
 * rather than return lines, and they earn their place the same way: the same
 * listing closes three of the four runs, the same refusal answers an unknown
 * `-m` in three of them, and both were written out once per command, with three
 * chances each to drift.
 */

/**
 * `1 page` / `3 pages`, so a count never reads as a stutter.
 *
 * The third argument is for the words that do not take `s`: `plural(1, 'reply',
 * 'replies')`. Left out, the plural is the singular plus `s`, which is what
 * every count in the report itself needs.
 */
function plural(count, singular, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/**
 * An action type read as its three parts. Every type in the planner's
 * vocabulary is `<verb>-<side>-<object>`, bar the two that name only a side.
 */
function classifyAction(type) {
  const parts = String(type).split('-');
  if (parts.length < 3)
    return { verb: parts[0], side: parts[1], object: 'row' };
  return { verb: parts[0], side: parts[1], object: parts[2] };
}

const SIDE_LABELS = { canvas: 'Canvas', local: 'Locally', base: 'Sync state' };
const VERB_LABELS = {
  create: 'created',
  update: 'updated',
  move: 'moved',
  delete: 'deleted',
  reorder: 'reordered',
  rekey: 're-keyed',
  link: 'linked',
  drop: 'dropped',
};

/**
 * The action types no section of the report counts, because none of them is a
 * change the author could see or would have to act on.
 *
 * `refresh-base-hash` is the 1.5.2 migration bridge: it re-records a file
 * item's fingerprint under a new formula after an update, on a run where
 * nothing on either side moved. Counted, the first run after updating would
 * open with "Sync state: 40 hashes refreshed" in every course with file items,
 * and `status` would list the same under "Left alone" as though there were
 * something to sync. The other base-side actions stay counted: a re-key or a
 * dropped row is a consequence of something the author did.
 */
const UNREPORTED_ACTIONS = new Set(['refresh-base-hash']);

/** "Canvas: 2 items created, 1 module reordered", one line per side. */
function summariseActions(actions) {
  const counts = new Map();
  for (const action of actions) {
    if (UNREPORTED_ACTIONS.has(action.type)) continue;
    const { verb, side, object } = classifyAction(action.type);
    const key = `${side}|${verb}|${object}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  const lines = [];
  for (const side of ['canvas', 'local', 'base']) {
    const parts = [];
    for (const [key, count] of counts) {
      const [entrySide, verb, object] = key.split('|');
      if (entrySide !== side) continue;
      parts.push(`${plural(count, object)} ${VERB_LABELS[verb] || verb}`);
    }
    if (parts.length > 0) {
      lines.push(`  ${SIDE_LABELS[side]}: ${parts.join(', ')}`);
    }
  }
  return lines;
}

/** Where an orphaned Canvas item is, so it can be opened and looked at. */
function canvasItemUrl({ baseUrl, courseId }, orphan) {
  if (!baseUrl || !courseId) return '';
  if (orphan.kind === 'module' && orphan.canvasModuleId != null) {
    return ` — ${baseUrl}/courses/${courseId}/modules#module_${orphan.canvasModuleId}`;
  }
  // An embedded binary is in the course Files area and in no module at all, so
  // a module-item URL would point at nothing.
  if (orphan.kind === 'file' && orphan.canvasFileId != null) {
    return ` — ${baseUrl}/courses/${courseId}/files/${orphan.canvasFileId}`;
  }
  if (orphan.moduleItemId != null) {
    return ` — ${baseUrl}/courses/${courseId}/modules/items/${orphan.moduleItemId}`;
  }
  return '';
}

/** A timestamp as a report reads it, with an unparseable one left verbatim. */
function stamp(value) {
  if (value == null) return 'unknown';
  const date = typeof value === 'number' ? new Date(value) : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

/**
 * The actions that actually ran, as a set of `type|where` keys.
 *
 * The plan says what should happen; only the executor knows what did. Crossing
 * the two is what stops the report claiming a delete that 404'd or a write that
 * failed — and it is done here, from the applied list, rather than by threading
 * a second flag back through the planner, which is pure and has to stay a
 * function of its three inputs.
 */
function appliedIndex(applied) {
  const keys = new Set();
  for (const action of applied || []) {
    const where = action.itemPath || action.folder;
    if (where != null) keys.add(`${action.type}|${where}`);
  }
  return keys;
}

/**
 * Whether an orphan was really deleted, rather than merely planned for deletion.
 *
 * The planner sets `pruned` when it *emits* the delete, which is the only thing
 * a pure function can know. A delete that then failed leaves the item exactly
 * where it was, so reading that flag as truth drops it out of the report — and
 * the run's own summary becomes the thing that stops mentioning the item still
 * sitting in the course.
 */
function orphanDeleted(orphan, side, run) {
  if (orphan.pruned !== true) return false;
  if (!run.executed) return true;

  const where =
    orphan.kind === 'module' ? orphan.moduleFolder : orphan.itemPath;
  if (run.landed.has(`delete-${side}-${orphan.kind}|${where}`)) return true;
  // An item inside a module being deleted never gets a delete of its own: the
  // module's takes it along, so the module's is the one to look for.
  if (orphan.kind === 'item' && orphan.coveredByModule) {
    return run.landed.has(`delete-${side}-module|${orphan.moduleFolder}`);
  }
  return false;
}

/**
 * Why an orphan is still listed, when there is anything to say.
 *
 * Two different facts, and the planner can only know one of them. It sets
 * `reason` when it declined to emit a delete at all — a module still holding
 * remote changes, a folder with uncommitted work. A delete it *did* emit and
 * that then failed is invisible to it, because the failure happened after
 * planning. That one is read off the applied list, and it has to be said here:
 * the section closes with "each line says why", and this is the one case where
 * no line would carry a why.
 *
 * Called only for orphans that survived the filter, so `pruned` still true on
 * an executed run means exactly "attempted, and it did not land".
 */
function orphanNotes(orphan, run) {
  const notes = [];
  if (orphan.reason) notes.push(orphan.reason);
  if (run.executed && orphan.pruned === true) {
    notes.push('the delete was attempted and it failed; see the errors below');
  }
  return notes.length > 0 ? ` — ${notes.join('; ')}` : '';
}

/**
 * Whether the write that claims an existing Canvas object actually landed.
 *
 * An adoption emits an ordinary update, so a failed one is indistinguishable
 * from any other failed update in the summary — and calling it adopted anyway
 * would tell the author their file is tied to a Canvas object it is not tied
 * to, which is worse than saying nothing.
 */
function adoptionLanded(entry, run) {
  if (entry.applied !== true) return false;
  if (!run.executed) return true;
  const type =
    entry.direction === 'local' ? 'update-canvas-item' : 'update-local-item';
  return run.landed.has(`${type}|${entry.itemPath}`);
}

/** Whether the write that settles a conflict actually landed. */
function conflictLanded(conflict, run) {
  if (conflict.applied !== true) return false;
  if (!run.executed) return true;
  const where = conflict.itemPath || conflict.moduleFolder;
  const object = conflict.kind === 'module' ? 'module' : 'item';
  const type =
    conflict.winner === 'local'
      ? `update-canvas-${object}`
      : `update-local-${object}`;
  return run.landed.has(`${type}|${where}`);
}

/**
 * Whether the reorder that settles a module's order actually landed.
 *
 * The winner is the side that keeps its order, so the write goes to the other
 * one: a local winner is a `reorder-canvas-module`. One reorder covers a whole
 * module, so its line in the report is the only account the author gets of what
 * happened to that module's order — nothing in the summary above is per-item
 * enough to contradict it.
 */
function reorderLanded(entry, run) {
  if (entry.applied !== true) return false;
  if (!run.executed) return true;
  const type =
    entry.winner === 'local' ? 'reorder-canvas-module' : 'reorder-local-module';
  return run.landed.has(`${type}|${entry.folder}`);
}

/**
 * Render a plan as the run's closing report — the same sections in the same
 * order for every command that owns a plan, each omitted when it is empty.
 *
 * It is a function of its arguments alone, so it can be tested without running
 * anything, and so `status` is this over a plan that writes to neither side.
 *
 * **`applied` is what separates a report from a preview.** Given it, the report
 * describes what happened: the summary counts the actions that ran, an orphan
 * whose delete failed is still listed as sitting in the course, and a conflict
 * whose write failed is not called resolved. Without it the report describes
 * what *would* happen, which is what a dry run and `status` both want. There is
 * no separate dry-run flag, because two parameters that have to agree with each
 * other are one too many.
 *
 * @param {object} report - What `plan()` returned.
 * @param {object} [options]
 * @param {object[]} [options.applied]    - The actions `applyPlan` actually
 *   ran. Absent means "nothing was executed": report the plan as a preview.
 * @param {boolean} [options.pruneCanvas] - Whether `--prune-canvas` was given.
 * @param {boolean} [options.pruneLocal]  - Whether `--prune-local` was given.
 * @param {string}  [options.baseUrl]     - For linking Canvas objects.
 * @param {string|number} [options.courseId]
 * @returns {string[]} Lines, ready to print one per call.
 */
function buildReport(report, options = {}) {
  const lines = [];
  const section = (title, body) => {
    if (body.length === 0) return;
    lines.push('');
    lines.push(title);
    lines.push(...body);
  };

  const run = {
    executed: Array.isArray(options.applied),
    landed: appliedIndex(options.applied),
  };

  // --- Applied -------------------------------------------------------------
  // An empty list renders no section at all, which is right for a run where
  // every action failed as much as for one that planned nothing. Those are not
  // the same thing to say, and this cannot tell them apart: a report is a
  // function of the plan and what ran, and the difference between the two is in
  // the errors, which are neither. So each command reads its own `errors`
  // before it decides what a bare report means. Every one of them used to
  // answer both cases with the sentence for the second, and a run that refused
  // its only action therefore reported the two sides as agreeing.
  section(
    run.executed ? 'Applied' : 'Would apply',
    summariseActions(run.executed ? options.applied : report.actions || []),
  );

  // Under `status`, and under a pinned-direction run, the plan records what the
  // policy forbade rather than losing it — so it can still be named.
  section(
    'Left alone (this command does not write to that side)',
    summariseActions(report.withheld || []),
  );

  // --- Adopted -------------------------------------------------------------
  // An adoption is an ordinary update in the summary above, so without this
  // section the author reads "1 item updated" and never learns that the item
  // in question was an object already sitting in Canvas, now claimed by a
  // local file. That is the whole fact worth telling them.
  section(
    'Adopted (matched to something already in Canvas)',
    (report.adopted || []).map((entry) => {
      const claimed = adoptionLanded(entry, run);
      const why = claimed
        ? ''
        : entry.applied === true
          ? ' — the write failed, so nothing was claimed; see the errors below'
          : ' — nothing was written, so the two are still unlinked';
      return (
        `  - ${entry.itemPath}: ${entry.canvasType} "${entry.title}"` +
        `${canvasItemUrl(options, entry)}${why}`
      );
    }),
  );

  // --- Orphaned on Canvas --------------------------------------------------
  const canvasOrphans = (report.orphans.canvas || []).filter(
    (orphan) => !orphanDeleted(orphan, 'canvas', run),
  );
  if (canvasOrphans.length > 0) {
    const body = canvasOrphans.map((orphan) => {
      // A `file` orphan is a binary in the course Files area that no page
      // embeds any more, not a module item, so it says which of the two it is.
      const what =
        orphan.kind === 'module'
          ? `module "${orphan.title}" (${plural(orphan.itemCount || 0, 'item')})`
          : orphan.kind === 'file'
            ? `embedded file "${orphan.title}", which nothing embeds any more`
            : `${orphan.canvasType} "${orphan.title || orphan.itemPath}"`;
      const why = orphanNotes(orphan, run);
      return `  - ${orphan.itemPath || orphan.moduleFolder}: ${what}${canvasItemUrl(options, orphan)}${why}`;
    });
    body.push(
      options.pruneCanvas
        ? '  Nothing above was deleted; each line says why.'
        : '  Nothing was deleted. `--prune-canvas` is what deletes these.',
    );
    if (!options.pruneCanvas) body.push(`  ${BACKUP_HINT}`);
    section('Orphaned on Canvas (gone locally, still there)', body);
  }

  // --- Orphaned locally ----------------------------------------------------
  const localOrphans = (report.orphans.local || []).filter(
    (orphan) => !orphanDeleted(orphan, 'local', run),
  );
  if (localOrphans.length > 0) {
    const body = localOrphans.map((orphan) => {
      const what =
        orphan.kind === 'module'
          ? `folder "${orphan.moduleFolder}" (${plural(orphan.itemCount || 0, 'item')})`
          : `${orphan.canvasType} "${orphan.title || orphan.itemPath}"`;
      const why = orphanNotes(orphan, run);
      return `  - ${orphan.itemPath || orphan.moduleFolder}: ${what}${why}`;
    });
    body.push(
      options.pruneLocal
        ? '  Nothing above was deleted; each line says why.'
        : '  Nothing was deleted. `--prune-local` is what deletes these.',
    );
    if (!options.pruneLocal) body.push(`  ${BACKUP_HINT}`);
    // Deleting is one of two routes, and the only one a flag covers. The other
    // is the sync state: an entry taken out of it leaves a file nothing links
    // to Canvas any more, which is a new file, so the next push creates the
    // object again. Named here because nothing else in the report says it, and
    // an author who wants the item back rather than gone would otherwise read
    // the deleting flag as the whole answer.
    //
    // It sits below the backup hint rather than above it so that the sentence
    // naming the delete and the warning about the delete stay adjacent, and
    // carries a precondition: this section is built from what Canvas listed in
    // the modules, so an object dragged out of every module reads here exactly
    // like a deleted one, and pushing a row-less file at that state creates a
    // second copy of an object that was never gone.
    body.push(
      '  Or put one back on Canvas: check it is really gone rather than ' +
        'sitting outside every module, then take its entry out of the sync ' +
        'state and push, and it is created fresh; see docs/frontmatter.md, ' +
        'under "Adopting an Item You Made by Hand in Canvas".',
    );
    section('Orphaned locally (gone from Canvas, still here)', body);
  }

  // --- Conflicts resolved --------------------------------------------------
  const conflicts = report.conflicts || [];
  const resolved = conflicts.filter((conflict) =>
    conflictLanded(conflict, run),
  );
  const unsettled = conflicts.filter(
    (conflict) => !conflictLanded(conflict, run),
  );

  section(
    'Conflicts resolved',
    resolved.map((conflict) => {
      const where = conflict.itemPath || conflict.moduleFolder;
      const won = conflict.winner === 'local' ? 'local' : 'Canvas';
      const tail =
        conflict.winner === 'canvas'
          ? ' The version that was here is in git.'
          : '';
      const when =
        conflict.kind === 'item'
          ? ` (local ${stamp(conflict.localMtimeMs)}, Canvas ${stamp(conflict.canvasUpdatedAt)})`
          : '';
      return `  - ${where}: ${won} won — ${conflict.reason}.${when}${tail}`;
    }),
  );

  // --- Conflicts skipped ---------------------------------------------------
  // A conflict whose write never landed belongs here rather than above: it was
  // decided, but both sides are still as they were, and calling that resolved
  // is the report telling the author their course is in a state it is not.
  section('Skipped', [
    ...(report.skipped || []).map(
      (skip) =>
        `  - ${skip.itemPath || skip.moduleFolder} (${skip.reason}): ${skip.remedy}`,
    ),
    ...unsettled.map((conflict) => {
      const where = conflict.itemPath || conflict.moduleFolder;
      const won = conflict.winner === 'local' ? 'local' : 'Canvas';
      // Three reasons a decided write is not on disk, and only one of them is
      // answered by running `sync`. The pinned direction is: sync writes to
      // both sides, so it settles what a one-directional command left. A guard
      // is not: sync meets the same guard and refuses again, and the author was
      // being sent to do the one thing that cannot help — while the guard's own
      // skip entry, printed a few lines above in this very section, carried the
      // remedy that works. `refusal` is which guard it was, and it is the same
      // word that line is tagged with.
      const remedy =
        conflict.applied === true
          ? 'the write failed, so both sides are as they were — see the ' +
            'errors below, then run again.'
          : conflict.refusal
            ? `the write was refused (${conflict.refusal}), so nothing ` +
              `changed. The ${conflict.refusal} line above says what to fix; ` +
              'running again settles this only once it is fixed.'
            : 'this command does not write to the side that lost, so nothing ' +
              'changed. Run `npx course sync` to settle it.';
      return `  - ${where} (conflict-unwritten): ${won} would have won, but ${remedy}`;
    }),
  ]);

  // --- Ordering ------------------------------------------------------------
  section(
    'Ordering',
    (report.ordering || []).map((entry) => {
      if (entry.skipped) {
        const orders =
          entry.local && entry.canvas
            ? `\n      here:   ${entry.local.join(' → ')}\n      Canvas: ${entry.canvas.join(' → ')}`
            : '';
        return `  - ${entry.folder}: left as it is — ${entry.reason}.${orders}`;
      }
      const from =
        entry.winner === 'local' ? 'the local order' : 'the Canvas order';
      if (reorderLanded(entry, run)) {
        return `  - ${entry.folder}: took ${from} — ${entry.reason}.`;
      }
      // Decided but never carried out, which is not the same as undecided: the
      // two sides are still in different orders, and this line is the only
      // place that says so. The losing side is named rather than called "that
      // side", because the sentence has just named the winning one.
      const loser = entry.winner === 'local' ? 'Canvas' : 'the local files';
      const why =
        entry.applied === true
          ? 'the write failed, so both sides are as they were; see the ' +
            'errors below'
          : `this command does not write to ${loser}, so nothing moved`;
      return `  - ${entry.folder}: would have taken ${from} (${entry.reason}), but ${why}.`;
    }),
  );

  // --- Unrecognised --------------------------------------------------------
  section(
    'Unrecognised Canvas items',
    (report.unrecognised || []).map(
      (item) =>
        `  - ${item.moduleFolder || '(unmatched module)'}: "${item.title}" is a ` +
        `${item.rawType}, which this version does not understand. It was left ` +
        'alone, and the order of its module was not touched either.',
    ),
  );

  // --- Needs a decision ----------------------------------------------------
  section(
    'Needs a decision',
    (report.decisions || []).map((decision) => `  ! ${decision.summary}`),
  );

  // --- Renames awaiting an answer -----------------------------------------
  section(
    'Possible renames awaiting an answer',
    (report.pending.renames || []).map(
      (rename) =>
        `  ! ${rename.from} may have been renamed to ${rename.to}. Neither ` +
        'was touched. Run sync interactively to confirm, or put the row back ' +
        'under the right path in the sync state by hand.',
    ),
  );

  // --- The refusal ---------------------------------------------------------
  if (report.collision) {
    lines.push('');
    lines.push('Refused');
    lines.push(`  ${report.collision.message}`);
  }

  return lines;
}

// ---------------------------------------------------------------------------
// The errors
// ---------------------------------------------------------------------------

/**
 * What failed, under a heading that counts it, after the report has said what
 * the run did.
 *
 * Separate from `buildReport` rather than a section of it, because the report is
 * built from the plan and what ran, and an error is neither: it is what
 * `applyPlan` handed back. Keeping it out is also what lets each command read
 * its own `errors` first and decide what a bare report means — "nothing was
 * applied, see the errors below" rather than "everything is already in sync".
 *
 * @param {object[]} errors    - `applyPlan`'s `outcome.errors`, each `{action,
 *   error}`. An empty list prints nothing at all.
 * @param {object} options
 * @param {string} options.tag - The calling command's log tag.
 */
function printErrors(errors, { tag }) {
  if (errors.length === 0) return;
  log.error(`\n[${tag}] ${plural(errors.length, 'error')}:`);
  for (const failure of errors) {
    log.error(
      // A run-wide failure — the icon upload — names no path and no folder,
      // so it falls back to its own name rather than printing "undefined".
      `  - ${failure.action.itemPath || failure.action.folder || failure.action.type}: ${failure.error}`,
    );
  }
}

// ---------------------------------------------------------------------------
// The `-m` refusal
// ---------------------------------------------------------------------------

/**
 * Refuse a `-m` that names a module nothing has heard of, rather than scoping
 * the run to nothing and reporting a course in perfect agreement.
 *
 * The set it checks against is the union of three sources rather than the local
 * folders alone, because a module may exist only in Canvas and be about to be
 * written here for the first time: that is what a `pull` does by definition,
 * what a `sync` does whenever Canvas is ahead, and what `status` previews.
 * Refusing those would refuse the very run that creates the folder. A typo, on
 * the other hand, matches none of the three.
 *
 * `push` deliberately does not use this. It writes to Canvas out of local
 * folders, so a name no folder answers to is a name it cannot push whatever
 * Canvas holds, and it says exactly that in its own refusal.
 *
 * @param {string[]|null} modules - The names `-m` was given, or null when the
 *   flag was absent, which is nothing to check.
 * @param {object} sources
 * @param {object} sources.local  - What `gatherLocal` returned.
 * @param {object} sources.canvas - What `gatherCanvas` returned.
 * @param {object} sources.state  - The sync state, which knows the folders
 *   neither side is showing this run.
 * @param {string} sources.tag    - The calling command's log tag.
 * @returns {boolean} Whether the run may go on. A false has already said why.
 */
function checkModuleFilter(modules, { local, canvas, state, tag }) {
  if (!modules) return true;

  const known = new Set([
    ...local.modules.map((mod) => mod.folder),
    ...Object.keys(state.modules || {}),
    ...canvas.modules.map((mod) => mod.suggestedFolder).filter(Boolean),
  ]);
  const missing = modules.filter((name) => !known.has(name));
  if (missing.length === 0) return true;

  log.error(
    `[${tag}] Error: no module named ${missing.join(', ')} — nothing under ` +
      'course/ and nothing in the Canvas course answers to it.',
  );
  return false;
}

module.exports = {
  buildReport,
  checkModuleFilter,
  plural,
  printErrors,
  // `cli/sync.js` prints the same timestamps in the questions it asks about a
  // conflict as the report prints in its answer, so both read them off this.
  stamp,
};
