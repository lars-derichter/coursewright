const fs = require('fs');
const path = require('path');
const {
  COURSE_DIR,
  prompt,
  getExistingModules,
  resolveOneModule,
  pad,
  toSlug,
  createRL,
  printModules,
  safeReadJSON,
} = require('./module-utils');
const { recordRenames } = require('./sync-renames');

async function renameModule(options = {}) {
  let sourceModule;
  let newName;

  if (options.module && options.name) {
    // Non-interactive mode (VS Code)
    const modules = getExistingModules();
    try {
      const folder = resolveOneModule(
        options.module,
        modules.map((m) => m.folderName),
      );
      sourceModule = modules.find((m) => m.folderName === folder);
    } catch (err) {
      console.error(`[rename-module] Error: ${err.message}`);
      process.exit(1);
    }
    newName = options.name;
  } else {
    const rl = createRL({
      command: 'rename-module',
      flags: '--module and --name',
    });

    console.log('[rename-module] Rename a course module\n');

    const modules = getExistingModules();

    if (modules.length === 0) {
      rl.close();
      console.log('[rename-module] No modules found.');
      return;
    }

    printModules(modules);

    const sourceStr = await prompt(rl, 'Module to rename (number)');
    const sourcePrefix = parseInt(sourceStr, 10);
    sourceModule = modules.find((m) => m.prefix === sourcePrefix);

    if (!sourceModule) {
      rl.close();
      console.error(
        `[rename-module] Error: No module found with number ${sourceStr}.`,
      );
      process.exit(1);
    }

    newName = await prompt(rl, 'New name');
    rl.close();

    if (!newName) {
      console.error('[rename-module] Error: Name is required.');
      process.exit(1);
    }
  }

  const newSlug = toSlug(newName);
  const newFolderName = `${pad(sourceModule.prefix)}-${newSlug}`;
  const oldFolder = path.join(COURSE_DIR, sourceModule.folderName);
  const newFolder = path.join(COURSE_DIR, newFolderName);

  // Rename folder
  if (newFolderName !== sourceModule.folderName) {
    fs.renameSync(oldFolder, newFolder);
  }

  // Update _category_.json
  const categoryFile = path.join(newFolder, '_category_.json');
  if (fs.existsSync(categoryFile)) {
    const category = safeReadJSON(categoryFile);
    category.label = newName;
    fs.writeFileSync(
      categoryFile,
      JSON.stringify(category, null, 2) + '\n',
      'utf8',
    );
  } else {
    const category = { label: newName, position: sourceModule.prefix };
    fs.writeFileSync(
      categoryFile,
      JSON.stringify(category, null, 2) + '\n',
      'utf8',
    );
  }

  recordRenames([
    {
      fromDir: COURSE_DIR,
      renames: [{ from: sourceModule.folderName, to: newFolderName }],
    },
  ]);

  console.log(
    `[rename-module] Renamed ${sourceModule.folderName} -> ${newFolderName}`,
  );
}

module.exports = renameModule;
