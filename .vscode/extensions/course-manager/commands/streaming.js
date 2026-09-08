const vscode = require('vscode');
const { validateWorkspace } = require('../workspace');
const { runInTerminal } = require('../terminal');
const { pickModuleFolder } = require('../pickers');

// Long-running / streaming commands run in a shared terminal. Structural
// commands (new/rename/move/delete) run silently via runCli and report
// through notifications + the output channel.
//
// The last three are the advanced commands: reachable from the command palette
// and from nowhere else, with no view/title entry and no context menu, so a
// stray click in the tree can never start one. The two resets need the terminal
// for a second reason. It is where the CLI asks its own questions, and those
// questions are the gate: reset-canvas prints an inventory of everything it is
// about to delete and waits for y/N, reset-sync-state waits for y/N. An answer
// typed there is the answer a hand-run terminal would have given.
const commands = {
  'course.setup': 'npx course setup',
  'course.init': 'npx course init',
  'course.sync': 'npx course sync',
  'course.syncDryRun': 'npx course sync --dry-run',
  'course.push': 'npx course push',
  'course.pushDryRun': 'npx course push --dry-run',
  'course.pull': 'npx course pull',
  'course.pullDryRun': 'npx course pull --dry-run',
  'course.status': 'npx course status',
  'course.validate': 'npx course validate',
  'course.check': 'npx course check',
  'course.buildGlossary': 'npx course build-glossary',
  'course.resetSyncState': 'npx course reset-sync-state',
  'course.resetCanvas': 'npx course reset-canvas',
};

/**
 * The commands whose output is a report to read as it arrives: the whole-course
 * table above, the same four scoped to one module row, and Search.
 */
function registerStreamingCommands({ register }) {
  // --- Terminal-based commands (streaming output) ---
  // The four exempt from the course/-missing warning are the four that do not
  // read course/: Setup writes it, Init writes .env and the sync state, and
  // both resets operate on that state and on Canvas. Setup is also the command
  // the warning now points at, so leaving it in would have interrupted the run
  // that was about to answer it. Reset Sync State is precisely what you reach
  // for when the project is in a state you cannot sync out of, so warning that
  // it looks unfinished would be advice pointing the wrong way.
  const noValidationCommands = new Set([
    'course.setup',
    'course.init',
    'course.resetSyncState',
    'course.resetCanvas',
  ]);
  for (const [id, cmd] of Object.entries(commands)) {
    register(id, () => {
      if (!noValidationCommands.has(id) && !validateWorkspace()) return;
      runInTerminal(() => cmd);
    });
  }

  // The sync family, scoped to the module row it was clicked on: the inline
  // push button and the three context-menu entries beside it. Each reads that
  // row and does nothing without one, so none of them is offered in the
  // palette, which carries the whole-course Sync, Push, Pull and Status
  // instead, and a Push Module that asks which module to send.
  //
  // All four stream into the terminal rather than through the silent runner.
  // What they produce is a report to read as it arrives, and two of them stop
  // for an answer even on this flag set, where the silent runner would hang at
  // a prompt nobody can see. Sync asks twice over: which side wins when both
  // sides reordered the module (the CLI's `--order` default is `ask`, no flag
  // involved), and whether a path that vanished and a new one with the same
  // title in the same folder are one item renamed. Push asks before the first
  // push to a Canvas course that already holds content and that this project
  // has never pushed to, which `--module` does not suppress. Pull and status
  // ask nothing here, and follow the other two so the group behaves one way.
  register('course.pushItem', (treeItem) => {
    const moduleName = treeItem?.moduleFolderName;
    if (!moduleName) return;
    if (!validateWorkspace()) return;
    runInTerminal((q) => `npx course push --module ${q(moduleName)}`);
  });

  register('course.syncItem', (treeItem) => {
    const moduleName = treeItem?.moduleFolderName;
    if (!moduleName) return;
    if (!validateWorkspace()) return;
    runInTerminal((q) => `npx course sync --module ${q(moduleName)}`);
  });

  register('course.pullItem', (treeItem) => {
    const moduleName = treeItem?.moduleFolderName;
    if (!moduleName) return;
    if (!validateWorkspace()) return;
    runInTerminal((q) => `npx course pull --module ${q(moduleName)}`);
  });

  register('course.statusItem', (treeItem) => {
    const moduleName = treeItem?.moduleFolderName;
    if (!moduleName) return;
    if (!validateWorkspace()) return;
    runInTerminal((q) => `npx course status --module ${q(moduleName)}`);
  });

  register('course.pushModule', async () => {
    if (!validateWorkspace()) return;
    const picked = await pickModuleFolder('Select module to push');
    if (picked) {
      runInTerminal((q) => `npx course push --module ${q(picked)}`);
    }
  });

  register('course.search', async () => {
    if (!validateWorkspace()) return;
    const keyword = await vscode.window.showInputBox({
      prompt: 'Search course content for a word or phrase',
      placeHolder: 'e.g. flexbox',
      validateInput: (v) => (v.trim() ? null : 'Enter a search term'),
    });
    if (!keyword) return;
    runInTerminal((q) => `npx course search ${q(keyword.trim())}`);
  });
}

module.exports = { registerStreamingCommands };
