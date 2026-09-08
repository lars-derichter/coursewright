# Troubleshooting

Common issues and how to resolve them, grouped by where they bite: the commands
themselves, the website, the exports, the Canvas sync, and the AI assistants.

## Running the Commands

### "no module named" and "Module not found"

What `--module` (`-m`) takes is the folder name under `course/`, numeric prefix
included, not the title Canvas shows. Three messages come back for the same
typo, because three sets of commands answer the question differently:

```text
[status] Error: no module named 01-introduction — nothing under course/ and nothing in the Canvas course answers to it.
[push] Error: no module folder named 01-introduction under course/.
[new-item] Error: Module not found: 01-introduction
```

`sync`, `pull` and `status` read both sides, so they accept a module that exists
only in Canvas and only refuse a name neither side answers to. Push writes from
the tree alone, so a folder is all it will take. The item and module commands
never read Canvas either. All of them exit non-zero rather than reporting a
clean course. Run `ls course/` for the names.

### "got no answer"

An interactive command asked a question and the input stream ended before an
answer arrived: a pipe that ran dry, `< /dev/null`, a CI step, an editor task
with no terminal, or an AI assistant driving the CLI. The message names the
question, the command and the flags that answer for you.

```text
[new-item] Error: "Item type (page/assignment/discussion/url/subsection/file)" got no answer — the input stream ended before one arrived. Run `npx course new-item` in a terminal, or pass --module and --type to answer from flags.
```

Run it in a terminal, or pass the flags it names. The run exits non-zero rather
than reporting a success it never had. A destructive question behaves the other
way round on purpose: `reset-canvas`, a prune and `pull --force` all read
silence as "no" and cancel.

## The Website

### Build Fails with Broken Links

The site is configured to fail the build on a broken internal link
(`onBrokenLinks: 'throw'` in `docusaurus.config.js`), in the local build and in
the deploy alike. Check that all relative `.md` links point to existing files.
`npm run build` shows the exact error location and catches before a push what
would otherwise stop the deploy.

### Alerts Not Rendering

The custom remark plugin (`src/plugins/remark-gfm-alerts.js`) requires the exact
syntax `> [!TYPE]` on a new line inside a blockquote. Make sure there's no space
before the `[` and the type is one of: NOTE, TIP, IMPORTANT, WARNING, ATTENTION
(or its synonym CAUTION), CHECK.

### The Deploy Runs, but Nothing Is Published

When every job after the first shows as skipped, GitHub Pages is not switched on
yet, or its source is still set to a branch. Set **Settings > Pages > Source**
to **GitHub Actions** and push again. [Hosting](hosting.md#troubleshooting)
covers the rarer deploy failures.

## Exports

### "unknown font family"

Typst warns and falls back to the next font in the style's list; the export
still succeeds. The `generic` style asks for Helvetica, then Arial, so the
warning is normal on a machine without them. Silence it by picking a font
`typst fonts` lists (`--var mainfont=Arial`), or drop font files into
`sources/export-style/fonts/`.

### An SVG Image Is Missing from the Word Document

For DOCX, pandoc needs `rsvg-convert` on the PATH to rasterise inline SVG (it
ships with librsvg: `brew install librsvg`); without it the image is dropped
with a warning. The PDF renders SVG natively. Use PNG for images that must
appear in DOCX everywhere.

### The Word Table of Contents Shows Empty

Word writes the TOC as a field that stays empty until you update it: open the
document, select all (Ctrl/Cmd-A), and press F9. Nothing went wrong in the
export.

### Office Fonts Not Found on macOS

On macOS, Microsoft Office keeps its typefaces (Century Gothic among them)
inside the application bundles, so `typst fonts` does not list them. The
exporter adds Office's font directories itself, so a Mac with Word exports in
the same typeface a Windows machine does; `npx course export --verbose` prints
the directories it searched. Without Office, headings fall through to the next
font in the style's list.

[Export styling](export-styling.md) explains the pipeline behind all four, and
its [DOCX degradations](export-styling.md#docx-degradations) section lists what
Word output gives up by design.

## Canvas Connection Errors

### "CANVAS_COURSE_ID is not set"

Run `npx course init` to configure your Canvas API credentials. This creates a
`.env` file with your API URL, token, and course ID.

### "fetch failed" or Network Timeout

- Verify your Canvas instance is reachable in a browser.
- Check that `CANVAS_API_URL` in `.env` is the bare domain (e.g.
  `https://your-school.instructure.com`), without `/api/v1` or any other path
  after it; the CLI appends `/api/v1` itself.
- If behind a VPN or firewall, ensure it allows outbound HTTPS to your Canvas
  instance.

### 401 Unauthorized

Your API token is invalid or expired. Generate a new token in Canvas under
**Account > Settings > New Access Token** and update `.env`.

### 403 Forbidden

Your token lacks permissions for the target course. Verify you have a Teacher or
Admin role in the Canvas course.

## Push Issues

### A Stale ID on the Sync Row (404 on Update)

If a page, assignment or discussion was deleted directly in Canvas, the id
`.canvas-sync.json` holds for that file goes stale. The update comes back 404,
so the run creates the object again, records the new id on the same row, and
says so as it goes:

```text
  [sync] Page 4711 is gone from Canvas; creating it again.
```

The label is `Page`, `Assignment` or `Discussion`, and the number is the id that
went stale. No manual action needed.

That recovery is an update that came back 404, so it only runs while Canvas
still lists the module item; deleting the object usually takes the item with it,
and once the item is gone there is nothing to update, so the run writes nothing
and reports the file instead (see
[Push reconciles a module's item list](limitations.md#push-reconciles-a-modules-item-list)).

A module is the exception, and the only one. There is no 404 recovery on a
module update, so a module deleted in Canvas while `.canvas-sync.json` still
names it fails that action and the run reports the error. Take that module's
entry out of `.canvas-sync.json` and the next push creates the module and its
items again. Back the course up first: see
[Backing up a Canvas course](backups.md).

### Unresolved Internal Links

When pushing a course for the first time, pages that reference each other can't
all resolve on the first pass. Push automatically runs a second pass to update
links to newly-created pages. Use `--verbose` to see which items needed
re-resolution.

In `--dry-run` mode, unresolved links are reported as warnings since the second
pass can't run without creating real pages.

### File Upload Failures

- Verify the file exists at the path shown in the error.
- Check that the file isn't too large (Canvas has per-file limits).
- Ensure the MIME type is supported. See `lib/canvas/files.js` for the full
  list.

## Pull Issues

### "(git-dirty)" Under Skipped

A local file git reports as modified or untracked is never overwritten and never
deleted. The write is refused, the rest of the run carries on, and the report
names the file with the reason and the remedy:

```text
Skipped
  - 01-intro/02-variables.md (git-dirty): 01-intro/02-variables.md has uncommitted changes; writing the Canvas version over it would be the only copy of them gone. Commit or stash the file, then run sync again.
```

Commit or stash the file and run again. Untracked counts as dirty, and that is
the case worth knowing about: git holds no copy of a file it has never seen, so
overwriting one loses more than overwriting a modified file, not less.

Only a command that writes into `course/` reaches the guard, which means `sync`
and `pull`. A push writes to Canvas alone and lists the local side under "Left
alone" instead, and `status` writes to neither side. Where git cannot answer at
all, outside a checkout or wherever `git` will not run, every file counts as
dirty and a pull writes nothing. A run with a skip in it exits non-zero.

`npx course pull --force` is the one lever that switches the guard off, for
overwrites and deletes alike. It asks before it does, naming how many files it
is about to write over, and a run with nobody to answer cancels. Back the course
up before you answer: see [Backing up a Canvas course](backups.md). For what a
pull does to a file it does write, see
[Push and pull are not a merge](limitations.md#push-and-pull-are-not-a-merge).

### Missing Content After Pull

- Every module item type comes down: pages, assignments, discussions, files,
  external URLs, quizzes, LTI links and text headers. A quiz and an LTI link
  arrive as a frontmatter-only reference file, because neither has a body this
  project could hold. A quiz's questions are not pulled and never will be. See
  [Limitations](limitations.md#which-canvas-types-sync-and-how-much-of-them).
- Announcements, rubrics, outcomes and the syllabus page are not module items,
  so pull does not see them at all.
- Empty pages on Canvas produce empty markdown files. This is normal.

### Two Canvas Modules That Derive One Folder Name

A module's folder name is its position and its name together, so two Canvas
modules that agree on both derive the same folder. Only one of them can have it,
and nothing local can settle which:

```text
Skipped
  - 02-loops (folder-taken): Canvas module "Loops" would be pulled into 02-loops/, and another module already has that folder — a module's folder name is its name and its position, so two modules that agree on both derive the same one. Rename or renumber one of them in Canvas, then run again.
```

Rename or renumber one of the two in Canvas, then run again. Until you do,
`sync` and `pull` leave that module alone, and `status` reports it and exits 1
even though it wrote nothing: a preview that exits 0 on a course a real sync
refuses is answering a different question than the one it advertises.

## Sync State

### Corrupted .canvas-sync.json

A sync state that is there and cannot be parsed stops the commands that act on
the ids in it, rather than passing for a course that was never synced, so a run
that hit this changed nothing. The message names the file and says whether git
conflict markers are still in it, which is the usual reason.

The sync state is committed, so the first answer is git rather than the CLI.
Take the last good copy back:

```bash
git checkout -- .canvas-sync.json
```

That gives you the file as your last commit had it. Anything a push created
since that commit is missing from it, and the next push claims those objects
back by title.

If git has no good copy either, because the file was never committed or the
corruption was committed with it, delete it and run `npx course push` to
regenerate it. No markdown file names the Canvas object it became, so there is
nothing to match on file by file: push claims a Canvas object of the same type
and title in the module the file sits in, and writes the pair back into the
state.

A binary in `_files/` has no frontmatter to carry an id and needs none: push
uploads it again, and Canvas overwrites the file of the same name it already
holds. Nothing about a missing sync state makes push refuse the module. See
[push reconciles a module's item list](limitations.md#push-reconciles-a-modules-item-list).

### ".canvas-sync.json describes course N"

`.env` names one Canvas course and the sync state was built against another, so
every command that acts on the ids in that file stops until the two agree:
`sync`, `push`, `pull`, `status`, the item commands and all four module
commands. `new-module` is the one that surprises people: inserting a module at
an occupied position renumbers every module above it, and each of those folder
names is a key. Each of them refuses before it does anything, so a run that
stopped changed nothing. The ids in that file only mean something in the course
they came from, and one of them is not scoped to a course at all: a Canvas file
id is global, so `push --prune-canvas` (or renaming the binary behind a file
item, which deletes the Canvas file it replaces) would delete a file belonging
to the other course.

Two ways out, and which one is right depends on what you meant:

- **You did not mean to switch.** Put the original course id back in `.env`.
  This is the usual case: a `CANVAS_COURSE_ID=` you edited to try something, a
  one-off override that wrote the sync state, or, now that the sync state is
  committed, a clone or a branch that arrived already describing another course.
- **You did mean to switch.** Run `npx course reset-sync-state`, then push.
  Check first whether the new course already holds a copy. Push adopts by type
  and exact title, so anything that matches is claimed rather than copied, but
  anything that does not (a title that differs between the two sides, an item
  whose type changed) is created alongside what is already there. If the new
  course was seeded with Canvas's own Course Copy, its ids are new too, so the
  reset is required either way.

`npx course init` also settles it, and settling it is what it is for: point it
at the new course and it drops the old course's mappings rather than filing them
under the new course id.

The same error names a base URL instead of a course when `CANVAS_API_URL` moved
to a different Canvas instance, where even a matching course id means a
different course.

Do not read the refusal as a guard on everything. Two commands read the
mismatched file and carry on, and neither writes to Canvas: `init`, which
repairs it, and `export`, which only wants the ids to footnote cross-links. A
command that never opens the file is not stopped at all: `setup`, `validate`,
`search`, `build-glossary`, `check`, `check-links`, `export-toc`,
`reset-sync-state` and `reset-canvas`. That last one is the one to watch. It
deletes everything in the course `.env` names, and a mismatch is the situation
in which `.env` may not be naming the course you think it is.

### Starting Fresh, or Switching Canvas Courses

Both are covered by [Advanced commands](advanced-commands.md) and, for the
yearly move to a new course, [New academic year](new-academic-year.md). Back the
Canvas course up first: [Backups](backups.md).

## AI Assistant Issues

### Skills Not Found on Windows

`.claude/skills` is a git symlink, and git on Windows only creates real symlinks
when `core.symlinks` is `true`, which requires Developer Mode (or admin rights).
Without it, the checkout silently turns the symlink into a small text file, and
Claude Code finds no skills; no error is shown anywhere.

To fix:

1. Enable Developer Mode (Settings > System > For developers).
2. Run `git config core.symlinks true` in the repo.
3. Restore the checkout: `git checkout -- .claude` (or re-clone).

Working inside WSL2 avoids the problem entirely; symlinks always work there.
`AGENTS.md` and `CLAUDE.md` are plain files and are unaffected either way.
