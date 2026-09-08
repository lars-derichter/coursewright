# Frontmatter Reference

Every markdown file in `course/` uses YAML frontmatter to define its Canvas type
and metadata.

Four types hold their content here: a page, an assignment and a discussion are
written in the markdown body, and a file item wraps a binary. Three do not: a
quiz and an external tool are references to something that lives in Canvas, and
an external URL is a link. `npx course new-item` creates pages, assignments,
discussions, external URLs, subsections and file items; for a quiz or an
external tool, write the file yourself with the frontmatter below.

## Common Fields

| Field         | Type    | Description                                                                                                                                                                                                                                                |
| ------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `title`       | string  | The page heading on the site, on Canvas and in every export, and the item's display title on Canvas. The body never repeats it. Derived from the filename if omitted, and written into your file the first time a run creates or adopts the Canvas object. |
| `canvas_type` | string  | One of `page`, `assignment`, `discussion`, `quiz`, `external_url`, `external_tool`, `file`. Defaults to `page`.                                                                                                                                            |
| `export`      | boolean | Set `true` to include this item in `npx course export --flagged`. See [Exporting](exporting.md).                                                                                                                                                           |

That `title:` line is spliced in as text; nothing else in the file is touched,
and a file that already declares a title is left alone. `push` writes it too,
the one thing `push` puts in your working tree: without it the Canvas item's
name would keep tracking the filename, and renumbering a module would quietly
rename items in Canvas. See
[One Engine, Four Commands](user-guide.md#one-engine-four-commands).

One file cannot take it: one whose opening `---` has no closing fence. There is
no frontmatter block to add a line to, so the run warns and moves on.

```text
  [sync] Left the frontmatter of 01-intro/02-variables.md alone: its opening "---" has no closing fence this could read, so there is nowhere to add a title. Add one by hand, or the Canvas item keeps taking its name from the filename.
```

No field here says which Canvas object a file became. That link lives in
`.canvas-sync.json`, keyed by the file's path under `course/`. A `canvas_id` key
in frontmatter is not part of the format: the tool ignores it, and pull strips
it.

Only the fields listed on this page reach Canvas; push ignores the rest
silently, and [Limitations](limitations.md#which-fields-reach-canvas) says what
that leaves out. Pull takes those same fields from Canvas, including clearing
one that Canvas no longer has, and carries over every other key you added:
`export`, `lesson`, anything of your own. `quiz_ref` is one of those: Canvas has
never heard of the QTI package, so a pull leaves the path exactly as you wrote
it.

## Page

```yaml
---
title: Getting Started
canvas_type: page
---
```

Pages are the default type. The `canvas_type` field can be omitted.

| Field      | Type    | Default       | Description                                                                                                                                                                                                       |
| ---------- | ------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `download` | boolean | `false`       | Force inline `.html` links on this page to download in the local preview instead of opening in a new tab. Only affects Docusaurus; Canvas links are unchanged. See [Markdown](markdown.md#linking-to-html-files). |
| `lesson`   | number  | module prefix | Glossary pages only: the lesson number the generated glossary renders up to (`npx course build-glossary`). Without it, the module's numeric prefix is used.                                                       |

## Assignment

```yaml
---
title: Lab 1
canvas_type: assignment
points_possible: 100
submission_types:
  - online_upload
due_at: 2026-03-20T23:59:00Z
published: true
---
```

| Field              | Type     | Default | Description                                                                                                                           |
| ------------------ | -------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `points_possible`  | number   | –       | Maximum score for the assignment.                                                                                                     |
| `submission_types` | string[] | –       | How students submit. Options: `online_upload`, `online_text_entry`, `online_url`, `media_recording`, `none`. Multiple values allowed. |
| `due_at`           | string   | –       | Due date in ISO 8601 format (e.g. `2026-03-20T23:59:00Z`).                                                                            |
| `lock_at`          | string   | –       | Date after which submissions are no longer accepted. ISO 8601.                                                                        |
| `unlock_at`        | string   | –       | Date when the assignment becomes available. ISO 8601.                                                                                 |
| `published`        | boolean  | –       | Whether the assignment is visible to students.                                                                                        |

## Discussion

```yaml
---
title: Week 3 Reading Discussion
canvas_type: discussion
discussion_type: threaded
require_initial_post: true
published: true
---

Post your answer to the two questions below before Friday.
```

The markdown body is the discussion's opening message, exactly as a page's body
is the page. Push creates and updates the topic; pull brings the message back
into markdown. Replies stay in Canvas and never appear here.

| Field                  | Type    | Default | Description                                                                                       |
| ---------------------- | ------- | ------- | ------------------------------------------------------------------------------------------------- |
| `discussion_type`      | string  | –       | `threaded` (replies to replies), `not_threaded`, or `side_comment`. Canvas decides when left out. |
| `require_initial_post` | boolean | –       | Students must post before they can read other replies.                                            |
| `delayed_post_at`      | string  | –       | When the topic becomes visible. ISO 8601.                                                         |
| `lock_at`              | string  | –       | When the topic closes for new posts. ISO 8601.                                                    |
| `published`            | boolean | –       | Whether the topic is visible to students.                                                         |

> [!WARNING]
>
> A **graded** discussion keeps its grading in Canvas. Points, due date, grading
> type and group set belong to the assignment Canvas puts behind the topic, and
> nothing here reads or writes it: those keys have no effect in this file. Push
> and pull both warn when the topic they touched is graded. A prune deletes a
> discussion whose local file you deleted, replies and grades included; the
> listing flags a topic that holds replies or grades before you confirm. See
> [What the warnings tell you](limitations.md#what-the-warnings-tell-you).

## Clearing a Date

The five date fields above (`due_at`, `lock_at` and `unlock_at` on an
assignment, `delayed_post_at` and `lock_at` on a discussion) are the only fields
where deleting the value and never having written one mean different things.

Empty the key and the date is cleared on Canvas:

```yaml
due_at:
```

Leave the key out altogether and Canvas keeps whatever date it has. That is the
safe reading for a course whose frontmatter has never mentioned a date, and it
has to be the reading, because nothing else can hold the distinction: a sync row
stores a hash of the whole file rather than the values in it, so the engine can
see that a file changed but never that the change was a date going away. The
frontmatter is the only place the difference can be written down.

All three spellings of empty clear the date, because a YAML author does not
think of them as three things:

```yaml
due_at:
due_at: null
due_at: ''
```

The emptied key does not survive a pull, and does not need to. Canvas answers
with no date, so nothing is written back, and what is left is a file with no
`due_at` and an assignment with no due date. The two sides agree, which is what
the emptied key was asking for.

## Quiz

```yaml
---
title: "Test 1: Loops and Conditions"
canvas_type: quiz
quiz_ref: evaluations/2526/test-1/test-1.zip
---
```

A quiz file is a reference. It says which quiz belongs at this position in the
module; it holds no questions and never will. Push places the module item and
leaves the quiz object alone: no create, no update, no delete. The quiz holds
questions and submissions that nothing here could rebuild.

| Field      | Type   | Description                                                                                                                  |
| ---------- | ------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `quiz_ref` | string | Path to the QTI `.zip` the quiz was built from, **resolved from the repository root** (the package lives outside `course/`). |

Two things about this file are load-bearing:

- **The title is the matching key, and only until the sync state holds an id.**
  A quiz item with no row is matched to a quiz by exact title and the id it
  finds is recorded in `.canvas-sync.json`; every later push goes straight to
  the id, so a rename in Canvas breaks nothing once the row exists, and breaks
  the match before it. No match and an ambiguous match are refusals, not
  guesses. [Limitations](limitations.md#quiz-questions-never-sync) has the full
  resolution order and both failure cases.
- **`quiz_ref` is the rollover insurance, not a push requirement.** An item the
  sync state already ties to a quiz is placed whatever `quiz_ref` says. The path
  matters when the quiz is not in the course yet: it names the package to import
  by hand, and the refusal quotes the import procedure with that filename in it.
  `npx course validate` warns about a quiz with no `quiz_ref` (a quiz pulled
  from Canvas has none, which is valid but not rebuildable) and errors on a
  `quiz_ref` pointing at a file that is not there.

The [`/quiz-build`](ai-assistants.md) skill produces the `.zip` under
`evaluations/`. Canvas has no API for a QTI import, so that step stays manual:
**Settings > Import Course Content > QTI .zip file**.

## External URL

```yaml
---
title: Canvas Documentation
canvas_type: external_url
external_url: https://canvas.instructure.com/doc/api/
new_tab: true
---
```

| Field          | Type    | Default | Description                                                                         |
| -------------- | ------- | ------- | ----------------------------------------------------------------------------------- |
| `external_url` | string  | –       | **Required.** The URL to link to. Must be a valid absolute URL.                     |
| `new_tab`      | boolean | `true`  | Open the link in a new browser tab. Set `false` to open it inside the Canvas frame. |

External URL items appear in the Canvas module as clickable links. They have no
markdown body.

## External Tool (LTI)

```yaml
---
title: Coding Exercises
canvas_type: external_tool
external_url: https://tool.example.com/lti/launch?course=pf
new_tab: false
---
```

An LTI item launches a tool installed in Canvas: a coding platform, a video
service, a plagiarism checker. Like an external URL it is nothing but a module
item, with no markdown body.

| Field          | Type    | Default        | Description                                                                                                                             |
| -------------- | ------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `external_url` | string  | –              | **Required.** The tool's launch URL. This, not a tool id, is what Canvas resolves the tool from.                                        |
| `new_tab`      | boolean | Canvas decides | Launch in a new browser tab. Left out, the field is not sent and Canvas's own default applies (the tool opens inside the Canvas frame). |

Before it creates the item, push asks Canvas whether any installed tool claims
that launch URL, because the failure is otherwise invisible: Canvas accepts the
item, returns no error, and the student gets "Couldn't find valid settings for
this link" on the first click. When nothing matches, push warns, names the tools
that _are_ installed, and creates the item anyway.

> [!IMPORTANT]
>
> A **course-level** LTI 1.1 install cannot be recreated from this repository:
> Canvas never returns a tool's `shared_secret` from the API. An
> **account-level** install is inherited by every course you will be given, so
> the launch URL keeps working after a rollover. See
> [Limitations](limitations.md#an-lti-install-cannot-be-rebuilt-from-this-repository).

## File Item

A file item puts a downloadable file (PDF, DOCX, ZIP, ...) in a Canvas module.
The recommended form is a small markdown wrapper, with the binary itself in the
module's `_files/` folder:

```yaml
---
title: Course Syllabus
canvas_type: file
file_ref: _files/syllabus.pdf
---
```

| Field      | Type   | Description                                                                                                                                                                                                                                                                                                              |
| ---------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `file_ref` | string | **Required.** Path to the binary, relative to the wrapper file, usually inside the module's `_files/` folder. A `../_files/…` path into the shared folder renders and pushes, but a pull that rewrites the wrapper repoints it at a module-local copy — see [Limitations](limitations.md#push-and-pull-are-not-a-merge). |

On Canvas the item links straight to the uploaded file; in the local preview the
wrapper renders as a download card, with the media itself embedded above the
card when the file is an image, video or audio file. A PDF or DOCX export embeds
an image file item the same way, above its attachment line. Because the wrapper
is a normal markdown file, it supports `title`, ordering via the filename
prefix, and the `export` flag like any other item. A markdown file works as the
binary too, a study pack written by `npx course export -f md` for instance: it
is served as a download rather than as a page of the site. See
[Exporting](exporting.md#markdown).

Non-markdown files dropped directly into a module folder also work: the scanner
detects them as file items automatically, with the filename as title. They carry
no frontmatter, so they cannot use the `export` flag; to include one in an
export, list it by path or add it to a TOC file. See [Exporting](exporting.md).

## Adopting an Item You Made by Hand in Canvas

Push adopts a Canvas object whose type and title match a local file in the same
module, so an item you made by hand is usually claimed without you doing
anything. Two cases defeat that match: the titles differ, or the module holds
more than one candidate of that type and title and nothing says which claims
which. Push names the ambiguous ones and adopts neither.

Adopt it yourself by writing the link the match would have written. Identity
lives in `.canvas-sync.json`, keyed by the file's path under `course/`, so one
row in that file is the whole of what adoption does. Give the local file the
`canvas_type` that matches what Canvas calls the object, then:

1. **Take the id out of the Canvas URL of the item.**
   `/courses/123/assignments/456` gives `456`, and
   `/courses/123/discussion_topics/789` gives `789`. An external URL and an LTI
   link are nothing but a module item, so what those two need is the module
   item's own id, from `/courses/123/modules/items/456`.
2. **Find the module in `.canvas-sync.json`.** Modules are keyed by their local
   folder name.
3. **Add a row under that module's `items`,** keyed by the file's path from
   `course/`, with forward slashes on every platform. Two fields are enough:

   ```json
   "03-functions": {
     "canvas_module_id": 67890,
     "items": {
       "03-functions/04-lab-brief.md": {
         "canvas_type": "assignment",
         "canvas_id": 456
       }
     }
   }
   ```

4. **Push.** The row names the object without claiming anything about its state,
   so push reads the file as changed and Canvas as unchanged, writes the file up
   over the Canvas object, and fills in the rest of the row itself: the module
   item id, the fingerprints, the slot in `item_order`.

| What Canvas shows | `canvas_type`   | `canvas_id` holds                                |
| ----------------- | --------------- | ------------------------------------------------ |
| Page              | `page`          | the numeric page id; add `page_url` for the slug |
| Assignment        | `assignment`    | the assignment id                                |
| Discussion        | `discussion`    | the topic id                                     |
| Quiz              | `quiz`          | the quiz id                                      |
| File              | `file`          | the Canvas file id                               |
| External URL      | `external_url`  | the module item id, not a content id             |
| External tool     | `external_tool` | the module item id, not a content id             |

> [!IMPORTANT]
>
> This works on a Canvas object that is already an item in the module. Push
> reads a course through its modules, so an object sitting outside every one of
> them (a discussion a Course Copy left behind, say) is invisible to it, and a
> row naming that object reads as an object that was deleted: push writes
> nothing and reports the file as having lost its Canvas copy. Put the item in
> the module in Canvas first, and adopt it after that. A quiz in that state
> needs no row instead: push searches the whole course's quiz list by title and
> places the one it finds.

Adopting a page, an assignment or a discussion means the local file becomes the
source of truth for its body: the next push overwrites what Canvas holds with
what the file says. Either copy the Canvas text into the file first, or run
`npx course pull` and let it write the file for you. For a quiz, an external URL
or an external tool nothing is overwritten, because the file is only a
reference.
