#!/usr/bin/env node

const { PROJECT_ROOT } = require('./project-root');
require('dotenv').config({
  path: require('path').join(PROJECT_ROOT, '.env'),
  quiet: true,
});

const { Command } = require('commander');
const pkg = require('../package.json');
const log = require('./logger');
const { RefusalError } = require('../lib/errors');
const { guardCourseMatch } = require('./sync-state-guard');

const program = new Command();

program
  .name('course')
  .description('Sync course content with Canvas LMS')
  .version(pkg.version)
  .option('-v, --verbose', 'Show detailed output including API request info')
  .option('-q, --quiet', 'Only show errors')
  .hook('preAction', () => {
    const opts = program.opts();
    log.configure({ verbose: opts.verbose, quiet: opts.quiet });
  })
  // Second, and before any command's action: refuse a sync state that describes
  // another Canvas course. Here rather than in each command because the nine
  // that used to reach the check through `recordRenames` reached it after they
  // had already written to disk, and one of them only sometimes. One hook is
  // also one place to read: `cli/sync-state-guard.js` says which commands are
  // exempt and why. Registered after the logging hook so `--verbose` is already
  // configured if this one throws.
  .hook('preAction', (_program, actionCommand) => {
    guardCourseMatch(actionCommand.name());
  });

program
  .command('setup')
  .description(
    'First-run wizard: course name, language, templates, look, and Canvas',
  )
  .option('--language <lang>', 'Course label language (en, nl)')
  .option('--title <title>', 'Course name')
  .option('--tagline <text>', 'One-line course descriptor')
  .option('--theme <name>', 'Colour theme name or path')
  .option('--export-style <name>', 'Export style folder name or path')
  .option('--readme <copy|keep>', 'Install the course README template')
  .option(
    '--course-home <copy|keep>',
    'Install the course home page template (course/index.md)',
  )
  .option('--course-context <copy|keep>', 'Install the course-context template')
  .option(
    '--writing-style <variant>',
    'Writing style baseline (en, en-us, nl-be, nl, keep)',
  )
  .option(
    '--tutorial <keep|remove>',
    'Keep or remove course/01-getting-started',
  )
  .option('--no-canvas', 'Skip the Canvas connection question')
  .option('-y, --yes', 'Take the answers from the flags and never prompt')
  .action(require('./setup'));

program
  .command('init')
  .description('Interactive setup for Canvas API credentials and sync file')
  .action(require('./init'));

program
  .command('sync')
  .description('Two-way sync with Canvas: newest wins, nothing is deleted')
  .option('--dry-run', 'Show what would happen without writing anything')
  .option('-m, --module <name...>', 'Only sync these module folder names')
  .option('--prune-canvas', 'Delete Canvas items and modules gone locally')
  .option('--prune-local', 'Delete local files and folders gone from Canvas')
  .option('--prune', 'Both --prune-canvas and --prune-local')
  .option(
    '--conflict <policy>',
    'Who wins when both sides changed: newest, local, canvas, ask',
    'newest',
  )
  .option(
    '--order <policy>',
    'Who wins when both sides reordered: local, canvas, ask',
    'ask',
  )
  .option(
    '-y, --yes',
    'Never ask: confirm a prune, and skip conflict and order questions',
  )
  .action(require('./sync'));

program
  .command('push')
  .description('Push local course content to Canvas')
  .option('-m, --module <name>', 'Only push a specific module folder name')
  .option('--dry-run', 'Show what would happen without writing to Canvas')
  .option(
    '--prune-canvas',
    'Delete Canvas modules and items that no longer exist locally',
  )
  // Registered only so the old spelling gets a pointer at the new one; push
  // refuses it. Commander suggests nothing for it on its own.
  .option('--prune', 'Renamed to --prune-canvas')
  .action(require('./push'));

program
  .command('pull')
  .description('Pull course content from Canvas into local markdown files')
  .option('-m, --module <name...>', 'Only pull these module folder names')
  .option('--dry-run', 'Show what would happen without writing anything')
  .option(
    '--prune-local',
    'Delete local files and folders that no longer exist in Canvas',
  )
  .option(
    '-f, --force',
    'Write over local files that hold uncommitted or untracked work',
  )
  .action(require('./pull'));

program
  .command('status')
  .description('Show what a sync would do, without writing anything')
  .option('-m, --module <name...>', 'Only report on these module folder names')
  .action(require('./status'));

program
  .command('new-module')
  .description('Create a new course module folder with _category_.json')
  .option('-n, --name <name>', 'Module name (skips the interactive prompt)')
  .option(
    '-p, --position <number>',
    'Position number (default: after the last module)',
  )
  .action(require('./new-module'));

program
  .command('move-module')
  .description('Move a course module to a different position')
  .option(
    '-m, --module <folder>',
    'Module folder name (with --position, skips the interactive prompts)',
  )
  .option('-p, --position <number>', 'New position')
  .action(require('./move-module'));

program
  .command('rename-module')
  .description('Rename a course module')
  .option(
    '-m, --module <folder>',
    'Module folder name (with --name, skips the interactive prompts)',
  )
  .option('-n, --name <name>', 'New module name')
  .action(require('./rename-module'));

program
  .command('delete-module')
  .description('Delete a course module and renumber remaining modules')
  .option(
    '-m, --module <folder>',
    'Module folder name (skips the interactive prompt)',
  )
  .option(
    '-y, --yes',
    'Confirm deletion without prompting (required with --module)',
  )
  .action(require('./delete-module'));

program
  .command('new-item')
  .description(
    'Create a new item (page, assignment, discussion, url, subsection, file) in a module',
  )
  .option(
    '-m, --module <folder>',
    'Module folder name (with --type, skips the interactive prompts)',
  )
  .option(
    '-s, --subsection <folder>',
    'Subsection folder name within the module',
  )
  .option(
    '-t, --type <type>',
    'Item type: page, assignment, discussion, url, subsection, file',
  )
  .option('-n, --name <name>', 'Item name (required unless --type is file)')
  .option('-p, --position <number>', 'Position (default: after the last item)')
  .option('--url <url>', 'External URL (for type url)')
  .option('--points <number>', 'Points possible (for type assignment)')
  .option('--file <path>', 'Path to the file to add (for type file)')
  .action(require('./new-item'));

program
  .command('move-item')
  .description('Move an item to a new position within its module')
  .option(
    '--path <path>',
    'Path to the item (with --position, skips the interactive prompts)',
  )
  .option('-p, --position <number>', 'New position')
  .action(require('./move-item'));

program
  .command('movetomodule-item')
  .description('Move an item to a different module')
  .option(
    '--path <path>',
    'Path to the item (with --to-module, skips the interactive prompts)',
  )
  .option('--to-module <folder>', 'Destination module folder name')
  .option('--to-subsection <folder>', 'Destination subsection folder name')
  .option(
    '-p, --position <number>',
    'Position in the destination (default: last)',
  )
  .action(require('./movetomodule-item'));

program
  .command('rename-item')
  .description('Rename an item in a module')
  .option(
    '--path <path>',
    'Path to the item (with --name, skips the interactive prompts)',
  )
  .option('-n, --name <name>', 'New item name')
  .action(require('./rename-item'));

program
  .command('delete-item')
  .description('Delete an item from a module and renumber remaining items')
  .option('--path <path>', 'Path to the item (skips the interactive prompts)')
  .option(
    '-y, --yes',
    'Confirm deletion without prompting (required with --path)',
  )
  .action(require('./delete-item'));

program
  .command('merge-items')
  .description('Merge two items in a module into one')
  .option(
    '-s, --source <path>',
    'Source file, appended under its title then deleted (with --target, skips the interactive prompts)',
  )
  .option('-t, --target <path>', 'Path to target file (keeps frontmatter)')
  .option(
    '-y, --yes',
    'Confirm deleting the source without prompting (required with --source and --target)',
  )
  .action(require('./merge-items'));

program
  .command('split-item')
  .description('Split an item at a given line into two files')
  .option(
    '-f, --file <path>',
    'Path to the file to split (with --line, skips the interactive prompts)',
  )
  .option('-l, --line <number>', 'Line number to split at')
  .option(
    '--title <name>',
    'Title for the new second file (only read with --file and --line)',
  )
  .action(require('./split-item'));

program
  .command('validate')
  .description('Check course content for errors before pushing')
  .action(require('./validate'));

program
  .command('search <keyword>')
  .description('Find a word or phrase in your course markdown files')
  .option(
    '-C, --context <lines>',
    'Lines of context to show around each match',
    '2',
  )
  .option('--evaluations', 'Also search the evaluations/ directory')
  .option('--sources', 'Also search the sources/ directory')
  .option('--case-sensitive', 'Match upper/lower case exactly')
  .action(require('./search'));

program
  .command('build-glossary')
  .description(
    'Regenerate module glossary pages from the canonical glossary YAML',
  )
  .option('-m, --module <name>', 'Only rebuild a specific module folder name')
  // No commander default: an unset flag is what tells the command to read the
  // glossary from the project root instead of from the working directory.
  .option(
    '-g, --glossary <path>',
    'Path to the glossary YAML file (default: sources/reference-materials/glossary.yml)',
  )
  .option('--check', 'Do not write; exit non-zero if any page is out of date')
  .action(require('./build-glossary'));

program
  .command('check-links')
  .description(
    'Report relative markdown and image links whose target does not exist',
  )
  .option(
    '--root <folder>',
    'Scan this folder instead of the configured roots (repeatable)',
    require('./check-links').collectRoot,
    [],
  )
  .action(require('./check-links'));

program
  .command('export [paths...]')
  .description(
    'Export course materials to PDF, DOCX or plain markdown (PDF and DOCX need pandoc and typst)',
  )
  .option('-m, --module <folder>', 'Export one full module')
  .option('--toc <file>', 'Export the items listed in a TOC file')
  .option('--flagged', 'Only include items with frontmatter export: true')
  .option('-f, --format <format>', 'Output format: pdf, docx or md', 'pdf')
  .option('-o, --output <path>', 'Output file path')
  .option('--title <text>', 'Title-page title')
  .option('--subtitle <text>', 'Title-page subtitle')
  .option(
    '--style <name|path>',
    'Export style to use, overriding course.config.yml',
  )
  .option('--template <path>', 'Override the Typst template')
  .option('--reference-doc <path>', 'Override the reference.docx')
  .option(
    '--var <key=value>',
    'Pandoc variable (repeatable)',
    require('./export').collectVar,
    {},
  )
  .option('--keep-markdown', 'Also write the intermediate combined markdown')
  .option('--sample', 'Export the kitchen-sink style sample')
  .action(require('./export'));

program
  .command('export-toc')
  .description('Write a TOC file listing course items, for a curated export')
  .option('-m, --module <folder>', 'Only list items from one module')
  .option('--flagged', 'Only list items with frontmatter export: true')
  .option('--title <text>', 'Title for the TOC frontmatter')
  .option('--subtitle <text>', 'Subtitle for the TOC frontmatter')
  .option('-o, --output <path>', 'Output file path (default exports/toc.md)')
  .action(require('./export-toc'));

program
  .command('reset-sync-state')
  .description(
    'Delete .canvas-sync.json and clear any Canvas ids older versions left in course files',
  )
  .action(require('./reset-sync-state'));

program
  .command('reset-canvas')
  .description(
    'Delete all modules, pages, assignments, and files from the Canvas course',
  )
  .option('--dry-run', 'Show what would be deleted without deleting anything')
  .action(require('./reset-canvas'));

// Parse argv explicitly rather than letting commander auto-detect the runtime.
// When the VS Code extension runs this via process.execPath (VS Code's Electron
// binary with an inherited ELECTRON_RUN_AS_NODE=1), commander's electron
// detection slices argv by only one element, leaving the script path as the
// first command and producing "unknown command '.../cli/index.js'". Slicing off
// node + script ourselves and parsing the rest as user args avoids that.
//
// `parseAsync` rather than `parse` for one reason: most of these commands are
// async, and `parse` drops the promise they return, so anything one of them
// rejects with surfaces as an unhandled rejection — a stack dump around the
// message rather than the message. Awaiting it is what gives a rejection
// somewhere to land.
program.parseAsync(process.argv.slice(2), { from: 'user' }).catch((err) => {
  // A refusal is a decision this tool made and can explain — a question that
  // reached the end of its input stream, a sync state describing another
  // Canvas course. It earns the message it was written with and the non-zero
  // exit that stops a pipeline reading the silence as success, and nothing
  // else: the stack frames say where the check lives, which is no help to the
  // person who has to act on it, and printing them makes a deliberate stop read
  // as a crash.
  //
  // Anything else keeps its stack. A TypeError in the planner has no message
  // worth reading and every frame worth keeping, and swallowing it would turn
  // the defects this tool still has into silent one-liners. The class at the
  // throw site is the whole of the distinction — see `lib/errors.js`.
  //
  // `--verbose` still shows the stack for both, because the flag exists to
  // answer "why is it doing that", and a refusal nobody expected is exactly
  // that question.
  if (err instanceof RefusalError) {
    log.error(program.opts().verbose ? err.stack : err.message);
    process.exitCode = 1;
    return;
  }
  throw err;
});
