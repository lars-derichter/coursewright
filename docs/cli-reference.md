# CLI Reference

Every `npx course` subcommand but one is also a command in the
[VS Code extension](vscode.md): the palette, the sidebar tree, or both. What the
extension does not reach is the flags. This page lists every flag each
subcommand declares, the npm scripts, and the handful of capabilities (listed at
the bottom) that have no extension route at all.

Use this page to look up a flag. For what each command actually does and why,
see the [user guide](user-guide.md); for the sidebar and palette, see
[the VS Code extension](vscode.md).

Every command also takes `-h, --help` to print this same information at the
terminal.

## Setup

### `setup`

First-run wizard: course name, language, templates, look, and Canvas.

```bash
npx course setup [options]
```

| Flag                            | Description                                               |
| ------------------------------- | --------------------------------------------------------- |
| `--language <lang>`             | Course label language (en, nl)                            |
| `--title <title>`               | Course name                                               |
| `--tagline <text>`              | One-line course descriptor                                |
| `--theme <name>`                | Colour theme name or path                                 |
| `--export-style <name>`         | Export style folder name or path                          |
| `--readme <copy\|keep>`         | Install the course README template                        |
| `--course-home <copy\|keep>`    | Install the course home page template (`course/index.md`) |
| `--course-context <copy\|keep>` | Install the course-context template                       |
| `--writing-style <variant>`     | Writing style baseline (en, en-us, nl-be, nl, keep)       |
| `--tutorial <keep\|remove>`     | Keep or remove `course/01-getting-started`                |
| `--no-canvas`                   | Skip the Canvas connection question                       |
| `-y, --yes`                     | Take the answers from the flags and never prompt          |

Run with no flags for the interactive wizard. `-y` is what makes it scriptable:
every question needs a matching flag or the run stops with an error rather than
hanging.

### `init`

Interactive setup for Canvas API credentials and sync file.

```bash
npx course init
```

No flags beyond `-h`. See [Canvas setup](canvas-setup.md).

## Syncing with Canvas

`sync`, `push`, `pull` and `status` are one reconcile engine with the direction
pinned differently; see
[One engine, four commands](user-guide.md#one-engine-four-commands) for what
each one decides and [Backups](backups.md) before you run any of them against a
course that already holds content.

### `sync`

Two-way sync with Canvas: newest wins, nothing is deleted.

```bash
npx course sync [options]
```

| Flag                     | Description                                                                             |
| ------------------------ | --------------------------------------------------------------------------------------- |
| `--dry-run`              | Show what would happen without writing anything                                         |
| `-m, --module <name...>` | Only sync these module folder names (repeatable: `-m 01-intro -m 02-html`)              |
| `--prune-canvas`         | Delete Canvas items and modules gone locally                                            |
| `--prune-local`          | Delete local files and folders gone from Canvas                                         |
| `--prune`                | Both `--prune-canvas` and `--prune-local`                                               |
| `--conflict <policy>`    | Who wins when both sides changed: `newest`, `local`, `canvas`, `ask` (default `newest`) |
| `--order <policy>`       | Who wins when both sides reordered: `local`, `canvas`, `ask` (default `ask`)            |
| `-y, --yes`              | Never ask: confirm a prune, and skip conflict and order questions                       |

`--conflict` and `--order` only come up when both sides changed the same item or
reordered the same module; see
[Who wins when both sides moved](user-guide.md#who-wins-when-both-sides-moved).
A prune only runs unattended with `-y`; without it, `sync --prune-canvas` in a
script skips the deletion and reports it, it does not fail.

### `push`

Push local course content to Canvas.

```bash
npx course push [options]
```

| Flag                  | Description                                                      |
| --------------------- | ---------------------------------------------------------------- |
| `-m, --module <name>` | Only push a specific module folder name (single, not repeatable) |
| `--dry-run`           | Show what would happen without writing to Canvas                 |
| `--prune-canvas`      | Delete Canvas modules and items that no longer exist locally     |
| `--prune`             | Gone: errors out and names `--prune-canvas`                      |

`--prune` is not a silent alias: `push --prune` exits with an error pointing at
`--prune-canvas`, because push only ever writes to one side, and the old flag
name no longer says which. `push` has no `-y`: it cannot run a prune unattended,
so a scripted `push --prune-canvas` skips the deletion.

### `pull`

Pull course content from Canvas into local markdown files.

```bash
npx course pull [options]
```

| Flag                     | Description                                                    |
| ------------------------ | -------------------------------------------------------------- |
| `-m, --module <name...>` | Only pull these module folder names (repeatable)               |
| `--dry-run`              | Show what would happen without writing anything                |
| `--prune-local`          | Delete local files and folders that no longer exist in Canvas  |
| `-f, --force`            | Write over local files that hold uncommitted or untracked work |

`--force` switches off the git guard that otherwise protects a local file with
uncommitted or untracked changes. Commit before you use it; see
[Backups](backups.md).

### `status`

Show what a sync would do, without writing anything.

```bash
npx course status [options]
```

| Flag                     | Description                                           |
| ------------------------ | ----------------------------------------------------- |
| `-m, --module <name...>` | Only report on these module folder names (repeatable) |

`status` reads Canvas on every run: there is no offline mode.

### `validate`

Check course content for errors before pushing.

```bash
npx course validate
```

No flags beyond `-h`.

## Modules

### `new-module`

Create a new course module folder with `_category_.json`.

```bash
npx course new-module [options]
```

| Flag                      | Description                                      |
| ------------------------- | ------------------------------------------------ |
| `-n, --name <name>`       | Module name (skips the interactive prompt)       |
| `-p, --position <number>` | Position number (default: after the last module) |

### `move-module`

Move a course module to a different position.

```bash
npx course move-module [options]
```

| Flag                      | Description                                                           |
| ------------------------- | --------------------------------------------------------------------- |
| `-m, --module <folder>`   | Module folder name (with `--position`, skips the interactive prompts) |
| `-p, --position <number>` | New position                                                          |

### `rename-module`

Rename a course module.

```bash
npx course rename-module [options]
```

| Flag                    | Description                                                       |
| ----------------------- | ----------------------------------------------------------------- |
| `-m, --module <folder>` | Module folder name (with `--name`, skips the interactive prompts) |
| `-n, --name <name>`     | New module name                                                   |

### `delete-module`

Delete a course module and renumber remaining modules.

```bash
npx course delete-module [options]
```

| Flag                    | Description                                                   |
| ----------------------- | ------------------------------------------------------------- |
| `-m, --module <folder>` | Module folder name (skips the interactive prompt)             |
| `-y, --yes`             | Confirm deletion without prompting (required with `--module`) |

None of the module commands touch Canvas; the object stays there, reported as
`Orphaned on Canvas`, until a prune removes it.

## Items

Item commands auto-detect the current module when run from inside a module
folder.

### `new-item`

Create a new item (page, assignment, discussion, url, subsection, file) in a
module.

```bash
npx course new-item [options]
```

| Flag                        | Description                                                       |
| --------------------------- | ----------------------------------------------------------------- |
| `-m, --module <folder>`     | Module folder name (with `--type`, skips the interactive prompts) |
| `-s, --subsection <folder>` | Subsection folder name within the module                          |
| `-t, --type <type>`         | Item type: page, assignment, discussion, url, subsection, file    |
| `-n, --name <name>`         | Item name (required unless `--type` is file)                      |
| `-p, --position <number>`   | Position (default: after the last item)                           |
| `--url <url>`               | External URL (for type url)                                       |
| `--points <number>`         | Points possible (for type assignment)                             |
| `--file <path>`             | Path to the file to add (for type file)                           |

### `move-item`

Move an item to a new position within its module.

```bash
npx course move-item [options]
```

| Flag                      | Description                                                         |
| ------------------------- | ------------------------------------------------------------------- |
| `--path <path>`           | Path to the item (with `--position`, skips the interactive prompts) |
| `-p, --position <number>` | New position                                                        |

### `movetomodule-item`

Move an item to a different module.

```bash
npx course movetomodule-item [options]
```

| Flag                       | Description                                                          |
| -------------------------- | -------------------------------------------------------------------- |
| `--path <path>`            | Path to the item (with `--to-module`, skips the interactive prompts) |
| `--to-module <folder>`     | Destination module folder name                                       |
| `--to-subsection <folder>` | Destination subsection folder name                                   |
| `-p, --position <number>`  | Position in the destination (default: last)                          |

### `rename-item`

Rename an item in a module.

```bash
npx course rename-item [options]
```

| Flag                | Description                                                     |
| ------------------- | --------------------------------------------------------------- |
| `--path <path>`     | Path to the item (with `--name`, skips the interactive prompts) |
| `-n, --name <name>` | New item name                                                   |

### `delete-item`

Delete an item from a module and renumber remaining items.

```bash
npx course delete-item [options]
```

| Flag            | Description                                                 |
| --------------- | ----------------------------------------------------------- |
| `--path <path>` | Path to the item (skips the interactive prompts)            |
| `-y, --yes`     | Confirm deletion without prompting (required with `--path`) |

### `merge-items`

Merge two items in a module into one. The source's body is appended to the
target's under a `##` heading carrying the source's title, so the merged-in
material keeps its name and its start is visible on the page.

```bash
npx course merge-items [options]
```

| Flag                  | Description                                                                                         |
| --------------------- | --------------------------------------------------------------------------------------------------- |
| `-s, --source <path>` | Source file, appended under its title then deleted (with `--target`, skips the interactive prompts) |
| `-t, --target <path>` | Path to target file (keeps frontmatter)                                                             |
| `-y, --yes`           | Confirm deleting the source without prompting (required with `--source` and `--target`)             |

### `split-item`

Split an item at a given line into two files.

```bash
npx course split-item [options]
```

| Flag                  | Description                                                              |
| --------------------- | ------------------------------------------------------------------------ |
| `-f, --file <path>`   | Path to the file to split (with `--line`, skips the interactive prompts) |
| `-l, --line <number>` | Line number to split at                                                  |
| `--title <name>`      | Title for the new second file (only read with `--file` and `--line`)     |

None of the item commands touch Canvas either; see the note under
[Modules](#modules).

## Glossary

### `build-glossary`

Regenerate module glossary pages from the canonical glossary YAML.

```bash
npx course build-glossary [options]
```

| Flag                    | Description                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------ |
| `-m, --module <name>`   | Only rebuild a specific module folder name                                           |
| `-g, --glossary <path>` | Path to the glossary YAML file (default: `sources/reference-materials/glossary.yml`) |
| `--check`               | Do not write; exit non-zero if any page is out of date                               |

`--check` is the one built for CI or a pre-push hook. See the
[lesson workflow](lesson-workflow.md) for the glossary file format.

## Checks

### `check`

Run every pre-ship check and exit non-zero if any failed.

```bash
npx course check
```

No flags beyond `-h`. The checks run in this order, each as its own process so
one failure does not stop the rest: `validate`; `build-glossary --check` when
`sources/reference-materials/glossary.yml` exists, reported as skipped when it
does not; `check-links`; then every entry of `checks.extra` in
`course.config.yml`, split on whitespace into a subcommand and its flags. An
entry the CLI does not know fails the run. `npm run hooks:install` installs
`scripts/pre-push`, which runs this command before every `git push`;
`git push --no-verify` bypasses it. The course CI workflow,
`.github/workflows/course-checks.yml`, runs it too.

### `check-links`

Report every relative markdown or image link whose target does not exist on
disk.

```bash
npx course check-links [options]
```

| Flag              | Description                                                   |
| ----------------- | ------------------------------------------------------------- |
| `--root <folder>` | Scan this folder instead of the configured roots (repeatable) |

The roots are `checks.links.roots` in `course.config.yml`, `course` alone by
default. `validate` already resolves the links between the items it scans; this
is the plain filesystem check beside it. It reads every `.md` file under each
root, `course/index.md`, `course/LICENSE.md` and folders nested deeper than a
module takes included, and asks of each relative link only whether the target
exists. Links in code blocks and inline code are ignored, and external URLs,
`mailto:` and site-absolute paths are left alone. Exits non-zero when any link
is broken. See [pre-ship checks](customisation.md#pre-ship-checks) for the
config key.

## Search

### `search`

Find a word or phrase in your course markdown files.

```bash
npx course search [options] <keyword>
```

| Flag                    | Description                                             |
| ----------------------- | ------------------------------------------------------- |
| `-C, --context <lines>` | Lines of context to show around each match (default: 2) |
| `--evaluations`         | Also search the `evaluations/` directory                |
| `--sources`             | Also search the `sources/` directory                    |
| `--case-sensitive`      | Match upper/lower case exactly                          |

By default only `course/` is searched.

## Export

### `export`

Export course materials to PDF, DOCX or plain markdown (PDF and DOCX need pandoc
and typst).

```bash
npx course export [options] [paths...]
```

| Flag                     | Description                                         |
| ------------------------ | --------------------------------------------------- |
| `-m, --module <folder>`  | Export one full module                              |
| `--toc <file>`           | Export the items listed in a TOC file               |
| `--flagged`              | Only include items with frontmatter `export: true`  |
| `-f, --format <format>`  | Output format: pdf, docx or md (default: pdf)       |
| `-o, --output <path>`    | Output file path                                    |
| `--title <text>`         | Title-page title                                    |
| `--subtitle <text>`      | Title-page subtitle                                 |
| `--style <name\|path>`   | Export style to use, overriding `course.config.yml` |
| `--template <path>`      | Override the Typst template                         |
| `--reference-doc <path>` | Override the reference.docx                         |
| `--var <key=value>`      | Pandoc variable (repeatable)                        |
| `--keep-markdown`        | Also write the intermediate combined markdown       |
| `--sample`               | Export the kitchen-sink style sample                |

`-f md` writes the same selection as a plain markdown file, needs neither pandoc
nor typst, and ignores `--style`, `--template`, `--reference-doc`, `--var` and
`--keep-markdown`.

With no path, module, TOC or `--flagged` scope, `export` renders the whole
course. See [Exporting](exporting.md) for the install requirements and every
scope, and [Export styling](export-styling.md) for `--var` and the style files.

### `export-toc`

Write a TOC file listing course items, for a curated export.

```bash
npx course export-toc [options]
```

| Flag                    | Description                                     |
| ----------------------- | ----------------------------------------------- |
| `-m, --module <folder>` | Only list items from one module                 |
| `--flagged`             | Only list items with frontmatter `export: true` |
| `--title <text>`        | Title for the TOC frontmatter                   |
| `--subtitle <text>`     | Subtitle for the TOC frontmatter                |
| `-o, --output <path>`   | Output file path (default `exports/toc.md`)     |

## Advanced

`reset-sync-state` and `reset-canvas` are destructive. Read
[Advanced commands](advanced-commands.md) and
[Backing up a Canvas course](backups.md) before running either.

### `reset-sync-state`

Delete `.canvas-sync.json`, so the course forgets every Canvas id it holds.

```bash
npx course reset-sync-state
```

No flags beyond `-h`.

### `reset-canvas`

Delete all modules, pages, assignments, and files from the Canvas course.

```bash
npx course reset-canvas [options]
```

| Flag        | Description                                          |
| ----------- | ---------------------------------------------------- |
| `--dry-run` | Show what would be deleted without deleting anything |

## Global Flags

These sit before the subcommand: `npx course --verbose sync`, not
`npx course sync --verbose`.

| Flag            | Description                                     |
| --------------- | ----------------------------------------------- |
| `-V, --version` | Output the version number                       |
| `-v, --verbose` | Show detailed output including API request info |
| `-q, --quiet`   | Only show errors                                |

```bash
npx course --verbose sync   # show API request details
npx course --quiet push     # only show errors
```

## npm Scripts

From the root `package.json`.

| Script                   | Runs                                          | Extension equivalent             |
| ------------------------ | --------------------------------------------- | -------------------------------- |
| `npm start`              | `docusaurus start`, the live preview          | **Course: Preview**              |
| `npm run build`          | `docusaurus build`, the production build      | none                             |
| `npm run serve`          | `docusaurus serve`, serves that build         | none                             |
| `npm run format`         | `prettier --write .`                          | none                             |
| `npm run lint`           | `eslint .`                                    | none                             |
| `npm run vscode:install` | Packages and installs the extension itself    | none (it installs the extension) |
| `npm test`               | `node --test "test/**/*.test.js"`             | none                             |
| `npm run check`          | `npx course check`, every pre-ship check      | **Course: Check**                |
| `npm run hooks:install`  | Installs `scripts/pre-push` into `.git/hooks` | none                             |

`npm start` and `npm run check` are the two the extension covers. `npm install`,
the build, the formatter and every git command are yours to type.

`package.json` also carries thin aliases for the commands above (`canvas:sync`,
`canvas:push`, `module:new`, `item:rename` and the rest). They run the same CLI
and take no flags of their own, so `npx course <command>` is the form the docs
use throughout.

## What Only the Terminal Can Do

The extension reaches every `npx course` subcommand but `check-links`, which
**Course: Check** runs as one of its checks, and not every flag. These have no
route through the sidebar or the palette:

| Capability                                                                                                        | Terminal only |
| ----------------------------------------------------------------------------------------------------------------- | ------------- |
| Every prune flag (`sync --prune`, `--prune-canvas`, `--prune-local`; `push --prune-canvas`; `pull --prune-local`) | yes           |
| `sync --conflict`, `sync --order`, `sync -y`                                                                      | yes           |
| `pull --force`                                                                                                    | yes           |
| `search -C`, `--evaluations`, `--sources`, `--case-sensitive`                                                     | yes           |
| `export -o`, `--title`, `--subtitle`, `--style`, `--var`, `-f md`                                                 | yes           |
| `build-glossary --check`, `-m`, `-g`                                                                              | yes           |
| `check-links` on its own, and its `--root`                                                                        | yes           |
| `reset-canvas --dry-run`                                                                                          | yes           |
| `new-item --position` and `new-module --position` (the panel appends; reorder afterwards with move or drag)       | yes           |
| Multi-module `sync -m a -m b` (the panel only ever passes one module)                                             | yes           |
