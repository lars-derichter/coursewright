---
title: 📘 How This Works
canvas_type: page
---

You are looking at a course built with Coursewright. Every page in this module
is a plain markdown file in a folder on a computer. The same files are published
as this website, exported as a PDF or Word handout, or pushed to Canvas.

This module walks you through doing that yourself. Work through it in order:
each page assumes the one before it. Every step happens in the VS Code sidebar,
with the terminal command named alongside it for anyone who would rather type.

## The Three Places Your Course Lives

- **Your computer** is where you write. Markdown files in a `course/` folder,
  one folder per module, edited in VS Code or any editor you like.
- **The preview** is this website. **Course: Preview** in the sidebar starts it
  (terminal: `npm start`), and it updates as you type, so you see what you are
  making before anyone else does.
- **Where students read it** is your choice: the course website, a printed or
  downloaded handout, or Canvas. All three are built from the same files.

Your files are the source of truth. The website, the handout and Canvas are each
a place you publish them to, the way a printed book is one output of a
manuscript and never the manuscript itself.

## What That Buys You

- **A history.** Every version of every page, and the ability to go back.
- **Search and replace** across the whole course, in seconds.
- **Offline work.** Trains, planes, and buildings with bad wifi.
- **Review before publishing.** You see exactly what will change, and decide.
- **Reuse.** Next year’s course starts from this year’s files, not from clicking
  through Canvas.

## What You Will Do in This Module

1. Install what you need, make your own copy of the project, and set up the
   Course Manager sidebar.
2. Write pages in markdown, with headings, images, code and coloured callouts.
3. Organise them into modules and subsections, and learn which file becomes
   which kind of item.
4. Create, move, rename, merge and split items.
5. Save your work with git.
6. Publish by one of three routes: a course website, a PDF or Word handout, or
   Canvas (that one after a backup, which matters more than it sounds).
7. See what an AI assistant can do with all of this.
8. Do a small practice assignment, which is itself a Canvas assignment published
   from a file.
9. Join a discussion, which is itself a Canvas discussion published from a file.

> [!TIP]
>
> Nothing here is permanent. The whole module can be removed from your course
> with one answer during **Course: Setup (First-Run Wizard)** (terminal:
> `npx course setup`), and it stays readable at
> [coursewright.md](https://coursewright.md/) afterwards.

## A Word on the Signs

The page titles in this module start with a small sign that says what kind of
page it is. Here is the legend:

- 📘 explanation or reference
- ⚙️ setup
- 📦 a file to download
- 📖 something to read elsewhere
- ⚠️ important
- ❗️ an assignment
- 📅 has a deadline
- 💬 a discussion

The signs are a convention from this project’s writing style guide, which has a
longer list to pick from. Use them in your own course or leave them out. Either
way they live on the title, and the title is the heading students read at the
top of the page. They never turn up in the headings inside the page, and never
in the text.

## A Word on the Numbers

Every file and folder starts with a two-digit number: `01-`, `02-`, and so on.
That number sets the order, in this preview and in Canvas, and it is stripped
from the title students see. You will meet the rest of the naming rules in
[Folder Layout](./05-organising-your-course/01-folder-layout.md).

## Try It

1. Click **How This Works** in the Course Manager tree to open this file in the
   editor.
2. Change one word in the first paragraph and save.
3. If the preview is not running yet, press **Course: Preview** in the panel’s
   title bar.

> [!TIP]
>
> **Terminal:** `npm start` runs the same preview.

> [!CHECK]
>
> The page in your browser shows your change within a second or two.
