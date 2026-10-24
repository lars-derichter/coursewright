const {
  COURSE_DIR,
  prompt,
  getExistingModules,
  resolveOneModule,
  createRL,
  printModules,
} = require('./module-utils');
const { reorder } = require('./renumber');
const { recordRenames } = require('./sync-renames');

async function moveModule(options = {}) {
  let modules;
  let sourceModule;
  let targetPosition;

  if (options.module && options.position) {
    // Non-interactive mode (VS Code)
    modules = getExistingModules();
    try {
      const folder = resolveOneModule(
        options.module,
        modules.map((m) => m.folderName),
      );
      sourceModule = modules.find((m) => m.folderName === folder);
    } catch (err) {
      console.error(`[move-module] Error: ${err.message}`);
      process.exit(1);
    }
    targetPosition = parseInt(options.position, 10);
    if (
      isNaN(targetPosition) ||
      targetPosition < 1 ||
      targetPosition > modules.length
    ) {
      console.error(
        `[move-module] Error: Position must be between 1 and ${modules.length}.`,
      );
      process.exit(1);
    }
  } else {
    const rl = createRL({
      command: 'move-module',
      flags: '--module and --position',
    });

    console.log('[move-module] Move a course module to a new position\n');

    modules = getExistingModules();

    if (modules.length < 2) {
      rl.close();
      console.log('[move-module] Need at least 2 modules to reorder.');
      return;
    }

    printModules(modules);

    while (true) {
      const sourceStr = await prompt(rl, 'Module to move (number)');
      const prefix = parseInt(sourceStr, 10);
      sourceModule = modules.find((m) => m.prefix === prefix);
      if (sourceModule) break;
      console.log(
        `  No module found with number ${sourceStr}. Please try again.`,
      );
    }

    while (true) {
      const targetStr = await prompt(rl, 'New position');
      targetPosition = parseInt(targetStr, 10);
      if (
        !isNaN(targetPosition) &&
        targetPosition >= 1 &&
        targetPosition <= modules.length
      )
        break;
      console.log(
        `  Position must be between 1 and ${modules.length}. Please try again.`,
      );
    }
    rl.close();
  }

  // `targetPosition` is a 1-based ordinal into the sorted list, so the no-op
  // check must compare ordinals too: with gapped or 00-based numbering the
  // prefix disagrees with the ordinal, and comparing it here no-opped real
  // moves while letting genuine same-slot moves through.
  if (modules.indexOf(sourceModule) + 1 === targetPosition) {
    console.log('[move-module] Module is already at that position.');
    return;
  }

  // Map modules to the format expected by reorder()
  const entries = modules.map((m) => ({
    prefix: m.prefix,
    name: m.folderName,
    isDirectory: true,
  }));

  const renames = reorder(
    COURSE_DIR,
    entries,
    sourceModule.prefix,
    targetPosition,
  );
  recordRenames([{ fromDir: COURSE_DIR, renames }]);

  if (renames.length > 0) {
    console.log('[move-module] Reordered modules:');
    for (const r of renames) {
      console.log(`  ${r.from} -> ${r.to}`);
    }
  }
}

module.exports = moveModule;
