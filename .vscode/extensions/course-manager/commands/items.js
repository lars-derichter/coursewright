const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const { validateWorkspace } = require('../workspace');
const { runCli } = require('../runner');
const {
  activeCourseLocation,
  confirmMerge,
  listEntries,
  pickItemPath,
  pickModuleFolder,
  resolveItemPath,
} = require('../pickers');
const {
  courseLocation,
  newItemTypes,
  seedsDestination,
  validatePoints,
} = require('../helpers');

/**
 * Everything done to one item: making, renaming, reordering, moving it to
 * another module, deleting it, merging two of them and splitting one in half.
 */
function registerItemCommands({ register, workspaceRoot }) {
  // --- Item commands (context-aware) ---

  register('course.newItem', async (treeItem) => {
    if (!validateWorkspace()) return;

    let moduleFolder = treeItem?.moduleFolderName;
    let subsection =
      treeItem?.contextValue === 'subheader'
        ? path.basename(treeItem.folderPath)
        : null;
    if (!moduleFolder) {
      moduleFolder = await pickModuleFolder('Select module for the new item');
      if (!moduleFolder) return;
    }

    // Where the item lands decides which types are on offer: a subsection
    // cannot hold another one. See `newItemTypes`.
    const type = await vscode.window.showQuickPick(
      newItemTypes({ inSubsection: subsection != null }),
      { placeHolder: 'Type of the new item' },
    );
    if (!type) return;

    const args = ['new-item', '--module', moduleFolder, '--type', type.type];
    if (subsection) args.push('--subsection', subsection);

    if (type.type === 'file') {
      const picked = await vscode.window.showOpenDialog({
        canSelectMany: false,
        openLabel: 'Add file',
      });
      if (!picked || picked.length === 0) return;
      args.push('--file', picked[0].fsPath);
    } else {
      const name = await vscode.window.showInputBox({
        prompt: `Name for the new ${type.label.toLowerCase()}`,
        validateInput: (v) => (v.trim() ? null : 'Name is required'),
      });
      if (!name) return;
      args.push('--name', name.trim());

      if (type.type === 'url') {
        const url = await vscode.window.showInputBox({
          prompt: 'URL',
          validateInput: (v) => {
            try {
              new URL(v);
              return null;
            } catch {
              return 'Enter a valid URL';
            }
          },
        });
        if (!url) return;
        args.push('--url', url);
      } else if (type.type === 'assignment') {
        const points = await vscode.window.showInputBox({
          prompt: 'Points possible',
          value: '100',
          validateInput: validatePoints,
        });
        if (points === undefined) return;
        // Cleared box means the pre-filled default, the way the CLI's own
        // prompt reads an empty answer.
        args.push('--points', points.trim() || '100');
      }
    }

    await runCli(args);
  });

  register('course.renameItem', async (treeItem) => {
    if (!validateWorkspace()) return;
    const itemPath = await resolveItemPath(treeItem, 'Select item to rename');
    if (!itemPath) return;
    const currentLabel =
      typeof treeItem?.label === 'string'
        ? treeItem.label
        : path.basename(itemPath);
    const name = await vscode.window.showInputBox({
      prompt: `New name for "${currentLabel}"`,
      value: currentLabel,
      validateInput: (v) => (v.trim() ? null : 'Name is required'),
    });
    if (!name) return;
    await runCli(['rename-item', '--path', itemPath, '--name', name.trim()]);
  });

  register('course.moveItem', async (treeItem) => {
    if (!validateWorkspace()) return;
    const itemPath = await resolveItemPath(treeItem, 'Select item to move');
    if (!itemPath) return;
    const count = listEntries(path.dirname(itemPath)).length;
    const positions = Array.from({ length: count }, (_, i) => String(i + 1));
    const position = await vscode.window.showQuickPick(positions, {
      placeHolder: `New position for ${path.basename(itemPath)} (1-${count})`,
    });
    if (!position) return;
    await runCli(['move-item', '--path', itemPath, '--position', position]);
  });

  register('course.moveItemToModule', async (treeItem) => {
    if (!validateWorkspace()) return;
    const itemPath = await resolveItemPath(treeItem, 'Select item to move');
    if (!itemPath) return;
    // Seed the destination with the active file's module only for an item
    // from elsewhere. For an item already in that module, Enter would run
    // movetomodule-item onto its own module, which appends and gap-closes:
    // a silent move to the end, not a no-op.
    const preselect = seedsDestination(
      courseLocation(workspaceRoot, itemPath),
      activeCourseLocation(),
    );
    const destModule = await pickModuleFolder('Move to which module?', {
      preselect,
    });
    if (!destModule) return;

    const args = [
      'movetomodule-item',
      '--path',
      itemPath,
      '--to-module',
      destModule,
    ];

    // A subsection can't be nested inside another subsection — move it to the
    // module root and skip the sub-section prompt.
    const isSubsection =
      fs.existsSync(itemPath) && fs.statSync(itemPath).isDirectory();

    // Offer subsections of the destination module, when there are any
    const destDir = path.join(workspaceRoot, 'course', destModule);
    const subsections = isSubsection
      ? []
      : listEntries(destDir).filter((e) => e.isDirectory);
    if (subsections.length > 0) {
      const sub = await vscode.window.showQuickPick(
        [{ label: '(module root)', name: null }].concat(
          subsections.map((s) => ({ label: s.name, name: s.name })),
        ),
        { placeHolder: 'Where in the module?' },
      );
      if (!sub) return;
      if (sub.name) args.push('--to-subsection', sub.name);
    }

    await runCli(args);
  });

  register('course.deleteItem', async (treeItem) => {
    if (!validateWorkspace()) return;
    const itemPath = await resolveItemPath(treeItem, 'Select item to delete');
    if (!itemPath) return;
    const isDir =
      fs.existsSync(itemPath) && fs.statSync(itemPath).isDirectory();
    const label =
      path.basename(itemPath) + (isDir ? '/ and all its contents' : '');
    const choice = await vscode.window.showWarningMessage(
      `Delete ${label}?`,
      { modal: true },
      'Delete',
    );
    if (choice !== 'Delete') return;
    await runCli(['delete-item', '--path', itemPath, '--yes']);
  });

  // --- Merge (two-step context menu) ---
  let mergeSource = null;

  register('course.mergeSetSource', (treeItem) => {
    if (!treeItem?.filePath) return;
    mergeSource = treeItem;
    vscode.commands.executeCommand('setContext', 'course.mergeSourceSet', true);
    vscode.window.showInformationMessage(
      `Coursewright: Merge source set to "${path.basename(treeItem.filePath)}". Now right-click the target item.`,
    );
  });

  register('course.mergeWithSource', async (treeItem) => {
    if (!mergeSource?.filePath || !treeItem?.filePath) return;
    if (!validateWorkspace()) return;

    const sourcePath = mergeSource.filePath;
    const targetPath = treeItem.filePath;

    // Before the source is dropped: a cancelled merge leaves it armed, so the
    // author can go straight to another target instead of setting it again.
    if (!(await confirmMerge(sourcePath, targetPath))) return;

    mergeSource = null;
    vscode.commands.executeCommand(
      'setContext',
      'course.mergeSourceSet',
      false,
    );

    await runCli([
      'merge-items',
      '--source',
      sourcePath,
      '--target',
      targetPath,
      '--yes',
    ]);
  });

  register('course.mergeItems', async () => {
    if (!validateWorkspace()) return;
    const sourcePath = await pickItemPath(
      'Source item (appended under its title, then deleted)',
    );
    if (!sourcePath) return;
    // No seed for the target: the active file is the natural source, and
    // offering it first here would point Enter at merging it into itself.
    const targetPath = await pickItemPath(
      'Target item (keeps frontmatter, receives content)',
      { preselect: false },
    );
    if (!targetPath) return;
    if (!(await confirmMerge(sourcePath, targetPath))) return;
    await runCli([
      'merge-items',
      '--source',
      sourcePath,
      '--target',
      targetPath,
      '--yes',
    ]);
  });

  // --- Split at cursor ---
  register('course.splitItem', async () => {
    if (!validateWorkspace()) return;
    const editor = vscode.window.activeTextEditor;
    if (!editor || !editor.document.fileName.endsWith('.md')) {
      vscode.window.showErrorMessage(
        'Coursewright: Open a markdown file and place the cursor on the split line.',
      );
      return;
    }
    if (editor.document.isDirty) {
      await editor.document.save();
    }
    const filePath = editor.document.uri.fsPath;
    const line = editor.selection.active.line + 1; // VS Code is 0-based
    await runCli(['split-item', '--file', filePath, '--line', String(line)]);
  });
}

module.exports = { registerItemCommands };
