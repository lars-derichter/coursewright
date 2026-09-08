# VS Code Integration

This page is the full reference behind the beginner guides:
[your first course](first-course.md) and [the user guide](user-guide.md) name
individual panel actions as they go and point back here for the rest.

Course commands are available in the VS Code command palette (Cmd+Shift+P /
Ctrl+Shift+P). Type "Course:" to filter the list. Seven actions are kept out of
it, because they act on the tree item you clicked and can do nothing without
one: the inline **Push This Module to Canvas** and **Open in Canvas** buttons,
the **Sync This Module with Canvas**, **Pull This Module from Canvas** and
**Status of This Module** entries that sit beside push in a module's right-click
menu, and the two-step **Merge: Set as Source** / **Merge with Source**. The
palette has its own whole-course sync commands, plus **Course: Push Module to
Canvas...** and **Course: Merge Items**, which ask which module or item you
mean.

Other commands are in the palette and nowhere else, and three of those are kept
out of the view on purpose: **Course: Build Glossary**, **Course: Reset Sync
State (Destructive)** and **Course: Reset Canvas (Deletes ALL Canvas Content)**.
The Course Manager view has no entry for any of them, in its title bar or in a
right-click menu, so no stray click in the tree can start one. Both resets run
in the terminal, where the CLI's own y/N questions still gate them.

## Installation

```bash
npm run vscode:install
```

This packages the extension with `@vscode/vsce` and installs it into VS Code.
Requires the `code` CLI to be available on your PATH.

## Sidebar

The extension adds a **Course Manager** panel to the VS Code activity bar (book
icon on the left). It shows a tree view of all modules and items in the
`course/` directory.

When there is nothing to show, the panel carries a short welcome instead of a
blank page. With no folder open it points at **File > Open Folder**; in a
project with no modules yet (no `course/`, or a `course/` whose tutorial module
was removed at setup) it offers **Course: Setup (First-Run Wizard)** as a button
and links the built-in tutorial module, live and in the upstream repository.

### Tree Structure

- **Modules**: shown as folders, labelled from `_category_.json` or derived from
  the folder name. The numeric prefix is shown as a description.
- **Subheaders**: subfolders within a module, shown as collapsible groups.
- **Items**: course pages, assignments, discussions, quizzes, external URLs, LTI
  links, and files. Each of the seven has an icon of its own, chosen by the
  frontmatter `canvas_type`; a file declaring a type outside that set falls back
  to the page icon. Labels come from the frontmatter `title` (the same name
  Canvas and Docusaurus show); the filename is shown in the tooltip. Clicking an
  item opens the file in the editor.

The view title bar carries VS Code's **Collapse All** button, and the tree takes
a multiple selection: Ctrl/Cmd-click or Shift-click several rows and **Course:
Export Item to PDF/DOCX...** combines them into one document, while a drag moves
them as one batch.

### Inline Actions

Hover over a tree item to see inline action buttons:

| Button        | Rows                               | Action                            |
| ------------- | ---------------------------------- | --------------------------------- |
| Cloud upload  | Modules                            | Push that module to Canvas        |
| External link | Modules and every kind of item row | Open the item in Canvas (browser) |

Push is a module-sized operation: `push --module` is the narrowest the CLI goes,
so the cloud button sits on module rows only rather than on an item it could not
push by itself.

"Open in Canvas" takes the Canvas URL from `.env` and the ids from
`.canvas-sync.json`: an item's by the file's path, a module's by its folder
name. Pages, assignments, discussions and quizzes open their own Canvas page,
file items open the Canvas file view, and external URL items open the URL
itself. An LTI link has no page of its own, so it opens as the module item it
is, and a module row opens the course's modules page anchored at that module. A
subheader row has no button: the Canvas text header it becomes has no URL of its
own. An item with no row yet is reported as not pushed rather than guessed at; a
module with no id yet opens the modules page unanchored.

The sidebar's **Course: New Item** creates pages, assignments, discussions,
external URLs, subsections and file items. A quiz or an LTI link is a file you
write yourself: see [Frontmatter](frontmatter.md).

### Context Menu

Right-click a module or item to access management commands. The command acts on
the element you clicked. For the management commands, names, positions, and
confirmation are collected through native VS Code dialogs and the CLI runs in
the background (no terminal pops up); the export and Canvas entries stream their
output in the shared terminal instead:

- **Course: New Item** and **Course: New Module**: create items or modules
- **Course: Rename Item**, **Course: Move Item**, **Course: Rename Module**,
  **Course: Move Module**: rename or reorder items and modules (rename pre-fills
  the current title)
- **Course: Move Item to Module**: move an item to a different module (or one of
  its subsections). Subsections themselves can also be moved, but always to a
  module root: they cannot be nested inside another subsection.
- **Course: Delete Item** and **Course: Delete Module**: delete an item or
  module, after a modal confirmation
- **Merge: Set as Source** / **Merge with Source**, two-step merge: right-click
  the source item first, then right-click the target item to merge them. A modal
  names both files and warns that the source is deleted.
- **Course: Export Item to PDF/DOCX...**: export the item, or **Course: Export
  Module to PDF/DOCX...** for the whole module. Select several items first
  (Ctrl/Cmd-click or Shift-click in the tree) to export them together as one
  combined document. You then pick PDF or Word.
- **Sync This Module with Canvas**, **Push This Module to Canvas**, **Pull This
  Module from Canvas** and **Status of This Module** (module rows only): run
  `sync`, `push`, `pull` or `status` with `--module` set to the module you
  clicked. These stream in the shared terminal rather than running in the
  background: their output is a report to read, and two of them stop for an
  answer. Sync asks which side wins when local and Canvas both reordered the
  module (the `--order` default is `ask`), and whether a path that vanished and
  a new one with the same title in the same folder are one item renamed. Push
  asks before the first push to a Canvas course that already holds content and
  that this project has never pushed to. The background runner would hang on any
  of those, at a prompt nobody can see.

Most of these commands also work from the command palette; you then pick the
module or item from a quick-pick list, with the active editor's module (or the
file itself) offered first and marked as current, so Enter confirms it. The
tree-bound commands named at the top of this page are the exceptions. Either way
the `npx course` CLI does the work, so renumbering and the sync state behave
exactly as they do in the terminal, and the full output of a background command
is in the **Coursewright** output channel (View > Output).

Two row types carry less than the rest. Rename, move and delete are contributed
for pages, assignments, discussions, external URLs, files and subheaders, and
export for the same set minus subheaders, so a quiz or an LTI link offers the
**Open in Canvas** button and no menu entry of its own: the file names a Canvas
object rather than holding anything to rename or export. The two merge halves
are narrower still: pages and assignments only, since a merge deletes the source
item, and on a discussion that takes the Canvas topic and its replies with it.
The palette reaches all of them: its pickers list a module's entries by
filename, whatever type each one declares.

One command sits in the editor's right-click menu instead of the tree's:
**Course: Split Item at Cursor**, offered on any markdown file inside `course/`.
It splits the file at the line the cursor is on, saving it first if it has
unsaved changes, so it needs an open editor rather than a tree row. It is in the
palette too.

### Drag and Drop

Drag tree items to reorder them:

- **Modules**: drag a module onto another module to change its position. All
  modules are renumbered sequentially.
- **Items**: drag an item within the same module to reorder, or drag it onto a
  different module or subheader to move it there. Both source and target
  directories are renumbered automatically.
- **Subsections**: drag a subheader onto another module to move it there, or
  onto a sibling subheader / top-level item to reorder it within the module
  root. Subsections are never nested, so dropping one onto an item that lives
  inside a subsection is ignored.
- **External files**: drag files from Finder or Explorer onto a module,
  subheader, or item to add them as file items at that location.
- **Several rows at once**: select rows with Ctrl/Cmd-click or Shift-click and
  drag the selection onto a module or subheader to append the batch there, or
  onto an item to give the batch that item's slot. The whole batch is checked
  before anything moves, and a drag mixing modules with items, or carrying more
  than one module, is refused with a message saying why.

Drops are translated into the corresponding CLI commands (`move-module`,
`move-item`, `movetomodule-item`, `new-item --type file`), so Canvas sync state
stays correct and the next push picks the changes up cleanly.

### Auto-Refresh

The tree refreshes automatically when files in `course/` are created, deleted,
or modified. Use the refresh button in the view title bar to manually refresh.

### Title Bar Menu

The title bar carries four buttons, in this order: **Course: New Module**, which
asks for a name and adds the module after the last one; **Course: Search...**,
which asks for a word or phrase and shows all matches (with context) in the
terminal; **Course: Preview**, which starts the Docusaurus dev server (if not
already running) and opens the course in the browser; and **Course: Refresh
Tree**, above. The dropdown repeats **Course: Preview** and adds **Course: Sync
with Canvas**, **Course: Push to Canvas**, **Course: Pull from Canvas**,
**Course: Status** and **Course: Validate** for quick access to sync commands,
plus **Course: Export Course to PDF/DOCX...**, a quick pick to export the full
course, only flagged items, or a curated selection via a table of contents.
Choosing the TOC option opens the generated list for editing and reveals
**Course: Export via TOC...** once it is ready.

## Commands

### Setup

| Command                          | Description                                    |
| -------------------------------- | ---------------------------------------------- |
| Course: Setup (First-Run Wizard) | Course name, language, templates, look, Canvas |
| Course: Init (Canvas Setup)      | Interactive Canvas API setup                   |

### Sync

| Command                            | Description                                |
| ---------------------------------- | ------------------------------------------ |
| Course: Sync with Canvas           | Two-way sync: newest wins, nothing deleted |
| Course: Sync with Canvas (Dry Run) | Preview a sync without writing anything    |
| Course: Push to Canvas             | Push all modules to Canvas                 |
| Course: Push to Canvas (Dry Run)   | Preview push without making changes        |
| Course: Push Module to Canvas...   | Pick a module from a list and push it      |
| Course: Pull from Canvas           | Pull Canvas course into local markdown     |
| Course: Pull from Canvas (Dry Run) | Preview a pull without writing anything    |
| Course: Status                     | Compare local vs Canvas state              |
| Course: Validate                   | Check course content for errors            |
| Course: Check                      | Run every pre-ship check in the terminal   |

### Module Management

| Command               | Description                                        |
| --------------------- | -------------------------------------------------- |
| Course: New Module    | Create a module after the last one (asks the name) |
| Course: Move Module   | Move a module to a different position              |
| Course: Rename Module | Rename a module                                    |
| Course: Delete Module | Delete a module and renumber remaining             |

### Item Management

| Command                      | Description                                                           |
| ---------------------------- | --------------------------------------------------------------------- |
| Course: New Item             | Create a page, assignment, discussion, url, subsection, or add a file |
| Course: Move Item            | Reorder an item within its module                                     |
| Course: Move Item to Module  | Move an item to a different module                                    |
| Course: Rename Item          | Rename an item                                                        |
| Course: Delete Item          | Delete an item and renumber remaining                                 |
| Course: Merge Items          | Merge two items into one                                              |
| Course: Split Item at Cursor | Split the active file at the cursor into two files                    |

### Search

| Command           | Description                               |
| ----------------- | ----------------------------------------- |
| Course: Search... | Find a word or phrase across course files |

### Export

| Command                              | Description                                              |
| ------------------------------------ | -------------------------------------------------------- |
| Course: Export Item to PDF/DOCX...   | Export the selected item(s): multi-select combines them  |
| Course: Export Module to PDF/DOCX... | Export a whole module                                    |
| Course: Export Course to PDF/DOCX... | Export the full course, only flagged items, or via a TOC |
| Course: Export via TOC...            | Render the curated `exports/toc.md` after editing it     |

See [export styling](export-styling.md) for customising fonts, colours, and
margins.

### Preview and the Tree

| Command              | Description                                             |
| -------------------- | ------------------------------------------------------- |
| Course: Preview      | Start the Docusaurus dev server and open the course     |
| Course: Refresh Tree | Rebuild the sidebar tree by hand, when a watcher missed |

### Advanced

Palette only, by design: see the top of this page. Read
[Advanced commands](advanced-commands.md) and
[Backing up a Canvas course](backups.md) first.

| Command                                           | Description                                              |
| ------------------------------------------------- | -------------------------------------------------------- |
| Course: Build Glossary                            | Regenerate module glossary pages from the glossary YAML  |
| Course: Reset Sync State (Destructive)            | Delete `.canvas-sync.json` and the ids left in files     |
| Course: Reset Canvas (Deletes ALL Canvas Content) | Delete every module, page, assignment and file on Canvas |

## Settings

One setting, under **Course Manager** in the settings UI:

| Setting                     | Default | What it does                 |
| --------------------------- | ------- | ---------------------------- |
| `courseManager.previewPort` | `3000`  | The port the preview runs on |

**Course: Preview** starts the dev server with `npm start -- --port <port>` and
opens that port in the browser, so set it when something else on the machine
already holds 3000. It is read on every run, so a change takes effect on the
next preview rather than after a reload. A value that is not a port number
between 1 and 65535 (a float, a boolean, `0`, a string like `"007"`) draws a
warning naming the value, and the preview falls back to 3000; a plain digit
string such as `"3001"` is accepted, because that is the mistake a settings file
invites.

## How It Works

- Commands whose output is a report to read run in a shared **Coursewright**
  terminal: Setup, Init, Sync, Push, Pull, Status, Validate, Build Glossary, the
  two reset commands, the three dry runs, Search, Push Module, the four
  module-scoped Canvas actions on a module row, and all four export commands.
  One step inside Export Course is the exception: choosing the table-of-contents
  option writes `exports/toc.md` through the silent runner and opens it for
  editing; only the render that follows, from **Course: Export via TOC...**,
  reaches the terminal. The terminal is also where the two resets ask their y/N
  question, Reset Canvas after printing an inventory of what it is about to
  delete.
- A terminal that is still running something is never reused: while Sync waits
  for an answer about a reordering both sides made, a second command would be
  typed straight into that prompt as its answer. The next command opens
  **Coursewright 2**, and so on up to five, before falling back to the most
  recently used one. Idle terminals are reused, lowest number first, and a
  closed terminal frees its number. Preview keeps a terminal of its own, outside
  that pool.
- Structural commands (new/rename/move/delete, merge, split, and every drag and
  drop) run the CLI silently in the background instead, and report three ways. A
  run that succeeds puts the last line of its output in the status bar for five
  seconds and refreshes the tree. A run that fails raises an error notification
  carrying the first line of the error, with a **Show Log** button that opens
  the **Coursewright** output channel. A run that succeeds and still writes to
  standard error raises a warning notification with the same button, because a
  warning that only reached the log would go unread: the case this exists for is
  a delete whose renumbering strands a Canvas object. The full output is in that
  channel either way.
- Background runs are serialised: one at a time, in the order they were started,
  because two of them would renumber the same directory and rewrite
  `.canvas-sync.json` on top of each other. A ten-row drop is ten queued runs.
  Whatever is outstanding shares one status-bar spinner, which appears only once
  something has been running (or waiting) for longer than three quarters of a
  second, and goes away when the last run settles. A run that has not finished
  in five minutes is killed.
- The background runner needs `cli/index.js` in the open folder and says so by
  name when there is none: "No cli/index.js in this workspace, so there is no
  course CLI to run. Open the course project folder itself." Nothing is spawned
  in that case. The extension ships inside the course project, beside the CLI it
  drives, so a folder without one is not a course project.
- The workspace check blocks on one thing. `validateWorkspace` stops a command
  when no workspace folder is open at all; a workspace with no `course/`
  directory only draws a warning pointing at Setup, and the command runs
  regardless. Setup, Init and the two reset commands are exempt from the check
  altogether, because none of them reads `course/`: Setup is the command the
  warning names, so firing it during a Setup run would interrupt the run that
  answers it.
- **Course: Push Module to Canvas...** presents a quick-pick list of all module
  folders so you can select which one to push, with the active file's module
  listed first.
- **Course: Preview** checks whether the Docusaurus dev server is already
  running on the configured port. If not, it starts `npm start -- --port <port>`
  in a Preview terminal and opens the browser as soon as the server responds, or
  gives up after two minutes and points at that terminal.
- The extension ships no dependencies. Everything it needs lives in its own
  JavaScript files, because the installed extension sits in
  `~/.vscode/extensions` with no `node_modules` beside it, and resolving a
  package from the opened workspace instead would let any folder you open run
  code in the extension host. That is why `helpers.js` parses `.env` itself
  instead of calling `dotenv`, which the CLI uses for the same file. A test
  keeps the two in step: it runs the shapes a hand-edited `.env` takes through
  both readers and pins the handful where they still differ, so CI reports it if
  either side moves.
