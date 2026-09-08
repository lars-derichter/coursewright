# Tests

The project uses the built-in
[Node.js test runner](https://nodejs.org/api/test.html) (`node:test` +
`node:assert`). One test runs somewhere else: the extension-host smoke test
boots a real VS Code. `@vscode/test-electron` downloads that editor and
`@vscode/vsce` packages the extension for it, and those two are the only test
dependencies in the project.

## Running Tests

```bash
npm test
```

```bash
npm run test:template
```

```bash
npm run test:vscode
```

The second is [the template suite](#the-two-suites). The third is the
[extension-host smoke test](#the-extension-host-smoke-test) and is deliberately
not part of `npm test`: its first run downloads about 130MB of VS Code.

### The Two Suites

`npm test` has to pass in a course repository as well as in this one. A course
author replaces `README.md`, `course/index.md` and both guides in `context/` —
that is what the setup wizard is for — so a test asserting those files still
hold shipped content passes here and fails everywhere the template is actually
used.

Those checks are worth keeping: they are what catches `context/writing-style.md`
drifting from `templates/writing-style-en.md`, which would make
`npx course setup` refuse to install a template into a fresh project. They just
belong to this repository rather than to the tooling. So they live in
`test/template/`, named `*.check.js` so the `test/**/*.test.js` glob does not
reach them, and run as `npm run test:template`. CI runs both suites, so a real
regression still fails loudly here.

Two files are in there. `setup-integrity.check.js` holds the wizard's
pristine-detection checks. `docs-labels.check.js` walks every tracked markdown
file, a course's own pages included, so it would fail on any course that writes
"Course:" in its material; both sides of what it compares are the tooling's own,
so a course repository running it could catch nothing the author caused.

The rule for a new check: if it reads a file the author owns, it belongs in
`test/template/`.

CI carries the same split, and for a while it did not. Every course project
inherits `.github/workflows/test.yml` along with the rest of the template, and
that workflow ran the template suite everywhere — so a course author, who is
told to replace exactly the files it reads, got failure mail from a workflow
they never wrote. Both jobs in it are now guarded by
`if: endsWith(github.repository, '/coursewright')`. Matching the repository name
rather than the whole `owner/name` is what keeps a fork working: a contributor's
fork keeps the name, a course does not. `course-checks.yml` is the workflow that
runs in a course, and it asks about the course rather than about the tooling —
`npx course check` and `npm run build`. That one is ungated, so a break in it
fails here before every course inherits it.

The glob in that script is double-quoted (`"test/**/*.test.js"`), and it has to
stay that way. npm runs scripts through `cmd.exe` on Windows, and cmd does not
strip single quotes the way `sh` does, so the single-quoted form arrives at
`node --test` with its quote characters still attached and matches nothing. Node
does not call that an error: its guard for a run that matched no files is
skipped whenever the pattern contains glob magic, and the `*` still counts as
magic inside quotes that have made the whole string literal. So the suite
reports `tests 0`, exits 0, and passes on Windows without running a single test.
Both shells strip double quotes, which is what makes that form the portable one.

`scripts/check-test-glob.js` runs as `pretest` and holds the line: it globs the
same pattern, checks that the `test` and `pretest` scripts still spell it
identically, and fails the run when the pattern matches implausibly few files.
The mistake is loud instead of silent, on a developer's machine as well as in
CI.

## Test Structure

Tests live in `test/` and mirror the layout of the source directories they
cover: `test/canvas/` for `lib/canvas/`, `test/cli/` for `cli/`, `test/config/`
for `lib/config/`, `test/convert/` for `lib/convert/`, `test/export/` for
`lib/export/`, `test/sync/` for `lib/sync/`, `test/plugins/` for `src/plugins/`,
and `test/vscode/` for the bundled VS Code extension. Each file is named after
what it covers, e.g. `test/convert/course-scanner.test.js` or
`test/cli/push-helpers.test.js`.

Four places break that pattern. `test/template/` holds
[the template suite](#the-two-suites), which `npm test` does not run.
`test/helpers/` holds no tests: it is the shared `canvas-mock.js`, which stands
in for the Canvas API over `fetch`; `prettier-config.js`, which gives a
temporary course tree the same Prettier settings the repo has, so a write in a
test formats the way it does in production; and `points-cases.js`, the table of
`--points` spellings that the CLI's reader and the extension's copy of its rule
are each held to in their own test. `test/vscode/host/` holds no `*.test.js`
either, because nothing in it runs under `node --test`: it is the extension-host
smoke test, whose files are a launcher, the cases that run inside VS Code, and
an empty extension manifest. And `test/source-hygiene.test.js` and
`test/release-hygiene.test.js` sit at the root because each covers the whole
project rather than one directory: the first the source tree, the second the
version number every release has to carry into three manifests at once.

Coverage spans the config layer (`lib/config/`), the conversion layer
(`lib/convert/`), the export layer (`lib/export/`), the reconcile engine
(`lib/sync/`), the Canvas HTTP client and helpers (`lib/canvas/`), CLI command
helpers (`cli/`), the Docusaurus remark plugins (`src/plugins/`), and the local
VS Code extension (`.vscode/extensions/course-manager/`). `test/sync/` is the
largest of these, with one file per stage of the engine: `gather`,
`fingerprint`, `plan`, `apply-plan`, `canvas-write`, `local-write`,
`rename-detect` and `state`, plus `apply-embedded-files` and `apply-file-items`
for the two write paths that need a filesystem. Tests that exercise filesystem
behaviour (`course-scanner`, `merge-items`, `split-item`, `renumber`,
`pull-command`) create a temporary directory with fixture files and clean it up
afterwards. The export tests stay CI-safe by never spawning pandoc or Typst:
`preflight` takes an injectable exec, and the rest operate on strings.

## Manual End-to-End Checks

Some paths need the real pandoc/Typst toolchain (and, for the sidebar, VS Code),
so they are verified by hand rather than in the automated suite:

- `npx course export --sample -f pdf` and `-f docx`: the style sample renders.
- `npx course export --sample -f pdf --style thomas-more`, then the same with
  `theme: thomas-more` in `course.config.yml`: style and theme change the output
  independently.
- `npx course export -m 01-getting-started`: a module with alerts, a discussion,
  an SVG file item, an external URL, a subfolder and a file item inside a
  subsection renders as one document.
- `npx course export -m 01-getting-started -f md`: the same module as one plain
  markdown file. Alerts are still `> [!NOTE]` blocks, images are down to their
  alt text, and file items read as `Attachment:` lines.
  `grep -nE ':::|\{#|/Users/|<!--' exports/01-getting-started.md` returns
  nothing. A bare `---` does turn up, because the tutorial teaches horizontal
  rules and shows frontmatter inside code blocks, so do not grep for it.
- The two-step TOC flow: `npx course export-toc`, delete some lines, then
  `npx course export --toc exports/toc.md`.
- `npx course export --flagged` after setting `export: true` on a few items.
- VS Code: multi-select several items in the sidebar and export them together.
- The `/export-style-init` and `/export-style-update` skills: derive or tweak a
  style and confirm the regenerated sample reflects it.

## Manual Sync End-to-End Checklist

> [!WARNING]
>
> Every step here writes to a real Canvas course, and several of them delete
> content Canvas cannot bring back. Use a disposable course with no students in
> it, and read [Backing up a Canvas course](backups.md) before you start.

The checks above are one command each. This one is a sequence: it walks the
reconcile engine end to end against a live Canvas instance, and each step leaves
the course in the state the next one assumes. Point `.env` at the disposable
course, and run it from a scratch clone so its `.canvas-sync.json` never lands
in the real tree.

"Clean" below means the run planned no actions and exited 0. It does not mean
`.canvas-sync.json` came out byte-identical: `sync`, `push` and `pull` stamp
`last_sync` even on a run with nothing to do, and only `status` writes nothing
at all.

1. **Empty both sides.** `npx course reset-canvas --dry-run`, then
   `npx course reset-canvas`, then `npx course reset-sync-state`. The dry run
   counts what it would delete (so many modules, pages, assignments and files)
   and deletes nothing; the only content it names one by one is the quiz-backed
   assignments it is skipping, the New Quizzes it is not, and any assignment
   carrying submissions or whose submission state Canvas would not say. The real
   run empties the course and exits 0; a declined confirmation, or an input
   stream that ends without answering, deletes nothing and exits 1, while a
   piped `y` confirms like a typed one. `reset-canvas` leaves
   `.canvas-sync.json` alone, which is why the third command is not optional.
2. **First push.** `npx course push`. Every module and item is created, and
   `.canvas-sync.json` comes back with a row per item. No first-push
   confirmation appears: that question only fires on a course that already holds
   content.
3. **The no-op quartet.** `npx course push`, then `status`, `sync` and `pull`.
   All four clean, nothing written on either side, `git status` quiet under
   `course/`. This is the round-trip drift check: what Canvas's own editor
   rewrites on the way in has to be absorbed by the fingerprint rather than
   reported as a change.
4. **Exact rename.** Rename one item's file by hand, leaving its bytes
   untouched, then `npx course sync`. One `rekey-base`, no Canvas write, the
   module item id unchanged.
5. **Probable rename.** Rename a second item's file _and_ edit its body, keeping
   its `title:`, then `npx course sync`. Non-interactively the pair is reported
   and parked: nothing deleted, nothing created, exit 0. Answering `y` in a
   terminal re-keys the row and pushes the edit in the same run.
6. **Conflict, once per policy.** Edit one page here and the same page in
   Canvas, sync, then make the pair of edits again before each following run.
   - `--conflict newest`: both timestamps are printed and the newer side wins.
   - `--conflict local` and `--conflict canvas`: the named side wins, unasked.
   - `--conflict ask -y`: the item is skipped, the report names the remedy, and
     the run exits 1.
7. **Embedded files.** Starting from a page that embeds `_files/x.png`:
   - **Add**: `npx course push` uploads the binary and repoints the reference at
     the Canvas file.
   - **Edit**: change the binary's bytes in place. The push runs off the binary
     alone, with no edit to the page, and the run after it is clean. Whether
     Canvas keeps the file id or hands back a new one is Canvas's business:
     nothing here bets on either, so do not fail the step on the id.
   - **Share**: add a file item whose binary is byte-identical to the embedded
     one and goes up under the same name, which is what Canvas deduplicates on,
     so both state rows end up carrying one file id. Delete the file item and
     run `npx course --verbose push --prune-canvas`: the module item goes, the
     Canvas file stays, and the verbose log names the row still holding it (the
     ordinary report does not). Drop the page's reference too, and the next
     whole-course prune sweeps the file and removes its row.
8. **Kill recovery.** Add six new pages, then
   `node cli/index.js sync & sleep 8; kill -9 $!` (kill node itself, not an
   `npx` wrapper). Rerun `npx course sync`: it duplicates at most the one action
   that was in flight when the kill landed. Every action that completed was
   saved as it landed, so its Canvas object is recognised instead of created a
   second time, while `last_sync` still reads as the previous completed run left
   it, because no run since has finished.
9. **Reset the state, then adopt.** `npx course reset-sync-state`, then
   `npx course status`, then `npx course push`. `status` (like `sync`) refuses
   each module holding items on both sides and exits 1. `push` pins a direction
   instead: it adopts every item by type and title, compared trimmed and
   case-folded rather than byte for byte, and the Canvas page and assignment
   counts come out unchanged. A duplicate here is an adoption bug.
10. **Restore.** Put the disposable course back to whatever it is meant to hold,
    and confirm the real repository is untouched.

## Writing New Tests

- Create a `*.test.js` file in the matching `test/` subdirectory.
- Use `describe`/`it` from `node:test` and assertions from `node:assert/strict`.
- The test runner discovers all `test/**/*.test.js` files automatically.

`test/vscode/extension.test.js` is the odd one out: the extension cannot be
loaded outside VS Code, so it reads its source as text and matches patterns
against it. It walks the extension directory rather than naming files, so a new
one is covered the day it is added, and most assertions run over every source
joined together: which of the extension's files a line lives in is not what they
are about. Prettier decides where those lines wrap, so any pattern there has to
span newlines: use `[\s\S]*?` rather than `.*` or `[^\n]*`, and allow for a
trailing comma inside a wrapped call. Assert on what the extension does, never
on how it is laid out.

## The Extension and CLI Contract Test

`test/vscode/cli-contract.test.js` is the guard between the two halves of this
project. It reads every `npx course` command line and every `runCli` argv the
extension builds, reads the commands commander actually registers in
`cli/index.js`, and fails when the two disagree. Without it, a flag renamed on
one side would be found by whoever clicked the button in VS Code; this finds it
on the next `npm test`.

It checks two things and nothing more: the subcommand exists, and every flag
exists on that subcommand (or on the program, since commander accepts
`--verbose` and its three siblings anywhere). It deliberately does not check the
values flags are given, how many positional arguments a command line carries, or
a flag hidden inside a runtime value. The reverse direction is not asserted
either: a CLI flag the extension never uses is ordinary, and the test only
reports it.

Two things about it surprise people the first time.

**It fails on a shape it cannot read, rather than skipping it.** A scan that
quietly ignored what it did not understand would report a green contract over an
unchecked command line, so an argv that is reassigned, spliced, written by
index, spread, or handed to another function is refused by name and line.
Reading the array is fine and needs no ceremony: `args.length`,
`args.join(' ')`, `args.includes(...)`, `args.slice(...)` and `args[0]` are all
accepted, as is a `push` whose first value is a literal flag. If you are
refused, the message names the shape and, where one exists, the list to add to.
The three lists live at the top of the file: `RUNNERS` (functions that hand a
command to the CLI), `NOT_RUNNERS` (helpers that take a list of strings and are
not runners), and `READ_ONLY_CALLEES` (functions that receive an argv array and
only read it).

**It has floors, and they are the point.** A static scan whose pattern stops
matching finds nothing and passes forever, which is the failure
`scripts/check-test-glob.js` exists to prevent elsewhere in this repo. So the
test asserts a minimum number of invocations, per construction shape, and a
minimum number of subcommand+flag pairs. If you genuinely remove commands from
the extension, lower the floor in the same commit, and only then.

Adding a runner is the one change that needs the test edited: put its name in
`RUNNERS`, or everything it runs goes unchecked. The test says so itself when it
sees an argv-shaped array going somewhere it does not recognise.

## The Extension-Host Smoke Test

```bash
npm run test:vscode
```

Every other test of the VS Code extension either reads its source as text or
executes it against `test/vscode/`'s own stub of the `vscode` API. Both are
worth having, and neither can tell you what the real editor does: where the stub
and the host disagree, the stub wins and nobody finds out. This one boots a real
VS Code, installs the extension, and asserts five things inside it: the
extension activates, every command the manifest declares is registered in the
host and no `course.` command is registered that it does not declare, the tree
returns the tutorial module, the provider `activate()` built is bound to a tree
view and the contributed `courseTree` sidebar is the view it is bound to, and
the seven context-menu-only commands are gated out of the palette.

It is not part of `npm test`. The first run downloads about 130MB of VS Code
into `.vscode-test/` (gitignored, and cached in CI); after that a run is about
ten seconds.

Five things about how it is put together are load-bearing, and all five are easy
to undo by accident.

**It runs against the `.vsix`, not the source folder.** `npm run test:vscode`
packages the extension exactly as `npm run vscode:install` does and installs
that artifact, so what the test loads is what a course author's editor loads.
That is what makes it the packaging check [`docs/roadmap.md`](roadmap.md) asks
for before dotenv could be bundled.

**The extensions directory it installs into is outside this repository**, in the
system temp directory. Node resolves a `require` by walking up from the
requiring file, so an extension installed anywhere inside this checkout reaches
the repository's own `node_modules` a few levels up, and then a dependency that
is missing from the package resolves anyway and the test passes. Measured: with
the extensions directory under `.vscode-test/`, an unbundled `require('dotenv')`
added to `helpers.js` activated cleanly and every case passed. The user-data
directory is out there too, for the duller reason that throwaway window state
does not belong in a checkout, which leaves `.vscode-test/` holding the
downloaded editor and nothing else, the only part worth caching in CI. Its name
is kept short as a precaution and not as a fix: VS Code warns when the Unix
domain socket it opens in there passes the 103-character limit, but it survives
that, and a 210-character path under the checkout still ran every case green on
macOS 1.93.

**`test/vscode/host/harness/` is an empty extension**, and it is what puts the
window into extension development mode: VS Code runs `--extensionTestsPath` only
there. Pointing that at the real extension would load it as a development
extension instead of an installed one, which is the thing being avoided.

**It reaches the extension's modules through the require cache, never by
rebuilding their paths.** Two cases wrap a method on
`CourseTreeProvider.prototype` to watch what the live provider does, and that
only works on the module object the host actually loaded. `ext.extensionPath` is
VS Code's spelling of that path, out of a URI; the require cache is keyed by
Node's, out of module resolution; and the two are not guaranteed to agree. On
macOS they already disagree (`/var/folders/…` against `/private/var/folders/…`),
and it works anyway only because Node resolves symlinks on the way in, so both
land on one entry. Windows offers two spelling axes with no such reconciliation:
the drive letter, which VS Code lower-cases and Node does not, and 8.3 short
names, which `os.tmpdir()` hands back on a GitHub runner. A `require` built from
`extensionPath` there produced a second module object with a second prototype,
and both cases failed in 2ms saying they could not reach the provider. Asking
the cache what is already loaded sidesteps the question and adds no entry of its
own. Note that a revert to the path-built form passes on macOS and on Linux: the
Windows CI leg is the only thing that catches it.

**The launcher scrubs the environment before it spawns.** Every VS Code process
sets `ELECTRON_RUN_AS_NODE=1` and a wall of `VSCODE_*` variables in its
children, so running this from VS Code's own integrated terminal starts the
downloaded Electron as a Node interpreter, which then reads VS Code's command
line as Node options and dies on `bad option: --extensionTestsPath`.
`runTests()` from `@vscode/test-electron` does not scrub them, which is one of
the reasons the launcher spawns the host itself; the other is that a wedged
extension host is a CI job that never finishes rather than one that fails, and
neither `runTests()` nor Electron has a timeout.

Two environment variables steer it. `CW_VSCODE_VERSION` picks the VS Code to
run, defaulting to `1.93.0`, the floor in the extension's `engines.vscode`, so
CI is reproducible and the floor is a claim the test actually makes rather than
a number in a manifest. Running it against `stable` now and then is how you find
out that the newest editor broke something. `CW_VSCODE_TIMEOUT_MS` moves the
bound on the host run, which defaults to three minutes.

**One case does not run on Windows, and says so.** Proving that the contributed
sidebar is bound to the tree the extension builds means catching the read VS
Code makes when it draws that sidebar, and a Windows CI runner has no desktop to
draw on: the pane never appeared, and the case sat through its whole bound
waiting for a read on a machine that had run the other eight cases in 120ms.
Linux is fine because it goes through xvfb, which is a display even if nobody is
looking at it. So the check is split. One case proves the binding with no pixels
at all (handing a provider to `createTreeView` makes VS Code subscribe to its
`onDidChangeTreeData` there and then, and nothing else in the extension
subscribes to that emitter), and that one runs everywhere. The other reveals the
view and catches the read, and where the pane never draws it reports itself as
`skip`, with the reason, its own line in the summary and a
`# NOT VERIFIED HERE:` line after it. It is not allowed to skip quietly: if the
pane _does_ draw and the read still does not come, that is a failure, and the
command it uses to tell those two apart is itself pinned on every run where the
read succeeds.

What it does not cover: the palette, the menus and the sidebar as pixels. VS
Code offers no way to ask "is this command in the palette right now", so the
palette assertions are made against the manifest **as the installed extension
carries it**, plus the fact that the commands are registered. Where the sidebar
does not draw, "bound to a tree view" is covered but "bound to _this_ view id"
is not: pointing `createTreeView` at `courseTreeX` is caught only by the case
that needs a rendered pane. Nothing here runs a CLI command: the workspace it
opens is this repository, `.env` and all, so a case that executed a sync would
sync a real Canvas course. And a `when` clause that is malformed rather than
merely wrong is invisible: VS Code 1.93 accepts
`view == courseTree && && (viewItem == module` without a word in any log, and no
test in this project notices.
