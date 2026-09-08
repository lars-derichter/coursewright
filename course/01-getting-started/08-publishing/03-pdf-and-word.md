---
title: 📘 A PDF or Word Handout
canvas_type: page
export: true
---

Sometimes the course has to leave the screen: an exam on paper, a handout for
one lesson, a chapter to read offline. Any page, any module, or your whole
course turns into a polished PDF or an editable Word document, out of the same
markdown. If you only ever publish to the website or to Canvas, skip this page.

> [!NOTE]
>
> This page carries `export: true` in its frontmatter, which is how the flagged
> export picks it up. It marks the handful of pages that belong in a printed
> handout, so you never have to list them again.

## What You Need

Two free tools do the converting: **pandoc** handles the markdown, and **Typst**
turns the result into a PDF. A Word export needs pandoc alone, so if that’s all
you’re after, you’re one download away.

Pandoc has a real installer on every platform: get it from
[pandoc.org/installing.html](https://pandoc.org/installing.html) and
double-click it, the same as any other program.

- **macOS:** a `.pkg` file. There are two, so pick the one that matches your
  Mac: `arm64` for Apple Silicon (M1 or later), `x86_64` for an Intel Mac. Not
  sure which you have? Check Apple menu > **About This Mac**: “Apple M…” means
  Apple Silicon, “Intel” means Intel.
- **Windows:** a `.msi` file. It installs pandoc and adds it to your PATH for
  you, so there’s nothing left to set up afterwards.
- **Linux:** a `.deb` file on Ubuntu or Debian, which opens in your app
  installer when you double-click it. On Fedora, the package is called
  `pandoc-cli`; there’s no `.rpm`.

Typst is the harder one: it ships no installer, on any platform. You get it
through a package manager instead, a tool that installs and updates other
programs for you.

- **macOS:** install [Homebrew](https://brew.sh) first, the usual way to add
  developer tools to a Mac, then run `brew install typst` in a terminal.
- **Windows:** run `winget install --id Typst.Typst` in a terminal. Winget ships
  with Windows 11 and most recent copies of Windows 10, so you probably already
  have it and just need to open a terminal.
- **Linux:** run `sudo snap install typst` in a terminal, or on Ubuntu, search
  for “Typst” in the App Center and click **Install**, no terminal needed.

> [!NOTE]
>
> This is the one part of setup with no click-only route on macOS or Windows:
> Typst genuinely needs a package manager there.

## Exporting

- **One item:** right-click it and choose **Course: Export Item to
  PDF/DOCX...**. Ctrl-click or Cmd-click several rows first and they combine
  into one document, with a title page, a table of contents and a page break
  between chapters.
- **A module:** right-click the module row and choose **Course: Export Module to
  PDF/DOCX...**.
- **The whole course:** open the `…` dropdown in the panel’s title bar and
  choose **Course: Export Course to PDF/DOCX...**. It offers everything, only
  the items flagged `export: true`, or a curated table of contents, which it
  writes to `exports/toc.md` and opens for you to edit. Delete the lines you do
  not want, save, then run **Course: Export via TOC...** from the same dropdown.

You choose PDF or Word each time, and the run happens in the Coursewright
terminal.

> [!TIP]
>
> **Terminal:**
>
> ```bash
> npx course export course/01-getting-started/07-git-workflow.md  # one page
> npx course export -m 01-getting-started    # a whole module
> npx course export                          # the full course
> npx course export --flagged                # only the flagged items
> npx course export -m 01-getting-started -f docx  # Word, not PDF
> ```

## Where Your Files Go

Exports land in `exports/`, which git ignores, so your documents never reach
your repository or Canvas. A whole-course export is titled after your course,
filename included, from `title` in `course.config.yml`; a module export takes
the module’s own name, with the course name under it on the cover.

## Changing How Exports Look

`export.style` in `course.config.yml` picks the layout (fonts, margins, cover)
and `theme` picks the colours, everywhere at once: the preview site, your Canvas
pages and the PDF. Two skills spare you the fiddling: `/export-style-init`
builds a style from a reference you hand it, and `/export-style-update` makes a
plain-language tweak like “headings dark blue”. The
[exporting guide](https://github.com/lars-derichter/coursewright/blob/main/docs/exporting.md)
and the
[export styling guide](https://github.com/lars-derichter/coursewright/blob/main/docs/export-styling.md)
cover the rest.

This course has been through both routes itself. The results sit at the end of
the module, in the **Download This Course** subsection. Everything you are
reading is there as a [PDF](../12-download-this-course/01-course-as-pdf.md) and
as a [Word document](../12-download-this-course/02-course-as-word.md), each one
a file item, which is how a student downloads a handout.

## Try It

1. Install pandoc and Typst as above, if you have not already.
2. Open the `…` dropdown in the panel’s title bar, choose **Course: Export
   Course to PDF/DOCX...**, then pick the flagged items and PDF.

> [!CHECK]
>
> A PDF appears in `exports/`, and its only chapter is this page, because this
> is the one page in the module flagged `export: true`.
