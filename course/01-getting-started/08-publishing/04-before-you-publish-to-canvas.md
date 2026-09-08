---
title: ⚠️ Before You Publish to Canvas
canvas_type: page
---

Publishing is the one part of this tool that can lose work, so it gets its own
page before the page that shows you how.

## Treat Every Delete as Final

This tool talks to Canvas through its API, and nothing here undoes a delete. No
command puts a deleted page or assignment back, and your repository cannot help:
git holds every version of what you wrote, and nothing at all of what only ever
existed in Canvas.

Canvas itself is a little less absolute. It has an `/undelete` endpoint that
sometimes brings a deleted assignment back, though the student submissions
frequently do not come with it, so even a recovery that works can be partial.
Treat that as a lifeline, not a plan.

That is fine when the course is empty and yours. It matters when the course
already has content, especially content someone else put there.

> [!IMPORTANT]
>
> Before your first push to a Canvas course that already has anything in it,
> back it up. Canvas → **Settings** → **Export Course Content** → **Course** →
> **Create Export** gives you a file you can re-import. It takes about two
> minutes and it is the only thing standing between a mistake and a bad week.

That covers the sidebar too. **Course: Sync with Canvas**, **Course: Push to
Canvas** and **Course: Pull from Canvas** in the Course Manager title-bar menu
run these same whole-course commands, and the extension asks nothing of its own
before it starts one. A button is quicker to press than a command is to type,
which is exactly why the backup comes first.

The safest way to learn this tool is in a **sandbox course**: an empty Canvas
course nobody is enrolled in. Push to it, break it, push again. Most
institutions hand out sandbox courses on request. When your material looks
right, copy it into the real course from Canvas’s own **Import Course Content**
screen.

## What Push Actually Does

`npx course push` does not merge. It makes Canvas match your files:

- A module folder becomes a Canvas module. A markdown file becomes a page, an
  assignment, a link, or a file, depending on its frontmatter.
- Where the two disagree, your file wins. Push writes your version over the
  Canvas one, never the other way round.
- **What you added by hand in Canvas is not thrown away.** Push matches each
  item in the module against a local file of the same type and title. When it
  finds one, that file takes the Canvas object over and becomes the source of
  its content from then on. When it finds nothing, the item stays exactly where
  it is, and the run lists it at the end. So a quiz, a discussion, or a link to
  an external tool that you placed there yourself survives a push.

Two things can still catch you out. Two items that share a type and a title stop
the matching: push cannot tell which belongs to which, so it claims neither and
asks you to give one a different title. And deleting a local file removes
nothing on Canvas unless you ask for it, which is the next section.

Author locally anyway. Something you add in the Canvas web editor lives in one
place only: it is not in your `course/` folder, so it is not in your git
history, not in your exports, and not in next year’s copy of the course. Your
files are the course. Canvas is where you publish it.

## The Commands That Delete

Two commands delete things on Canvas. A plain push almost never does.

| Command                          | What it removes                                       |
| -------------------------------- | ----------------------------------------------------- |
| `npx course push`                | Nothing, with one small exception (below)             |
| `npx course push --prune-canvas` | Canvas items and modules whose local file you deleted |
| `npx course reset-canvas`        | Every module, page, assignment and file, yours or not |

The exception is renaming the file behind a `canvas_type: file` item. Canvas
keys an upload on its filename, so a new name is a new upload, and push removes
the old one once nothing points at it any more.

`--prune-canvas` and `reset-canvas` both list what they are about to do and ask
before doing it, so read that list. Pruning only reaches items push has synced
before, which means a quiz or a page it has never seen is never on it.

What a deletion costs you depends on what it deletes. An assignment takes its
gradebook column and every submission on it. A discussion takes its replies. A
page or a file costs you content but no grades, and a quiz or an external tool
is only unlinked from the module. Export the gradebook before you prune a course
students have submitted to.

> [!WARNING]
>
> `reset-canvas` is for wiping a scratch course back to empty. Run it on a live
> course and you delete your colleagues’ files along with your own. It tells you
> what the course holds before it asks, so read that line.

## Two Habits Worth Forming

- **Course: Push to Canvas (Dry Run)**, from the command palette, before every
  real push. It reports what would happen and changes nothing. Read it, then run
  the real push. (Terminal: `npx course push --dry-run`.)
- **Course: Validate**, in the panel’s `…` dropdown, whenever something feels
  off. It catches broken internal links, images and downloads that are not where
  a page says they are, frontmatter that will not parse, and items missing a
  field their type needs, while all of that is still cheap to fix. (Terminal:
  `npx course validate`.)

## Try It

1. Take the backup above, or ask your institution for a sandbox course.
2. Open the `…` dropdown in the Course Manager title bar and choose **Course:
   Validate**.

> [!CHECK]
>
> The terminal reports nothing to fix, or names exactly what to fix. Either way
> you now know what you are about to push, so on to
> [Canvas Syncing](./05-canvas-syncing.md).
