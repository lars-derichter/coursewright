# Contributing

Contributions are welcome: a bug report, a feature suggestion, or a pull request
with a fix. Everyone taking part is expected to follow the
[code of conduct](../CODE_OF_CONDUCT.md). For a technical overview of the
codebase (the three layers, the sync state, the reconcile engine the four sync
commands share, and link resolution), start at [architecture](architecture.md).

## Reporting an Issue

If something isn't working as expected, open an issue on GitHub:

1. Go to the **Issues** tab on
   [the original Coursewright project page.](https://github.com/lars-derichter/coursewright)
2. Click **New issue**.
3. Pick the form that fits (bug report, idea, or documentation problem) and fill
   it in. The forms ask for exactly what's listed below, so you don't have to
   remember it. "Open a blank issue" is still there for anything that fits none
   of them.

A good issue report includes:

- **A descriptive title**: e.g. "Push fails when module folder contains spaces"
  rather than "push broken"
- **What you expected** vs **what actually happened**
- **Steps to reproduce** the problem: what commands did you run, in what order?
- **Error messages or screenshots**: copy the full error output from the
  terminal if possible
- **Your environment**: operating system and Node.js version (`node --version`)
  if relevant

> [!TIP]
>
> Even if you're not sure whether something is a bug, feel free to open an
> issue. It might reveal a documentation gap or an edge case worth handling.

> [!WARNING]
>
> One exception: if what you found is a security vulnerability, don't open a
> public issue. Report it privately as described in the
> [security policy](../SECURITY.md). The same page explains how to handle your
> Canvas API token: never paste it into an issue or a log excerpt.

## Suggesting Improvements

For a new feature or a better workflow, open an issue the same way, but
describe:

- **What you'd like**: the feature or change you have in mind
- **Why it would help**: the use case or problem it solves
- **How you use Coursewright today**: this helps prioritise what matters most

Check the [ideas list](roadmap.md) first: your idea may already be there.

## Contributing with a Pull Request

If you'd like to contribute a fix or improvement yourself, follow these steps:

1. **Fork** the original Coursewright project. On the project page, click the
   **Fork** button in the top-right corner to create a copy under your account.

2. **Create a branch** off `develop`, not off `main`:

   ```bash
   git checkout develop
   git checkout -b fix-push-spaces
   ```

   Use a short, descriptive branch name that reflects what the change does.
   [Branches](#branches) explains why `develop` is the one to build on.

3. **Make your changes** and commit them:

   ```bash
   git add .
   git commit -m "Fix push failing when module folder contains spaces"
   ```

4. **Test your changes** (see [Tests](tests.md) for the test setup and how to
   write new tests):

   ```bash
   npm run build      # the production build publishing runs
   npm test           # the automated tests
   npm run lint       # code defects
   npm run format     # apply Prettier
   npm run lint:links # documentation links and anchors
   ```

   CI runs the first three, `npm run format:check`, and the extension-host smoke
   test (`npm run test:vscode`). It does not run `npm run lint:links`, which is
   the only check that covers links under `docs/`: the Docusaurus build
   validates what it builds, and its docs plugin is scoped to `course/`. That
   one needs [lychee](https://lychee.cli.rs/) (`brew install lychee`, or a
   binary from its releases page); skip it if you changed no markdown.

5. **Push** your branch to your fork:

   ```bash
   git push -u origin fix-push-spaces
   ```

6. **Open a pull request**. Go to your fork on GitHub, and you'll see a banner
   offering to create a pull request. Click **Compare & pull request**. **Change
   the base branch to `develop`**: GitHub offers `main`, because that is the
   default branch, and a pull request against it will be asked to move. The
   description comes prefilled with a short template; write over the prompts and
   tick the checklist.

### What Makes a Good Pull Request

- **Keep it focused**: one fix or feature per pull request. Smaller changes are
  easier to review and merge.
- **Write a clear title and description**: explain what the change does and why.
  If there's a related issue, mention it (e.g. "Fixes #12").
- **Run the checks in step 4 first**, and make sure `npm run format` leaves
  nothing to change.

> [!TIP]
>
> If you are not sure your idea is worth a pull request, open an issue first to
> discuss it. That way you won't spend time on something that might not fit the
> project direction.

The tooling is [MIT licensed](../LICENSE); by opening a pull request you agree
your contribution is released under the same licence.

## Contributing a Skill

Skills follow a shared template, described in
[Writing your own skills](writing-skills.md). A skill that would help other
courses is welcome as a pull request; the template's course-agnostic and
language-agnostic rules apply doubly to one meant for courses other than your
own.

If your change renames or removes a skill folder or a docs file, add the old
path as it exists in downstream projects (e.g. `.agents/skills/<old-name>`) to
`STALE_PATHS` in [update-from-upstream.sh](../update-from-upstream.sh), so
downstream projects prune it on their next update.

## Code Style

Prettier owns formatting and ESLint reports defects, so neither needs to come up
in review. Run `npm run format` before you commit; `npm run lint` and
`npm run format:check` both run in CI.

The Prettier config is deliberately small. The defaults already matched the
codebase, so only three options are set:

- `proseWrap: always` wraps prose at 80 characters, the rule the next section
  describes.
- `embeddedLanguageFormatting: off` keeps Prettier out of fenced code blocks,
  which in this repo are instructional content: a deliberately indented YAML
  example in [Frontmatter](frontmatter.md), or a course code sample showing a
  particular style, has to render exactly as written. It also switches off YAML
  frontmatter formatting, which is what lets the CLI splice a line into a file's
  frontmatter without reformatting it and still pass `prettier --check`. Under
  `auto`, Prettier normalises key spacing and the whitespace inside an inline
  list, and moves a value onto its own line when it shares that line with a
  comment.
- YAML keeps double quotes; everything else uses single.

`.prettierrc.json` is read at runtime as well as by `npm run format`: the CLI
formats every markdown file it writes into `course/` against the same resolved
config, which is why `prettier` is a runtime dependency rather than a
development one. Sync fingerprints files by their contents, so it needs one
canonical form of each, and changing an option above changes what a pull writes.

One write is carved out. `writeTitleIfAbsent` in `lib/sync/apply.js` splices a
`title:` line into a file that declares none, through `insertFrontmatterKey`,
and formats nothing: the rest of the file is the author's, the run had otherwise
only read it, and reformatting it would put changes they never made into their
working tree. It costs nothing against `prettier --check`, because the option
above leaves frontmatter alone.

`.editorconfig` covers the file types Prettier cannot parse:
`update-from-upstream.sh`, `export-styles/filter.lua`, the Typst templates.

One repo-wide reformat is recorded in `.git-blame-ignore-revs`. GitHub skips it
automatically; to skip it locally too:

```bash
git config blame.ignoreRevsFile .git-blame-ignore-revs
```

## Documentation Style

Everything in this project is written in English, and every heading takes its
case from [`context/writing-style.md`](../context/writing-style.md): Chicago
title case, with the carve-out that guide defines for the sentence-case labels
the tooling generates.

The project's own docs (`docs/`, the README, and `AGENTS.md`) add UK spelling
(customise, colour), lines wrapped at 80 characters, and the
**colleague-facing** register from the same guide: direct and dry, no
readability cap, front-load the point, no trailing summaries, and a list of AI
tells to avoid. Write for a colleague who teaches, not for a student and not for
a compiler.

`course/` and `evaluations/` follow the guide in full, in its **student-facing**
register: warm, direct, second person, CEFR B2, with the page-title emoji and
callouts it defines for course pages. The built-in tutorial module is a course
in its own right, the first thing a new user reads, and the end-to-end
acceptance test for Canvas sync, so it has to keep exercising every content type
a repository can create on its own: pages, an assignment, a discussion, an
external URL and file items, one of them inside a subsection. The other two
types, a quiz and an external tool, are references to Canvas objects a fresh
course does not have, so neither can ship as a working example.

Two of those file items are the course exported to PDF and to Word, committed
under `course/01-getting-started/_files/`, so the module demonstrates the export
route with its own output. They go stale the moment you edit a page in it, and
nothing in CI notices, so regenerate both after any change under
`course/01-getting-started/`, once Prettier has run:

```bash
npx course export -f pdf -o course/01-getting-started/_files/coursewright.pdf
npx course export -f docx -o course/01-getting-started/_files/coursewright.docx
```

Each document ends with an attachment card pointing at itself, because the two
file items are part of what gets exported. That is intended, and it settles
after one run: the wrappers do not change, so a second export has the same
content as the first.

The per-course guides in `context/` govern course content. A course author is
free to rewrite them; the project's own docs are not theirs to restyle, because
an upstream update overwrites them.

Two sets of files are deliberate exceptions. The style baselines in `templates/`
are each written in the language and variety they prescribe, so two of the four
are in Dutch and one is in US English. And the Dutch course scaffolds
(`course-context-nl.md`, `README-course-nl.md`, `course-index-nl.md`) keep
sentence-case headings, because that is Dutch convention. Leave both sets that
way. Prettier does reflow their prose and normalise their list markers, but it
changes neither language nor heading case, so what the exception protects is
untouched.

## Branches

Two branches, and the split is not a formality.

- **`develop`** is where the work goes. Everything since the last release lives
  here.
- **`main`** holds released states only. It is the branch
  [`update-from-upstream.sh`](updating-your-project.md) merges from, so every
  commit on it is one every course project pulls, and the branch
  [`.github/workflows/deploy.yml`](hosting.md) publishes to
  [coursewright.md](https://coursewright.md/), so every commit on it is one
  every visitor sees. It moves at a release and at no other time.

`main` stays the repository's default branch, because **Use this template**
copies whatever the default is and a new course should start from a release, not
from work in progress. That is also why a pull request opens against `main` by
default and has to be pointed at `develop` by hand.

Every change carries its own `## Unreleased` entry in `CHANGELOG.md`, in the
same commit as the change. Writing the changelog as the work lands is what makes
a release a rename rather than an archaeology session.

## Releasing

A release merges `develop` into `main` and tags it there. The version number
lives in three files: `package.json`, which `npx course --version` prints and an
upstream update carries into every course project; `package-lock.json`, which
repeats it; and the extension's
`.vscode/extensions/course-manager/package.json`, which VS Code shows next to
Course Manager in the Extensions view. `test/release-hygiene.test.js` fails
while they differ, so `npm test` catches a bump that reached only one. A bug fix
bumps the patch number, a new feature the minor, and a change that breaks an
existing project (a `schema_version` bump in `.canvas-sync.json`, a renamed
command) the major.

1. On `develop`, rename `## Unreleased` in `CHANGELOG.md` to the new version
   number and today's date. The next change in behaviour opens a fresh
   `## Unreleased` above it.

2. Bump the version everywhere it lives. `npm version` also updates
   `package-lock.json`, which is why the number is not edited by hand:

   ```bash
   npm version 1.0.1 --no-git-tag-version
   npm --prefix .vscode/extensions/course-manager version 1.0.1 --no-git-tag-version
   ```

3. Run the checks in
   [step 4 of the pull request guide](#contributing-with-a-pull-request) and
   commit as `Release 1.0.1`.

4. Fast-forward `main` onto that commit and tag it there. `--ff-only` is the
   check that `main` holds nothing `develop` does not: if it refuses, something
   was committed to `main` outside a release and has to be sorted out first.

   ```bash
   git checkout main
   git merge --ff-only develop
   git tag -a v1.0.1 -m "Release 1.0.1"
   git push --follow-tags
   git checkout develop && git push
   ```

   `--follow-tags` is the word that carries the tag, and a plain `git push` here
   leaves it behind on your machine: `main` publishes, the release never
   happens, and nothing anywhere says so. Making it the default costs nothing,
   since the flag pushes only annotated tags reachable from what is being pushed
   anyway:

   ```bash
   git config --global push.followTags true
   ```

5. Nothing. `.github/workflows/release.yml` runs on the pushed tag and creates
   the GitHub release from it, titled with the version and carrying that
   version's `CHANGELOG.md` section as its notes.

   It fails rather than publishing empty notes when the changelog has no section
   for the version, which is what a skipped step 1 looks like from here.
   `npm test` catches that before the tag is cut, so it should not get this far.
   If it does, fix the changelog on `develop` and re-run the workflow from the
   Actions tab, or publish by hand:

   ```bash
   node scripts/changelog-section.js v1.0.1 > notes.md
   gh release create v1.0.1 --title 1.0.1 --notes-file notes.md
   ```

Pushing `main` is what publishes: it deploys the site and is what every course
project's next update pulls. Pushing the tag is what announces it, through the
release workflow above. Nothing else about a release reaches anyone.

The tag is what lets a course project name the release it is on. A project made
with **Use this template** shares no history with this repository, so git there
has nothing but the tags to go on: `git fetch upstream` brings them along, and
`update-from-upstream.sh` records the upstream commit it merged as
`last-upstream-merge`, which `git describe` resolves against the nearest release
tag. See
[which version you are on](updating-your-project.md#which-version-you-are-on).
Without the tag, a project knows its version only from `package.json`.
