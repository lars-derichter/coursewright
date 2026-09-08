---
title: ⚙️ The Course Manager
canvas_type: page
---

The Course Manager extension ships with your project and puts your course in VS
Code’s sidebar, so every step from here on is a click, with the terminal there
for anyone who would rather type. Your project folder should be the one open in
VS Code before you start.

## Installing the Extension

Open VS Code’s terminal with **Ctrl+`** and run:

```bash
npm run vscode:install
```

Then run **Developer: Reload Window** from the command palette. Do both again
whenever the extension is updated. This is the one command everybody types; the
rest of this page is buttons.

## The Panel

Click the book icon in the activity bar, down the left edge of the window. The
panel shows your course as a tree: modules, the subsections inside them, and the
items inside those, each with an icon for its type. Labels come from the `title`
in each file’s frontmatter, so the tree, the website and Canvas all say the same
thing. Click a row and the file opens in the editor.

The tree keeps itself up to date as files change. **Course: Refresh Tree** is
there for the odd miss. Before you have any modules at all, the panel shows a
short welcome instead, with a button that starts the setup wizard.

### The Title Bar

Four buttons sit at the top of the panel:

- **Course: New Module**: add a module after the last one, asking for a name.
- **Course: Search...**: find a word or phrase across your course files.
- **Course: Preview**: open the course website in your browser.
- **Course: Refresh Tree**: rebuild the tree by hand.

The `…` dropdown beside them holds the whole-course commands: **Course: Sync
with Canvas**, **Course: Push to Canvas**, **Course: Pull from Canvas**,
**Course: Status**, **Course: Validate** and **Course: Export Course to
PDF/DOCX...**. **Course: Export via TOC...** joins them once you have a table of
contents to render. The pages that follow explain what each one does.

### Hover Buttons

Hover a module row and two small buttons appear: **Push This Module to Canvas**
(the cloud) and **Open in Canvas** (the link). Item rows carry the link button
only. An item you have not pushed yet has nothing to open, and the extension
says so rather than guessing.

### Right-Click

Right-click a row for the commands that act on it.

- **Creating:** **Course: New Item** on a module or a subsection, **Course: New
  Module** on a module.
- **Editing:** **Course: Rename Item**, **Course: Move Item** and **Course: Move
  Item to Module**, plus **Merge: Set as Source** and **Merge with Source** on
  page and assignment rows. Modules have **Course: Rename Module** and **Course:
  Move Module**.
- **Removing:** **Course: Delete Item** and **Course: Delete Module**, each
  behind a confirmation.
- **Exporting:** **Course: Export Item to PDF/DOCX...**, and **Course: Export
  Module to PDF/DOCX...** on a module row.
- **Canvas:** **Sync This Module with Canvas**, **Push This Module to Canvas**,
  **Pull This Module from Canvas** and **Status of This Module**, module rows
  only.

[Managing Modules and Items](../06-managing-modules-and-items.md) walks through
the tasks themselves. This is only the map.

### Drag and Drop

Drag an item within its module to reorder it, or onto another module or
subsection to move it there. Subsections travel the same way, and a module
dropped onto another module changes position. Select several rows first and the
whole selection moves together, though a selection mixing modules with items is
refused with a message saying why. Files dragged in from Finder or Explorer
become file items, appended at the end of whatever you dropped them on.

### The Command Palette

Press **Cmd+Shift+P** (macOS) or **Ctrl+Shift+P** (Windows, Linux) and type
**“Course:”** to filter the list down to these commands. A few live here and
nowhere else: **Course: Setup (First-Run Wizard)**, **Course: Init (Canvas
Setup)**, the three dry runs, **Course: Push Module to Canvas...**, and
**Course: Split Item at Cursor**, which is also in the editor’s own right-click
menu. With a file from a module open, the palette offers that module first.

> [!WARNING]
>
> Three more are palette-only on purpose, so that no stray click in the tree can
> start one: **Course: Build Glossary**, **Course: Reset Sync State
> (Destructive)** and **Course: Reset Canvas (Deletes ALL Canvas Content)**.
> Both resets ask you to confirm in the terminal, and Reset Canvas empties your
> Canvas course. Read the
> [backups guide](https://github.com/lars-derichter/coursewright/blob/main/docs/backups.md)
> and the
> [advanced commands guide](https://github.com/lars-derichter/coursewright/blob/main/docs/advanced-commands.md)
> before you touch either.

## Where the Output Goes

The management commands (new, rename, move, delete, merge, split) run quietly in
the background, one at a time. A spinner appears in the status bar, the last
line of output lands beside it when the command finishes, and anything that went
wrong raises a notification with a **Show Log** button that opens the
**Coursewright** output channel.

Everything else opens the shared **Coursewright** terminal: setup, init, sync,
push, pull, status, validate, search, the dry runs and every export. That is
where you read the report and answer the questions the CLI asks. Preview keeps a
terminal of its own and runs on port 3000, which you can change with the
`courseManager.previewPort` setting.

> [!NOTE]
>
> Every command and every setting in full is in the
> [VS Code guide](https://github.com/lars-derichter/coursewright/blob/main/docs/vscode.md).

## Try It

1. Open the Course Manager panel and click any page to open it in the editor.
2. Hover the **Getting Started** module row and find the two buttons that
   appear.
3. Press **Course: Preview** in the panel’s title bar.

> [!CHECK]
>
> A browser tab opens on this course, and the terminal panel shows the dev
> server running.
