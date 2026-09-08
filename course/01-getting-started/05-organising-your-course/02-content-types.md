---
title: 📘 Content Types
canvas_type: page
---

A `canvas_type` field at the top of a markdown file, in the frontmatter, says
what kind of Canvas item that file becomes. There are seven. Four hold their
content here: a page, an assignment and a discussion are written in the markdown
body, and a file item wraps a binary you keep in the module. The other three
point at something else: an external URL is a link, and a quiz and an external
tool are references to an object that lives in Canvas and stays there.

Every field each type accepts is in the
[frontmatter reference](https://github.com/lars-derichter/coursewright/blob/main/docs/frontmatter.md).

## Page (Default)

The most common type, and what you get when you leave `canvas_type` out
entirely.

```yaml
---
title: My Page
canvas_type: page
---
```

## Assignment

A Canvas assignment, with grading. `points_possible` sets the maximum score and
`submission_types` how students hand in, while `unlock_at`, `due_at` and
`lock_at` open it, mark it late and close it.

```yaml
---
title: Homework 1
canvas_type: assignment
points_possible: 100
submission_types:
  - online_upload
  - online_text_entry
due_at: "2026-03-20T23:59:00Z"
---
```

## Discussion

A Canvas discussion topic. The markdown body is the opening message, the same
way a page’s body is the page. `discussion_type`, `require_initial_post`,
`delayed_post_at`, `lock_at` and `published` settle the rest.

```yaml
---
title: Week 3 Reading
canvas_type: discussion
discussion_type: threaded
require_initial_post: true
---
```

**Course: New Item** creates one, and so does
`npx course new-item --type discussion`. Both write the title and the
`canvas_type` line; add the settings above yourself when you want them.

Replies stay in Canvas and never come back into your files. That does not put
them out of reach: delete the local file and run `push --prune-canvas`, and the
topic goes with every reply in it.

> [!WARNING]
>
> A **graded** discussion keeps its grading in Canvas. Points, due date and
> grading type belong to the assignment Canvas puts behind the topic, and this
> tool never touches that assignment, so setting those fields here does nothing.

## External URL

A link to an external website, opened in a new tab. Nothing but the link syncs.

```yaml
---
title: MDN Web Docs
canvas_type: external_url
external_url: https://developer.mozilla.org
---
```

## File

A binary uploaded to Canvas as a module item. It comes in two shapes. The
wrapper keeps the binary in the module’s `_files/` folder and points at it from
a markdown file beside your other items:

```yaml
---
title: Workflow Diagram
canvas_type: file
file_ref: _files/workflow-diagram.svg
---
```

The bare file skips the wrapper. Drop the binary straight into the module or
subsection folder with a numeric prefix in front of its name, and it is a file
item as it stands. Dragging a file from Finder or Explorer onto a module in the
tree makes one, and so does `npx course new-item --type file`.

Canvas and the exports take both shapes. The website shows only the wrapper,
because it builds its pages from markdown files, so use the wrapper when the
file has to appear there. This module has three:
[Workflow Diagram](../02-workflow-diagram.md) in the module root, plus this
course [as a PDF](../12-download-this-course/01-course-as-pdf.md) and
[as a Word document](../12-download-this-course/02-course-as-word.md) in the
subsection at the end, which works exactly the same way. Open the Workflow
Diagram and you’ll see the image itself above the download card: image, video
and audio files show their content right on the page.

> [!NOTE]
>
> Over 35 file types are supported, and a pull from Canvas writes every file
> item it finds in the wrapper shape.

## Quiz

A reference, not content. The file says which quiz belongs at this spot in the
module. The questions live in Canvas and never cross in either direction.

```yaml
---
title: "Test 1: Loops and Conditions"
canvas_type: quiz
quiz_ref: evaluations/2526/test-1/test-1.zip
---
```

Push matches the title against the quizzes your Canvas course already has and
places the module item, so build the quiz in Canvas first, or import it there
from a QTI package, and give the file the same title. The optional `quiz_ref`
points at that package, as a path from the project root, so next year’s course
can be rebuilt from it rather than from memory.

## External Tool (LTI)

A link to an LTI tool in the module: a coding platform, a video service, a
plagiarism checker. `external_url` holds the tool’s launch URL, and that URL is
what Canvas resolves the tool from. The tool has to be installed in Canvas
already, by you or by an administrator. Nothing here installs one.

```yaml
---
title: Coding Exercises
canvas_type: external_tool
external_url: https://tool.example.com/lti/launch
---
```

> [!NOTE]
>
> **Course: New Item** and `npx course new-item` offer six types. A quiz and an
> external tool are the two they do not create: write the file yourself with the
> frontmatter above, or copy an existing item and change its `canvas_type`.

## Try It

Open your Scratch page. Replace the `canvas_type: page` line in its frontmatter
with `canvas_type: external_url`, add an `external_url:` line pointing anywhere
you like, and save.

> [!CHECK]
>
> The preview shows a link card instead of a page, and the icon on the tree row
> changes to match.
