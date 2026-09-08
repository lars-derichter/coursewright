# AGENTS.md

Guidance for AI coding agents working in this repository.

Coursewright is a course development system: course materials are written as
markdown, served as a website by Docusaurus, exported to PDF and Word, and
synced with Canvas LMS through its REST API. All tooling is JavaScript on
Node.js 24 or later, CommonJS throughout.

## Which Guide Governs What You Write

- **`course/` and `evaluations/`: read
  [`context/writing-style.md`](context/writing-style.md) first, every session.**
  It defines the language, tone, structure, headings, callouts, punctuation and
  AI-tell patterns for student-facing content. Apply it from the first draft;
  never write course prose, assignment instructions or exam text without having
  read it. If the user asks you to change how you write, offer to run
  `/writing-style-update` so the preference lands there as a durable rule.
- **Lesson design and module generation: read
  [`context/course-context.md`](context/course-context.md) first.** It describes
  the course itself (learning goals, assessment, pedagogy, lesson-plan and
  module conventions, code and download rules, glossary, scope boundaries) and
  drives `/lesson-design`, `/lesson-summarize` and `/lesson-module-build`. A
  section still marked `TODO` means: get the fact from the repo or the user, and
  offer to save it back. `/course-context-init` fills the whole document. When
  the user settles a course-design decision in conversation (a learning-goal
  notation, an assessment rule, a scope boundary, a module convention), offer to
  run `/course-context-update` so it lands there as a durable fact.
- `sources/` (lesson plans, notes, drafts) takes the colleague-facing register
  of the same style guide.
- `docs/`, `README.md` and this file belong to the tooling project, not to the
  course: colleague-facing register, UK spelling, Chicago title case for every
  heading.
  [`docs/contributing.md#documentation-style`](docs/contributing.md#documentation-style)
  is the rule.

## Before Handing Work Back

- `npm run format` (Prettier) and `npm run lint` (ESLint, defects only).
  Prettier owns code formatting and markdown wrapping alike; never hand-format
  code or hand-wrap prose. CI runs `lint` and `format:check`.
- `npm test`, `npm run test:template` and `npm run build`. CI runs all three,
  plus the extension-host smoke test (`npm run test:vscode`).
- **`test/template/*.check.js` holds the checks that only pass here.** They read
  the files a course author replaces — `README.md`, `course/index.md`, the two
  guides in `context/` — so they are deliberately outside the
  `test/**/*.test.js` glob: a course repository must be able to run `npm test`
  green. Never put a check that reads author-owned content into `test/`, and
  never assume the template suite ran just because `npm test` passed. See
  [`docs/tests.md`](docs/tests.md#the-two-suites).
- Two checks pin prose in `docs/`, and neither is obvious from the files.
  `test/template/docs-labels.check.js` reads every tracked markdown file and
  requires each run of text starting with "Course:" to match a command title the
  VS Code extension manifest declares, character for character, and every
  declared title to appear in some markdown file.
  `test/cli/sync-state-guard-docs.test.js` parses backticked `npx course …`
  names out of named passages in `docs/troubleshooting.md`,
  `docs/new-academic-year.md` and `docs/advanced-commands.md`; keep those names
  in backticks.
- `npm run lint:links` after any markdown change
  ([lychee](https://lychee.cli.rs/), `brew install lychee`). It resolves every
  relative link and heading anchor in `README.md`, `AGENTS.md`, `CHANGELOG.md`,
  `docs/`, `course/`, `context/` and the skills. Nothing else does:
  `onBrokenLinks: 'throw'` covers only what Docusaurus builds, and its docs
  plugin is scoped to `course/`, so a stale `user-guide.md#canvas-sync` fails no
  build. It is not in CI, so it is on you. `templates/` is deliberately left
  out, and `lychee.toml` says why.
- `npx course validate` after touching `course/`.
- A change in behaviour gets an entry under `## Unreleased` in `CHANGELOG.md`,
  in the shape of the entries already there, **in the same commit as the change
  itself**. The changelog is written as the work lands, never reconstructed from
  the log at release time.

## Branches

Work goes on `develop`, directly or on a branch off it. `main` holds released
states only, because it is the branch `update-from-upstream.sh` merges from and
the branch `.github/workflows/deploy.yml` publishes to
[coursewright.md](https://coursewright.md/): a commit on `main` is a commit
every course project can pull and every visitor can see.

So never commit to `main` outside a release, and never merge `develop` into it
except as the release itself. That overrides any general "commit on main"
default. [`docs/contributing.md`](docs/contributing.md#releasing) has the
procedure.

## Commands

`npx course --help` lists every command; `npx course <cmd> --help` its flags.
[`docs/cli-reference.md`](docs/cli-reference.md) has the same in prose.

`npx course sync` is the primary command: two-way, newest wins. `push`, `pull`
and `status` are the same engine with one policy pinned: push writes only to
Canvas and makes the local copy win, pull writes only to `course/` and makes
Canvas win, status writes to neither and previews what a sync would do. A run
without a prune flag deletes no item on either side; the one exception is the
Canvas file a renamed binary orphaned, deleted because nothing else would ever
clear it out. [`docs/user-guide.md`](docs/user-guide.md) walks through the four;
[`docs/advanced-commands.md`](docs/advanced-commands.md) covers the two
destructive ones, `reset-sync-state` and `reset-canvas`.

Item commands auto-detect the current module when run from inside a module
folder.

**Read [`docs/limitations.md`](docs/limitations.md) before answering what the
tool does or does not do.** In short: a page, an assignment, a discussion and a
file sync as content, a quiz and an external tool only as a reference to a
Canvas object; quiz questions never cross in either direction; an LTI install
cannot be rebuilt from this repository, because Canvas withholds
`shared_secret`; a push reconciles the item list of every module it manages
rather than rebuilding it; a module takes one level of subfolders, and a deeper
one is dropped with a warning naming it; push and pull are not a merge. Never
suggest a destructive command without pointing at
[`docs/backups.md`](docs/backups.md).

## Architecture

[`docs/architecture.md`](docs/architecture.md) describes the reconcile engine
the four sync commands share, the state schema, resilience, content types,
alerts, link resolution and embedded files.
[`docs/frontmatter.md`](docs/frontmatter.md) documents every frontmatter field.

### Key Directories

- `course/`: the course itself, one folder per module, numbered 00-99, and the
  only tree the website, the exports and the Canvas sync read. Subfolders become
  Canvas text headers; a `_files/` subfolder holds a module's embedded assets. A
  page's frontmatter `title` is its heading in every output, so no body opens
  with a level-1 heading and every section starts at `##`; `npx course validate`
  warns about one. The built-in tutorial module `01-getting-started/` is
  published live at https://coursewright.md/ from this repository and doubles as
  the demo and the Canvas-sync acceptance test
  ([`docs/contributing.md`](docs/contributing.md#documentation-style)): keep one
  live example in it of every content type a fresh course can create, and name
  the Course Manager action first and the terminal command second, as the user
  guide does.
- `evaluations/`: exam and test material, by academic year (convention:
  `2526/`). Not served by Docusaurus.
- `sources/`: reference material, lesson plans, notes. Not served by Docusaurus
  or synced to Canvas.
- `export-styles/`: shipped PDF/DOCX styles, one folder per style, plus the
  shared pandoc pipeline files (`filter.lua`, `defaults.yml`, `sample.md`).
- `src/css/themes/`: shipped colour themes, one CSS file each.
- `src/plugins/`: the remark plugins the preview needs (alerts, link and file
  cards, `.html` links). `docusaurus.config.js` serves `course/` as docs at the
  site root with an autogenerated sidebar.
- `lib/canvas/`: the Canvas REST client (`client.js`: pagination, rate limiting,
  retry) and one module per resource: `modules`, `pages`, `assignments`,
  `discussions` and `files` with full CRUD, `quizzes` and `external-tools`
  read-only by design, `icons` for the alert icons a theme uploads.
- `lib/convert/`: markdown to Canvas HTML and back, link resolution, and
  `course-scanner.js`, which reads the `course/` tree for every command. Every
  frontmatter write goes through `serializeFrontmatter` in `frontmatter.js`,
  never `matter.stringify` directly: gray-matter bundles a js-yaml 3 whose
  dumper escapes an emoji into `\U0001F4D8`, so that function swaps the
  top-level js-yaml in for the dump and keeps gray-matter's parser.
- `lib/sync/`: the reconcile engine. Every sync decision lives here; the four
  commands only choose a policy for it. `gather.js` reads the three inputs (the
  `course/` tree, the Canvas course, and one `git status` per run);
  `fingerprint.js` hashes each side, so a change is detected by content rather
  than by mtime; `plan.js` is the whole decision as one pure function of base,
  local, canvas and policy, returning ranked actions plus every section of the
  report; `apply.js` executes them; `canvas-write.js` and `local-write.js` hold
  the per-type writes for each side; `rename-detect.js` pairs a vanished path
  with a new one; `state.js` loads, saves and validates `.canvas-sync.json`. The
  planner never prompts and never touches the network: an `ask` policy parks the
  question and the command re-plans with the answer.
- `cli/`: the `commander` entry point (`index.js`, with global `--verbose` and
  `--quiet`) and one file per command. `sync.js`, `push.js`, `pull.js` and
  `status.js` are thin policy over `lib/sync/`: they set the flags, ask the
  questions the planner parked and print the report, and decide nothing else.

### Sync State

- `.env`: Canvas API credentials, gitignored.
- `.canvas-sync.json`: **committed, not gitignored.** The single source of item
  identity: which Canvas object each file is, keyed by the file's path under
  `course/`, plus the ids of modules, icons and embedded files
  (`lib/sync/state.js`). No markdown file carries an id, so a push or a pull
  leaves a change here to commit alongside the content that caused it. Only
  `.canvas-sync.json.tmp`, the half-written file an interrupted save leaves
  behind, is ignored.

### Course Configuration

`course.config.yml` holds the committed, per-course settings, loaded by
`lib/config/course-config.js`. [`docs/customisation.md`](docs/customisation.md)
describes them for the author; the rules that matter to code are these.

- `title` names the course: the preview site and its navbar
  (`docusaurus.config.js`), and the document title and filename of a
  whole-course export (`cli/export.js`). It is the machine-readable answer to
  "what is this course called"; unset, it falls back to the language's
  `export.course_title` label, because Docusaurus requires one. `tagline` is an
  optional one-line descriptor: the Docusaurus tagline and the cover subtitle of
  those exports.
- `language` is the machine-readable answer to "what language is this course
  in". It drives every generated student-facing label (alert titles, link and
  file cards, export labels, glossary) and the Docusaurus locale. The built-in
  `en` and `nl` label sets live in `lib/config/labels.js`; `labels:` overrides
  single entries.
- `theme` selects a CSS file of `--cw-*` design tokens from `src/css/themes/`
  (or a path) and is the **single source of truth for colour**.
  `lib/config/theme.js` parses it; the preview site, the Canvas HTML
  (`lib/convert/markdown-to-html.js`), the alert icons (`lib/canvas/icons.js`,
  `src/plugins/remark-gfm-alerts.js`) and the PDF export all read it. Never
  hardcode a colour in those files. DOCX is the exception: its colours live in
  the style's `reference.docx`.
- `export.style` selects a folder from `export-styles/` (or a path) that owns
  PDF/DOCX typography, margins, cover and bundled fonts.
  `lib/export/style-resolver.js` resolves it, and also honours per-file
  overrides in `sources/export-style/` and a `--style` flag.

### Naming Conventions

Filenames and folder names are lowercase, hyphenated and prefixed with a
two-digit number (00-99) for ordering; the prefix is stripped when deriving
Canvas item titles and Docusaurus sidebar labels. A name prefixed with `_` or
`.` is internal: `isInternal` in `lib/convert/course-scanner.js` skips it, so
`_files/`, `_category_.json` and `.DS_Store` are never Canvas items. Hidden from
the scanner is not hidden from sync, though: a local write puts the Canvas
module name into `_category_.json` (`writeCategoryFile`) and downloads embedded
binaries into `_files/` (`downloadReferencedFiles`), both in
`lib/sync/local-write.js`. `_category_.json` is also what Docusaurus reads for a
sidebar label and position.

## VS Code Extension

`.vscode/extensions/course-manager/` is a local extension that exposes the CLI
in the command palette and in a Course Manager view. Install it with
`npm run vscode:install`; [`docs/vscode.md`](docs/vscode.md) is the reference.
Two placement rules are deliberate, so keep them:

- **The view holds no destructive command.** `reset-canvas`, `reset-sync-state`
  and `build-glossary` exist in the palette only, with no entry in the view, its
  title bar or its menus, so no stray click in the tree can start one. The two
  resets run in a terminal, where the CLI's own confirmation prompts still gate
  them.
- Seven commands go the other way, hidden from the palette with a
  `when: "false"` entry under `menus.commandPalette`, because each acts on the
  tree row it was invoked from and does nothing without one.

`extension.js` is activation wiring only. Every command handler but the tree
refresh lives in `commands/`; `CourseTreeProvider.js` builds the tree; the three
things the handlers share each own a file (the terminal pool in `terminal.js`,
the silent CLI runner in `runner.js`, the palette quick picks in `pickers.js`),
with the workspace checks in `workspace.js` and the vscode-free parts in
`helpers.js`.

**`helpers.js` requires Node built-ins only: never `vscode`, never an npm
package.** It holds the parts that do not touch the editor API precisely so
plain `node --test` can load them, and the packaged extension has no
`node_modules` of its own to resolve anything from. That is why it parses `.env`
by hand rather than with `dotenv`; [`docs/vscode.md`](docs/vscode.md) explains
the reasoning and [`docs/roadmap.md`](docs/roadmap.md) records why bundling
dotenv was declined.

## Skills

- Skills (packaged workflows) live in `.agents/skills/<name>/SKILL.md`, in the
  open Agent Skills format. `.claude/skills` is a committed symlink to the same
  directory, so Claude Code discovers them natively. Docs and skill instructions
  write a skill name as `/name` (`/proofread`).
- A skill name is `<object>-<verb>`, object first so related skills sort
  together, with a small verb vocabulary and a few named exceptions.
  [`docs/writing-skills.md`](docs/writing-skills.md) holds the template and the
  naming rule; follow it for a new skill rather than this summary.
- "Session scratchpad" in a skill means a temporary directory outside the repo:
  Claude Code's session scratchpad, or whatever temp directory your tool
  provides. Never write temp files into the repo or `/tmp`.
