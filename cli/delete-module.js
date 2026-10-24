const fs = require('fs');
const path = require('path');
const {
  COURSE_DIR,
  prompt,
  getExistingModules,
  resolveOneModule,
  createRL,
  printModules,
} = require('./module-utils');
const { renumberSequential } = require('./renumber');
const { dropRowsRenumberedOver } = require('./sync-renames');
const { loadState, renameFolders, saveState } = require('../lib/sync/state');

/**
 * Get module entries in the format expected by renumberSequential.
 */
function getModuleEntries(dirPath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const modules = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const match = entry.name.match(/^(\d+)/);
    if (match) {
      modules.push({
        prefix: parseInt(match[1], 10),
        name: entry.name,
        isDirectory: true,
      });
    }
  }

  modules.sort((a, b) => a.prefix - b.prefix);
  return modules;
}

async function deleteModule(options = {}) {
  // First, before a question is asked and long before a folder is removed.
  // `loadState` refuses a sync state that describes another Canvas course, and
  // one written by another schema; both refusals exist to stop this command
  // editing a state file that is not this course's. Loading it after the
  // deletion inverted that promise — the folder was already gone by the time
  // the refusal arrived — and loading it after the confirmation would still
  // make the author answer "yes, delete it" to a run that then refuses.
  //
  // Read once and kept: nothing between here and `saveState` writes the file.
  // `renumberSequential` and `module-utils` touch the filesystem and never the
  // sync state, so the object read here is the one that gets written.
  const syncData = loadState({ allowNull: true });

  let sourceModule;

  if (options.module) {
    // Non-interactive mode (VS Code): requires --yes since there is no prompt
    if (!options.yes) {
      console.error(
        '[delete-module] Error: --module requires --yes to confirm deletion.',
      );
      process.exit(1);
    }
    // A number reaches the module as surely as its full name does, so a
    // mistyped `-m 3` deletes a module where a mistyped name only failed. The
    // `Deleted` line below names the folder either way, and the deletion is
    // local only, so a commit has it back.
    const modules = getExistingModules();
    try {
      const folder = resolveOneModule(
        options.module,
        modules.map((m) => m.folderName),
      );
      sourceModule = modules.find((m) => m.folderName === folder);
    } catch (err) {
      console.error(`[delete-module] Error: ${err.message}`);
      process.exit(1);
    }
  } else {
    const rl = createRL({
      command: 'delete-module',
      flags: '--module and --yes',
    });

    console.log('[delete-module] Delete a course module\n');

    const modules = getExistingModules();

    if (modules.length === 0) {
      rl.close();
      console.log('[delete-module] No modules found.');
      return;
    }

    printModules(modules);

    const sourceStr = await prompt(rl, 'Module to delete (number)');
    const sourcePrefix = parseInt(sourceStr, 10);
    sourceModule = modules.find((m) => m.prefix === sourcePrefix);

    if (!sourceModule) {
      rl.close();
      console.error(
        `[delete-module] Error: No module found with number ${sourceStr}.`,
      );
      process.exit(1);
    }

    const confirm = await prompt(
      rl,
      `Delete ${sourceModule.folderName} and all its contents? (y/N)`,
      'N',
    );
    rl.close();

    if (confirm.toLowerCase() !== 'y') {
      console.log('[delete-module] Cancelled.');
      return;
    }
  }

  // Delete the folder
  const folderPath = path.join(COURSE_DIR, sourceModule.folderName);
  fs.rmSync(folderPath, { recursive: true });
  console.log(`[delete-module] Deleted ${sourceModule.folderName}/`);

  // The module's rows stay, and deleting them here is exactly the bug. A base
  // row is the only thing that separates "the author deleted this" from "this
  // tool has never seen it". Without one, `planModuleMetadata` pairs the live
  // Canvas module with no folder and no base and emits `create-local-module`:
  // the next sync writes the folder, its pages and its `_category_.json`
  // straight back, and the author deletes the module again. Without one there
  // is also nothing for `--prune-canvas` to offer, because a prune candidate
  // *is* a base row — `push --prune-canvas` reported `nothing to remove from
  // Canvas` for a module it should have been offering to delete.
  //
  // Kept, `planModuleOrphan` reports the module under `Orphaned on Canvas`,
  // `--prune-canvas` reaches it, and the row cleans itself up: once the Canvas
  // module is gone too, the planner emits `drop-base-module`.
  //
  // The `state.files` rows for binaries this folder embedded stay for the same
  // reason and a sharper one. A Canvas file id is global rather than
  // course-scoped, and these rows are the last thing in this repository that
  // holds the one behind each embedded binary; dropping them stranded the file
  // on Canvas for good, unreachable to `planEmbeddedFileOrphans` — which reads
  // `state.files` — and to `--prune-canvas`, which only ever considered items.
  // `deleteModule` in `lib/sync/state.js` leaves them alone for that reason,
  // and this command used to undo it.

  // Renumber remaining modules sequentially to close the gap
  const renames = renumberSequential(COURSE_DIR, getModuleEntries);

  // Before `renameFolders`, not after. Closing the gap slides the next module
  // into this one's slot, and when the two share a slug it lands on this one's
  // folder name exactly — where the row just kept is still sitting.
  // `renameFolder` refuses to overwrite it, `renameFolders` rolls the mover
  // back, and the surviving folder silently inherits the deleted module's
  // Canvas id while the live module it really is becomes a prune candidate.
  // The state is handed in because this command holds it and saves once below.
  if (syncData) {
    dropRowsRenumberedOver(
      [{ fromDir: COURSE_DIR, deleted: sourceModule.folderName, renames }],
      { tag: 'delete-module', state: syncData },
    );
  }

  if (renames.length > 0) {
    console.log('[delete-module] Renumbered remaining modules:');
    for (const r of renames) {
      console.log(`  ${r.from} -> ${r.to}`);
    }
    // A renumbered folder is a renamed one: its key, the paths of every item
    // inside it and its embedded-file rows all move together. In one batch,
    // because closing the gap slides every module into its neighbour's slot.
    if (syncData) renameFolders(syncData, renames);
  }

  if (syncData) {
    saveState(syncData);
    console.log('[delete-module] Sync state updated.');
  }
}

module.exports = deleteModule;
