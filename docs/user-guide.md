# User Guide

Coursewright lets you write course materials as markdown files on your own
computer, preview them on a local website as you write, and publish them where
you need them: a course website, PDF or Word handouts, or
[Canvas LMS](https://www.instructure.com/canvas). This guide covers the course
structure and the daily workflow; the [docs index](README.md) lists every other
guide. If anything fails along the way, check
[Troubleshooting](troubleshooting.md).

## Getting Started

[Your first course, step by step](first-course.md) is the full walkthrough:
installing VS Code, Node.js and git, creating the project from the template,
cloning it, and publishing a first module. It assumes no prior experience.

The short version, for the impatient:

```bash
git clone https://github.com/YOUR-USERNAME/your-project-name.git
cd your-project-name
npm install
npm run vscode:install   # adds the Course Manager panel to VS Code
npm start                # preview at localhost:3000
npx course setup         # name, language, look, templates
npx course init          # Canvas credentials (only if you sync with Canvas)
```

`npm run vscode:install` installs through VS Code's `code` command, so that has
to be on your PATH. Reload the window afterwards (**Developer: Reload Window**
in the command palette) and a book icon appears in the activity bar: the
**Course Manager** panel, showing your modules and items as a tree.

That panel is the shorter route to everything below. Each section names the
button or menu entry first and the command second, because the panel runs the
same CLI underneath. Node.js 24+ is the only requirement, and `npx` runs the
`course` tool that ships with the project, so there is nothing else to install.

> [!WARNING]
>
> If you keep exams or tests in the `evaluations/` folder, make the repository
> **private**: a public one is findable by students. See
> [keeping your project private](git-and-github.md#keeping-your-project-private).

`course/01-getting-started/` is a real module, so it would be published to your
students along with your own. The setup wizard offers to remove it; see
[the built-in tutorial module](customisation.md#the-built-in-tutorial-module)
for how to keep it locally without publishing it.

### Optional: Pandoc and Typst

Only needed to export course materials to PDF or Word, and a Word export needs
pandoc alone. The [exporting guide](exporting.md#what-you-need) covers
installing both, per platform.

## Course Structure

### Course Modules (Published)

Everything students see lives under `course/`, one folder per module. All three
outputs read this one tree: the website serves it, an export walks it in order,
and each file becomes one Canvas item when you sync.

```
course/
  _files/                    # Assets shared across modules
    logo.png
  01-module-name/
    _category_.json          # Docusaurus sidebar label/order
    _files/                  # Embedded assets and file item binaries
      diagram.png
      report.pdf
    01-page-name.md          # Canvas Page
    02-assignment-name.md    # Canvas Assignment
    03-discussion-name.md    # Canvas Discussion
    04-link-name.md          # Canvas ExternalUrl
    05-test-1.md             # Canvas Quiz (reference to a quiz in Canvas)
    06-report.md             # Canvas File (wrapper, points to _files/)
    07-subfolder-name/       # Canvas Text Header
      01-nested-page.md      # Indented module item
```

- Filenames are lowercase, hyphenated, prefixed with 00-99 for ordering
- Files and folders prefixed with `_` are internal: the scanner never reads one
  as a module item. Sync and pull still write two of them, so they are not a
  private corner of the tree: the Canvas module name goes into
  `_category_.json`, and binaries embedded in a Canvas page are downloaded into
  `_files/`
- Names starting with `.` (`.DS_Store` and its kin) are skipped the same way, so
  a folder Finder has opened gains no phantom file item
- A markdown file's type lives in its frontmatter: `canvas_type` marks it as a
  page (the default), assignment, discussion, external link, quiz reference or
  file item. The website renders every type as a page; Canvas gets the matching
  item
- An assignment carries `points_possible`, `submission_types` and `due_at` in
  frontmatter
- A discussion's markdown body is the opening message; frontmatter supports
  `discussion_type`, `require_initial_post`, `delayed_post_at`, `lock_at`,
  `published`
- A link item holds its address in `external_url`; an LTI item
  (`canvas_type: external_tool`) uses the same field for the tool's launch URL
- A quiz file is a reference, not content: it names a quiz that already exists
  in Canvas, and `quiz_ref` points at the QTI zip it was imported from (path
  from the repository root). The questions never sync
- A file item wraps a binary: `file_ref` points at it in `_files/` (e.g.
  `file_ref: _files/report.pdf`). The website and exports show a styled file
  card with a download link, and an image, video or audio file also shows the
  media itself above the card; a push uploads the binary to Canvas as a module
  item
- Images and files in `_files/` can also be referenced from markdown content
  (`![Alt](_files/image.png)`): these are embedded in page content, not added as
  separate module items
- A file more than one module embeds lives in `course/_files/` at the root of
  the tree, referenced as `../_files/…` from a module page; see
  [Shared Files](markdown.md#shared-files)

### Evaluations (Private)

```
evaluations/
  2526/                      # academic year
    exam-name/
      instructions.md
      start/                 # starter code for students
      solution/              # example solution
```

### Sources (Private)

Reference materials, inspiration, and notes. Not served by Docusaurus or synced
to Canvas. See the [sources guide](sources.md) for conventions.

### Context (Private)

Per-course design facts and the style rules AI skills read before drafting
anything: `context/course-context.md` and `context/writing-style.md`. Not served
by Docusaurus or synced to Canvas. See
[writing style guide](../context/writing-style.md) and
[course context](../context/course-context.md).

## Course Name, Language and Labels

`course.config.yml` at the project root names the course and sets the language
of every generated, student-facing label in one place: alert titles (Canvas
HTML, Docusaurus preview, and PDF/DOCX exports), the "External link" and "File"
cards in the preview, the attachment and online-footnote labels in exports,
default export titles and filenames, the fallback title for unnamed pulled
items, and the generated glossary page. It also sets the Docusaurus site locale,
so the site chrome ("On this page", "Next", …) follows along.

```yaml
title: Programming Fundamentals # names the site, navbar and export covers
tagline: Bachelor 1, semester 2 # optional, subtitles those covers

language: en # built-in label sets: en, nl (shipped default: en)

labels: # optional per-label overrides on top of the set
  alerts:
    caution: Watch out
  cards:
    file: Download
```

Without a `title`, the site and a full-course export fall back to the generic
label for the course language ("Course", "Cursus"). Set it. It is the one place
that names the course, and unlike `docusaurus.config.js` it survives an upstream
update.

Override groups and keys: `alerts` (`note`, `tip`, `important`, `warning`,
`caution`, `check`), `cards` (`external_url`, `file`), `export` (`attachment`,
`online`, `course_title`, `selection_title`), `pull` (`untitled`), and
`glossary` (`title`, `intro`, `operators`, `terms`). When the file or a key is
missing, English is used.

After changing the language or a label, re-push modules whose pages contain
alerts (`npx course push`) and regenerate glossary pages
(`npx course build-glossary`) so Canvas picks up the new labels. The file is
listed in `protected_files`, so upstream updates never overwrite your choice.

## Markdown Files

Markdown is a simple way to format text using plain characters: for example,
`**bold**` for **bold** and `## Heading` for a heading. Your course materials
are written as markdown files, which are just regular text files that end in
`.md`.

See the [markdown guide](markdown.md) for supported syntax and custom alerts,
and the [frontmatter guide](frontmatter.md) for the metadata fields.

### Keeping Your Course Files Tidy

`npm run format` runs Prettier over your markdown. It rewraps prose at 80
characters and normalises list markers, emphasis, table alignment and
frontmatter. Nothing about the rendered page changes: this is source formatting
only, and your fenced code blocks are left exactly as you wrote them.

It is worth running, for three reasons:

- **Consistency without policing it.** Course material accumulates from many
  places: a page drafted by an AI skill, a paragraph pasted out of Word or a
  slide deck, something typed in a hurry the night before class. Each arrives
  with its own wrapping and list markers. One command makes the whole course
  look like it was written in one sitting.
- **Readable diffs across an academic year.** This is the practical win. With
  prose wrapped at 80 characters, fixing one sentence shows up in `git diff` as
  one or two changed lines. With a paragraph sitting on a single long line, the
  same fix reports the entire paragraph as changed and you cannot see what you
  actually altered.
- **It catches markdown that renders wrong silently.** A missing blank line
  before a list, a misaligned table, stray trailing whitespace: Prettier
  normalises all of it, so a page behaves the same in the preview and after
  `npx course push`.

Run it whenever suits you: before a commit, or after a long writing session. It
covers what you write by hand; what the tool writes is formatted already,
because sync needs one canonical form of every file under `course/`. A page
whose bytes disagreed with Prettier's would read as changed on the next run and
be pushed straight back, unaltered.

One write is deliberately outside that: the `title:` line a run splices into a
file that declares none (see [Canvas Sync](#canvas-sync) below). The rest of
that file is yours and the run had otherwise only read it, so formatting it
would put changes you never made into your working tree.

So `.prettierignore` cannot keep Prettier out of `course/`. It still works for
the folders the tool never writes to, and whether to use it there is your call:
the file this project ships excludes only `package-lock.json`. Add lines of your
own if you would rather keep a folder exactly as you typed it:

```
evaluations/
sources/
```

## Managing Course Materials

### Managing Modules

**Course: New Module** sits in the Course Manager panel's title bar. It asks for
a name and adds the module after the last one, writing the folder with the right
numeric prefix and a `_category_.json` inside it. To put it somewhere else, move
it afterwards.

Reorder a module by dragging it onto another module in the tree, or right-click
and choose **Course: Move Module** to pick a position instead. Rename one with
**Course: Rename Module**, which updates the folder and the label in its
`_category_.json` and pre-fills the current title. Delete one with **Course:
Delete Module**, then confirm the modal; the remaining modules renumber to close
the gap.

None of this touches Canvas. A module you delete here stays on Canvas until a
prune removes it, and every sync run names it under `Orphaned on Canvas` until
one does.

#### From the Terminal

```bash
npx course new-module     # create a new module (asks for name and position)
npx course move-module    # move a module to a different position
npx course rename-module  # rename a module
npx course delete-module  # delete a module and renumber remaining
```

Each command asks for what it needs, or takes flags that answer the questions
instead; a question that reaches the end of its input without an answer ends the
run with an error rather than hanging, so a script has to pass the flags. See
[CLI reference](cli-reference.md#modules) for the full flag list.

### Managing Items

Right-click a module or a subsection and choose **Course: New Item**. It asks
which of six types it is and a name; an assignment also asks for its points, an
external URL for its address, and a file item opens a file picker. The new item
lands at the end, so reorder it afterwards if it belongs elsewhere.

Reorder an item by dragging it up or down inside its module, or right-click and
choose **Course: Move Item**. Move it to a different module, or one of that
module's subsections, by dragging it there or with **Course: Move Item to
Module**; a subsection can move the same way, always into a module root, since
subsections never nest. Rename an item with **Course: Rename Item**, which
updates both the filename and the `title` in its frontmatter. Delete one with
**Course: Delete Item**, then confirm the modal; the remaining items renumber.

Merging takes two right-clicks, on page and assignment rows only: **Merge: Set
as Source** on the item that gets deleted, then **Merge with Source** on the
item that keeps the content. A dialog names both files and confirms the source
is deleted. The source's body lands at the end of the target's, under a `##`
heading carrying the source's title, so you can see where the merged-in material
starts and rename or delete that heading afterwards. Splitting runs the other
way: put the cursor on the last line that should stay in the current file,
right-click in the editor and choose **Course: Split Item at Cursor**, then give
the new item a title.

None of this touches Canvas either. An item you delete or merge away stays on
Canvas until a prune removes it, and every sync run names it under
`Orphaned on Canvas` until one does.

A quiz and an LTI link carry only the inline **Open in Canvas** button in the
tree: they have no rename, move, delete or export entry in their right-click
menu. **Course: New Item** does not create them either: it creates a page, an
assignment, a discussion, an external URL, a subsection or a file. A quiz or an
LTI link is a file you write yourself, following
[Frontmatter](frontmatter.md#quiz). The command palette reaches both regardless:
its pickers list a module's items by filename, whatever type each one declares,
so **Course: Rename Item** run from the palette works on a quiz the same as it
does on a page.

#### From the Terminal

```bash
npx course new-item           # create a page, assignment, discussion, url, subsection, or add a file
npx course move-item          # reorder an item within its module
npx course movetomodule-item  # move an item to a different module
npx course rename-item        # rename an item
npx course delete-item        # delete an item and renumber remaining
npx course merge-items        # merge two items into one
npx course split-item         # split an item into two files at a given line
```

Item commands auto-detect the current module when run from inside a module
folder. Items can be added to the module root or into subsections. See
[CLI reference](cli-reference.md#items) for the full flag list.

### Generated Glossary Pages

```bash
npx course build-glossary          # regenerate module glossary pages from the canonical glossary
npx course build-glossary --check  # verify pages are up to date (CI / pre-push)
```

If your course keeps a canonical glossary in
`sources/reference-materials/glossary.yml`, this command renders a cumulative
glossary page per module. See the [lesson workflow](lesson-workflow.md) for the
file format and how it fits the authoring flow.

The command palette has a matching **Course: Build Glossary** entry. It is
deliberately not in the Course Manager tree, in its title bar or in a
right-click menu, so no stray click there can ever start it.

### Pre-Ship Checks

```bash
npx course check          # validate, glossary freshness, links, and your own extras
npx course check-links    # the link check alone, over the configured roots
npm run hooks:install     # run `check` before every git push
```

`check` runs every check a course should pass before a push, each as its own
process so one failure does not stop the others, and exits non-zero naming the
ones that failed: `validate`; `build-glossary --check` when the course keeps a
glossary at `sources/reference-materials/glossary.yml`, reported as skipped when
it does not; `check-links`; then whatever `checks.extra` in `course.config.yml`
adds. `hooks:install` copies `scripts/pre-push` into `.git/hooks`, so a push
that would ship a broken link or a stale glossary page stops on your machine
rather than in CI; `git push --no-verify` gets past it when you have to.
`.github/workflows/course-checks.yml` runs the same command on every push. See
[pre-ship checks](customisation.md#pre-ship-checks) for the two config keys.

### Searching Course Content

**Course: Search...** sits in the Course Manager panel's title bar. It asks for
a word or phrase and streams every match to the shared terminal, grouped per
file with the module and item it belongs to, line numbers, and a few lines of
context around each match. As in the terminal, only `course/` is searched by
default.

The wider search options are terminal-only: more context, widening the search to
`evaluations/` and `sources/`, and matching case exactly.

```bash
npx course search "flexbox"                          # find a word or phrase in course/
npx course search "flexbox" -C 4                     # show more context around matches
npx course search "flexbox" --evaluations --sources  # also search those folders
npx course search "Flexbox" --case-sensitive         # match upper/lower case exactly
```

See [CLI reference](cli-reference.md#search) for the full flag list.

## The Website

**Course: Preview** sits in the Course Manager panel's title bar. It starts the
Docusaurus dev server, if it is not already running, and opens the course in
your browser. The `courseManager.previewPort` setting (default `3000`) changes
the port it uses, for when something else on your machine already holds that
one.

```bash
npm start          # live preview at localhost:3000 while you write
npm run build      # production build, the same one publishing runs
```

`npm start` is what **Course: Preview** runs behind the scenes, so the two are
interchangeable. `npm run build` has no extension equivalent: run it from the
terminal.

The preview served by [Docusaurus](https://docusaurus.io/) is the course
website; publishing it is one GitHub Pages setting, after which every push to
GitHub rebuilds the public site. See the [hosting guide](hosting.md).

## Exporting to PDF or DOCX

Turn course materials into printable PDFs or editable Word documents: one item,
a module, the whole course, or a curated selection.

Right-click an item and choose **Course: Export Item to PDF/DOCX...**, or a
module and choose **Course: Export Module to PDF/DOCX...**. Select several items
first (Ctrl/Cmd-click or Shift-click in the tree) and the item export combines
them into one document. For the whole course, open the panel's `…` dropdown and
choose **Course: Export Course to PDF/DOCX...**, which also offers only the
items flagged `export: true`, or a curated table-of-contents selection. Either
way you then pick PDF or Word.

```bash
npx course export -m 01-intro       # one module as PDF
npx course export -f docx           # the whole course as Word
```

This needs pandoc (and Typst for PDF). The [exporting guide](exporting.md)
covers the install, every scope, the curated table-of-contents flow, where the
output lands, and how to change the look. See
[CLI reference](cli-reference.md#export) for the full flag list.

## Canvas Sync

If you do not publish to Canvas, skip this whole section; nothing else in the
tool depends on it.

The Course Manager panel's `…` dropdown carries the whole-course versions:
**Course: Sync with Canvas**, **Course: Push to Canvas**, **Course: Pull from
Canvas**, **Course: Status** and **Course: Validate**. Right-click a single
module in the tree for the same four, scoped to it: **Sync This Module with
Canvas**, **Push This Module to Canvas**, **Pull This Module from Canvas** and
**Status of This Module**. Either way the run streams into the shared terminal,
which is where you answer any question it stops to ask.

The three dry runs live in the command palette only: **Course: Sync with Canvas
(Dry Run)**, **Course: Push to Canvas (Dry Run)** and **Course: Pull from Canvas
(Dry Run)**. Run one before the real thing.

> [!WARNING]
>
> Before your first push to a Canvas course that already has content, back it
> up: see [Backing up a Canvas course](backups.md). Canvas has no undo, and
> three flags delete things. `--prune-canvas` removes the Canvas items whose
> local file you deleted, `--prune-local` removes the local files Canvas no
> longer has, and `sync --prune` does both in one run. `pull --force` writes
> over local markdown that git holds no copy of, so commit before you use it.
> [Limitations](limitations.md) sets out exactly what each command touches.

`npx course sync` is the command. `push`, `pull` and `status` are the same
engine with one decision taken out of your hands.

```bash
npx course sync                   # two-way; the newest change wins; deletes nothing
npx course sync --dry-run         # the same run, reported instead of carried out
npx course sync -m 01-intro       # only these module folders (repeatable)
npx course sync --conflict local  # who wins when both sides changed one item
npx course sync --order canvas    # who wins when both sides reordered a module
npx course sync --prune           # also delete on both sides; counts them and asks
npx course sync -y                # never ask: confirm the prune, skip the questions
npx course push                   # your files win; Canvas is written, course/ is not
npx course push --prune-canvas    # also delete the Canvas items you deleted locally
npx course pull                   # Canvas wins; course/ is written, Canvas is not
npx course pull --prune-local     # also delete the local files Canvas no longer has
npx course pull --force           # write over local files that hold uncommitted work
npx course status                 # what a sync would do; neither side is written
npx course validate               # check course content for errors before pushing
```

All three writing commands take `--dry-run`. `-m` scopes any of the four to
named module folders; on `sync`, `pull` and `status` it is repeatable
(`-m 01-intro -m 02-html`), on `push` it takes one folder.

A prune flag, `--conflict`, `--order` and `pull --force` are terminal-only:
neither the panel nor the palette has a route to any of them, so a run that
needs one is a run you type. See
[CLI reference](cli-reference.md#syncing-with-canvas) for the full flag list.

### One Engine, Four Commands

Each of the four reads both sides, compares them against `.canvas-sync.json`
(what was true at the last sync) and works out what changed where. They differ
in what they may then do about it.

| Command  | Writes to            | When both sides changed one item           |
| -------- | -------------------- | ------------------------------------------ |
| `sync`   | Canvas and `course/` | the newest wins, or what `--conflict` says |
| `push`   | Canvas               | your file wins                             |
| `pull`   | `course/`            | Canvas wins                                |
| `status` | neither              | nothing; it names who would win            |

A write a command may not make is still worked out, and still reported, under
**Left alone**. A push that finds a page edited in the Canvas web editor says so
rather than losing the fact.

The **Writes to** column has one exception, and only one. When a run creates a
Canvas object from a file whose frontmatter declares no `title:`, it writes the
title into that file. `push` does it too, which is the one thing it puts in your
working tree. Without it the item's name would keep coming from the filename,
and renumbering a module would quietly rename items in Canvas.

Pinning a direction is also what lets a run **adopt**. Push and pull pair a
local file with a Canvas object of the same type and title and tie the two
together from then on, which is how this tool takes over a course it did not
create. `sync` and `status` adopt nothing, on purpose: with no direction pinned
there is nothing to say which of the two copies is the real one. So when the
sync state links nothing in a module and both sides hold items, those two refuse
that module rather than write a second copy of everything in it, and point you
at `push` or `pull`. It is judged per module, so a module that is genuinely new
on one side does not trip it.

`status` reads Canvas on every run and cannot work without it. There is no
offline mode: what a sync would do is not answerable from the local side alone,
so a missing `CANVAS_COURSE_ID` or a course it cannot read ends the run with an
error that says as much.

Writing nothing does not make it always exit 0. A course mid-edit exits 0
whatever is waiting in it. A course a `sync` would refuse rather than work
through exits 1: a module both sides hold with nothing linking them, two Canvas
modules deriving one folder name, or a module whose items Canvas would not list
this run. So does a run that could not report at all, from a missing course id
to a `-m` naming no module. A script can read a non-zero `status` as a course
that needs a person before anything is synced.

### Who Wins When Both Sides Moved

Neither `--conflict` nor `--order` comes up unless both sides moved. An item
only you changed is pushed, an item only Canvas changed is pulled, and a module
only one side reordered keeps that side's order.

- **`--conflict newest|local|canvas|ask`** (default `newest`) settles an item
  both sides changed. `newest` compares the file's modification time against
  Canvas's `updated_at`, and gives it to your file on a tie or when Canvas
  reports no usable timestamp: of the two possible mistakes, writing over Canvas
  is the one git can undo. `ask` stops at each item and asks.
- **`--order local|canvas|ask`** (default `ask`) settles a module both sides
  reordered. There is no `newest` here, and only `sync` takes the flag. `push`,
  `pull` and `status` leave such a module in whatever order each side has it and
  name it in the report.

A value neither flag recognises is an error rather than a fallback.
`npx course sync --conflict newst` prints
`[sync] Error: --conflict newst is not one of newest, local, canvas, ask.` and
exits without reading Canvas, because a typo silently degrading to "skip
everything" would look like a clean run.

### Deleting What the Other Side No Longer Has

A run deletes nothing unless you ask for it.

| Flag             | Available on   | Deletes                                                   |
| ---------------- | -------------- | --------------------------------------------------------- |
| `--prune-canvas` | `sync`, `push` | the Canvas modules and items whose local file you deleted |
| `--prune-local`  | `sync`, `pull` | the local files and folders Canvas no longer has          |
| `--prune`        | `sync`         | both of the above, in one run                             |

Each one asks before it deletes, and each lists every item first. `sync` and
`push` check the Canvas side of that list for student work: an assignment or a
graded discussion that already holds submissions is flagged on its own line, and
the question you answer names the grades. `sync --prune` lists both sides, since
it is the only command that deletes on both. A `--dry-run` prints the same
listing and asks nothing.

Two guards sit behind that question either way. A Canvas item the sync state
never tracked is never a candidate, so a prune never deletes something a
colleague built by hand. And a local file holding uncommitted changes is
reported as skipped rather than deleted, because git is the only copy of what is
in it.

Read [Backing up a Canvas course](backups.md) before the first one. Deleting an
assignment takes its gradebook column and every grade in it, and no course
export brings those back.

### Running without a Terminal

A scripted run (CI, a cron job, a command with its input redirected) cannot
answer a question. What each flag does then is worth knowing before you put one
in a script.

- **A prune does not happen.** `sync` says so and carries on with the rest of
  the run: `--yes` is what lets it delete without asking. `push` and `pull` have
  no `--yes`, so `push --prune-canvas` and `pull --prune-local` cannot delete
  anything in a script at all. A prune flag on `sync` together with `-y` is the
  only scripted route to a prune.
- **A conflict under `--conflict ask` is skipped**, listed with the remedy, and
  the run exits non-zero. Pin `--conflict local` or `--conflict canvas` instead.
- **A module contested under the default `--order ask` is left as it is** on
  both sides and named in the report. That does not fail the run, so a script
  that cares should pin `--order`.
- **A possible rename goes unanswered**, and neither path is touched.
- **Two questions take no flag, and a piped `y` is the only way past them.** The
  first push to a Canvas course that already holds content is one.
  `pull --force` while the git guard is holding at least one file is the other,
  which includes every run outside a git checkout, where the guard covers the
  whole tree. Neither writes anything when nothing answers, and both exit 1
  rather than report the run they did not make as a success.

`sync -y` behaves the same way in a terminal: it confirms the prune and skips
the conflict and ordering questions rather than putting them to you.

### The Sync State Is Part of the Commit

The sync state, `.canvas-sync.json`, records which Canvas object each of your
files is, and it is committed like everything else in the project. `status` only
reads it; the other three keep it current, so a run leaves a change there to
commit alongside the content that caused it. See
[Commit the sync state](git-and-github.md#commit-the-sync-state) for why a
second copy of the project is lost without it.

### Global Flags

```bash
npx course --verbose <command>   # show API request details
npx course --quiet <command>     # only show errors
```

### New Academic Year

See the [new academic year guide](new-academic-year.md) for switching your
materials to a new Canvas course at the start of a new academic year.

## Advanced Commands

```bash
npx course reset-sync-state      # delete .canvas-sync.json and clear any leftover canvas_id fields
npx course reset-canvas          # delete all modules, pages, assignments, and files from Canvas
```

See [advanced commands](advanced-commands.md) for details on these destructive
operations.

The command palette has matching entries, **Course: Reset Sync State
(Destructive)** and **Course: Reset Canvas (Deletes ALL Canvas Content)**.
Neither is in the Course Manager tree, in its title bar or in a right-click
menu: the tree is kept free of destructive commands by design, so no stray click
there can start one. Both still run in the shared terminal, where the CLI's own
y/N questions gate them. Back the course up first; see
[Backing up a Canvas course](backups.md).
