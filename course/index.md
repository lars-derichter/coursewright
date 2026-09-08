---
slug: /
title: Write Your Course in Markdown, Publish It Anywhere
sidebar_label: Coursewright
sidebar_position: 0
---

Course material tends to live wherever it was last edited: an LMS editor, a Word
file, a slide deck. **Coursewright** makes plain markdown files on your computer
the one source, and builds every output from it: the website your students read,
the handout you print, the Canvas modules you publish.

This site is the proof: a course built with the tool, live at
[coursewright.md](https://coursewright.md/), previewed and published from its
own repository. Every page of the Getting Started module is
[a markdown file you can read](https://github.com/lars-derichter/coursewright/tree/main/course/01-getting-started).

> [!TIP]
>
> New here? Start with the
> [**Getting Started**](01-getting-started/01-how-this-works.md) module in the
> sidebar.

## The Problem It Solves

An LMS editor is fine for a page or two, and so is a Word file. Maintaining a
whole course that way is another matter: no history, no search and replace
across pages, no offline work, no way to review a change before students see it,
and no way to reuse last year’s material without clicking through it all again.

Coursewright treats your markdown as the source of truth. The website, the
handout and Canvas are where you publish it, in your own time and after your own
review.

## What You Get

- **Your own tools.** Write in VS Code or any editor, keep everything in git,
  and review every change before it goes live.
- **A sidebar that covers the daily work.** The VS Code extension creates
  modules and items, opens the preview, publishes and exports. The tutorial
  teaches every step that way, so the terminal stays optional.
- **Instant preview.** A local website shows your course as you write, in the
  structure students will see. That is what you are looking at now, and one
  GitHub Pages setting turns the same build into a public course website.
- **PDF and Word export.** Hand out a styled course text or a single chapter,
  with your institution’s branding.
- **Two-way Canvas sync.** `npx course sync` reconciles modules, pages,
  assignments, discussions and files both ways, newest change wins, and deletes
  nothing unless you ask. `push` and `pull` pin a direction; `status` previews.
- **AI-assisted authoring on a didactic backbone.** Bundled skills design
  lessons, build student modules, generate quizzes, proofread and check a course
  for consistency, with any coding agent that reads `AGENTS.md`. They start from
  the learning goals, then the assessment that evidences them, then the lessons
  ([didactic foundations](https://github.com/lars-derichter/coursewright/blob/main/docs/didactics.md)).
- **A template that stays updatable.** Create your course from the template and
  keep pulling in tooling improvements; your content is never overwritten.

## Who It Is For

Lecturers and teaching teams who want course material in files, folders and
version control, whatever it ends up published to: a course website, a printed
reader, Canvas, or all three. You do not need to be technical. The tutorial
starts from a computer with nothing installed, and the sidebar means you never
have to type a command. (It names the commands anyway, for those who like
typing.)

It is also opinionated, and honest about it. Every Canvas item type crosses, but
not all of them in the same way: pages, assignments, discussions and files live
in your own files and are rebuilt from them, while a quiz or an external tool
syncs only as a reference to something that stays in Canvas. Quiz questions
never cross at all. And the folder layout is a contract: one folder per module,
one level of nesting, numbered prefixes. Better to know that now than in week
six.

## Start Here

- **[Getting Started](01-getting-started/01-how-this-works.md)**: the tutorial
  module in the sidebar. It takes you from nothing installed to a published
  course: setting up, writing, organising, saving with git, and publishing by
  whichever of the three routes you pick. Every page in it is a working example
  of something the tool can publish.
- **[Your First Course, Step by Step](https://github.com/lars-derichter/coursewright/blob/main/docs/first-course.md)**:
  the same path as one long page, with the per-system detail spelled out.
- **[What It Does Not Do](https://github.com/lars-derichter/coursewright/blob/main/docs/limitations.md)**:
  read this before committing a semester to it.
- **[The project on GitHub](https://github.com/lars-derichter/coursewright)**:
  the code, the documentation, and the **Use this template** button.
- **[The source of this site](https://github.com/lars-derichter/coursewright/tree/main/course/01-getting-started)**:
  compare any page here with the markdown that made it.

The tooling is MIT licensed; the example course content on this site is CC
BY-NC-SA 4.0.
