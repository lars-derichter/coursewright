---
title: 📘 Folder Layout
canvas_type: page
---

All your course content lives in the `course/` folder. How you organise files
and folders here decides where everything appears in every output, with no
configuration at all.

## Module Folders

Each top-level folder in `course/` becomes a Canvas module:

```
course/
  01-getting-started/     -> Module: "Getting started"
  02-html-css/            -> Module: "Html css"
  03-javascript/          -> Module: "Javascript"
```

The two-digit prefix (`01`, `02`, …) controls the order. It is stripped when
generating the display title, hyphens become spaces, and only the first word is
capitalised, so `01-getting-started` becomes “Getting started”. Give the folder
a `_category_.json` label when you want the module to read differently.

## Items Inside a Module

Files inside a module folder become module items:

```
course/01-getting-started/
  _category_.json         -> Module metadata (label, position)
  01-introduction.md      -> Page: "Introduction"
  02-setup-guide.md       -> Page: "Setup guide"
  03-first-project.md     -> Assignment: "First project"
```

The same numbering convention applies: prefix controls order, and is stripped
from the title. A `title:` field in the file’s frontmatter overrides the derived
one.

## Subsections (Subfolders)

A subfolder inside a module becomes a **SubHeader** in Canvas, which groups
related items under a heading:

```
course/01-getting-started/
  01-introduction.md
  02-core-concepts/           -> SubHeader: "Core concepts"
    _category_.json
    01-variables.md           -> Indented page: "Variables"
    02-functions.md           -> Indented page: "Functions"
  03-summary.md
```

Items inside a subsection appear indented under the SubHeader in Canvas. A
subfolder can carry a `_category_.json` file of its own, exactly like a module
folder, and it is optional in both places.

## The `_category_.json` File

```json
{
  "label": "Getting Started",
  "position": 1
}
```

Optional, and only needed when the folder name is not the title you want:
`label` is that title, on Canvas, in the preview and in an export. The website
also reads `position` and prefers it over the numeric prefix, so keep the two in
step if you edit by hand. Every command that renumbers folders already does.

## Files That Start With an Underscore

A file or folder whose name starts with `_` is never an item. `_files/` holds
the images and downloads a module embeds, `_category_.json` names a folder
without becoming a page, and a page called `_draft.md` stays out of every output
until you drop the underscore.

## Try It

This one carries on over the next two pages, so leave what you make in place.

1. Right-click the **Getting Started** module in the tree and choose **Course:
   New Item**. Pick **page** and call it `Scratch`. It lands at the end of the
   module.
2. Watch it appear in the tree and in the sidebar of the preview.
3. In VS Code’s Explorer, rename the file to `_99-scratch.md`. Then rename it
   back.

> [!TIP]
>
> **Terminal:** `npx course new-item` asks the same questions, plus one the
> panel does not: which position to give the new page.

> [!CHECK]
>
> The page disappears from the tree and the sidebar under its underscore name,
> and comes back without restarting anything.
