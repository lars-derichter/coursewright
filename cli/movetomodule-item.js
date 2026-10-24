const fs = require('fs');
const path = require('path');
const {
  prompt,
  pad,
  createRL,
  getExistingModules,
  printModules,
  COURSE_DIR,
  courseFolders,
  resolveOneModule,
} = require('./module-utils');
const {
  getItems,
  printItems,
  selectModule,
  selectTargetDir,
} = require('./item-utils');
const {
  renumberSequential,
  renumberUp,
  updateCategoryPosition,
} = require('./renumber');
const { recordRenames } = require('./sync-renames');

/**
 * Where a path is now, after a batch of sibling renames inside `dir` — the
 * path itself when it is one of the renamed entries, or rebased when it sits
 * under one. A path the renames never touched comes back unchanged.
 */
function followRenames(p, dir, renames) {
  for (const { from, to } of renames) {
    const before = path.join(dir, from);
    if (p === before) return path.join(dir, to);
    if (p.startsWith(before + path.sep)) {
      return path.join(dir, to) + p.slice(before.length);
    }
  }
  return p;
}

/**
 * Core move: shift destination items to make room, move the file, renumber
 * the source directory to close the gap.
 */
function moveEntry(sourceDir, entryName, destDir, position) {
  const destItems = getItems(destDir);

  // Make room at destination
  const destRenames = destItems.some((i) => i.prefix >= position)
    ? renumberUp(destDir, destItems, position)
    : [];

  // A same-module move can put the source inside destDir, where the shift
  // above just renamed it: the subsection holding the entry, or the entry
  // itself when source and destination are one directory. Re-derive the
  // source path so the rename below never works from a name the shift has
  // already taken off the disk.
  const entryPath = followRenames(
    path.join(sourceDir, entryName),
    destDir,
    destRenames,
  );
  sourceDir = path.dirname(entryPath);
  entryName = path.basename(entryPath);

  const newName = entryName.replace(/^\d+/, pad(position));
  const destPath = path.join(destDir, newName);

  // The shift is already on disk, so every exit from here on — the refusal
  // below included — must carry what landed into the sync state, or the next
  // push reads each shifted entry as a delete plus a create.
  const batches = [{ fromDir: destDir, renames: destRenames }];

  if (fs.existsSync(destPath)) {
    recordRenames(batches);
    console.error(
      `[movetomodule] Error: ${newName} already exists in the destination.`,
    );
    process.exit(1);
  }

  let sourceRenames;
  try {
    fs.renameSync(entryPath, destPath);
    // Batches stay in the order the renames happened, so the row lands in the
    // destination module rather than in the slot the shift above has vacated.
    batches.push({
      fromDir: sourceDir,
      toDir: destDir,
      renames: [{ from: entryName, to: newName }],
    });

    // A moved subsection keeps its own _category_.json; align its position to
    // the new prefix (renumberUp/renumberSequential only fix the other entries).
    if (fs.statSync(destPath).isDirectory()) {
      updateCategoryPosition(destDir, newName, position);
    }

    // Renumber source to close gap
    sourceRenames = renumberSequential(sourceDir, getItems);
    batches.push({ fromDir: sourceDir, renames: sourceRenames });
  } catch (err) {
    recordRenames(batches);
    throw err;
  }

  recordRenames(batches);

  // Closing the source gap can in turn rename destDir itself — a move into a
  // subsection of the same module — so the reported path is re-derived the
  // same way the source path was above.
  const finalPath = followRenames(destPath, sourceDir, sourceRenames);
  console.log(
    `[movetomodule] Moved ${entryName} -> ${path.relative(process.cwd(), finalPath)}`,
  );
  if (sourceRenames.length > 0) {
    console.log('[movetomodule] Renumbered source:');
    for (const r of sourceRenames) {
      console.log(`  ${r.from} -> ${r.to}`);
    }
  }
}

async function moveToModule(options = {}) {
  // Non-interactive mode (VS Code): --path and --to-module provided
  if (options.path && options.toModule) {
    const itemPath = path.resolve(options.path);
    if (!fs.existsSync(itemPath)) {
      console.error(`[movetomodule] Error: Not found: ${itemPath}`);
      process.exit(1);
    }
    let destDir;
    try {
      destDir = path.join(
        COURSE_DIR,
        resolveOneModule(options.toModule, courseFolders()),
      );
    } catch (err) {
      // The resolver's words, with the one this command has always used for
      // a destination nothing answers to.
      const message = err.message.replace(
        /^Module not found/,
        'Destination module not found',
      );
      console.error(`[movetomodule] Error: ${message}`);
      process.exit(1);
    }
    if (options.toSubsection) {
      destDir = path.join(destDir, options.toSubsection);
      if (!fs.existsSync(destDir) || !fs.statSync(destDir).isDirectory()) {
        console.error(
          `[movetomodule] Error: Destination subsection not found: ${options.toSubsection}`,
        );
        process.exit(1);
      }
    }
    const destItems = getItems(destDir);
    const defaultPos =
      destItems.length > 0 ? destItems[destItems.length - 1].prefix + 1 : 1;
    const position = options.position
      ? parseInt(options.position, 10)
      : defaultPos;
    if (isNaN(position) || position < 1 || position > 99) {
      console.error(
        '[movetomodule] Error: Position must be a number between 1 and 99.',
      );
      process.exit(1);
    }
    moveEntry(
      path.dirname(itemPath),
      path.basename(itemPath),
      destDir,
      position,
    );
    return;
  }

  const rl = createRL({
    command: 'movetomodule-item',
    flags: '--path and --to-module',
  });

  console.log('[movetomodule] Move an item to a different module\n');

  // Source selection
  console.log('--- Source ---');
  const source = await selectModule(rl);
  const sourceDir = await selectTargetDir(rl, source.modulePath);
  const sourceItems = getItems(sourceDir);

  if (sourceItems.length === 0) {
    rl.close();
    console.log('[movetomodule] No items to move.');
    return;
  }

  printItems(sourceItems);

  const itemStr = await prompt(rl, 'Item to move (number)');
  const itemPrefix = parseInt(itemStr, 10);
  const item = sourceItems.find((i) => i.prefix === itemPrefix);

  if (!item) {
    rl.close();
    console.error(
      `[movetomodule] Error: No item found with number ${itemStr}.`,
    );
    process.exit(1);
  }

  // Destination selection
  console.log('\n--- Destination ---');
  const modules = getExistingModules();
  printModules(modules);

  const destModuleStr = await prompt(rl, 'Destination module (number)');
  const destModulePrefix = parseInt(destModuleStr, 10);
  const destMod = modules.find((m) => m.prefix === destModulePrefix);

  if (!destMod) {
    rl.close();
    console.error(
      `[movetomodule] Error: No module found with number ${destModuleStr}.`,
    );
    process.exit(1);
  }

  const destModulePath = path.join(COURSE_DIR, destMod.folderName);
  const destDir = await selectTargetDir(rl, destModulePath);
  const destItems = getItems(destDir);

  const defaultPos =
    destItems.length > 0 ? destItems[destItems.length - 1].prefix + 1 : 1;
  let position;
  while (true) {
    const posStr = await prompt(rl, 'Position in destination', pad(defaultPos));
    position = parseInt(posStr, 10);
    if (!isNaN(position) && position >= 1 && position <= 99) break;
    console.log(
      '  Position must be a number between 1 and 99. Please try again.',
    );
  }
  rl.close();

  moveEntry(sourceDir, item.name, destDir, position);
}

module.exports = moveToModule;
module.exports._moveEntry = moveEntry;
