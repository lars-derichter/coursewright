# Changelog

## Unreleased

- `npx course validate` warns about a page whose body opens with a level-1
  heading, quoting the line it found. The frontmatter title is the page heading
  in every output: Canvas renders its own page name above the body, Docusaurus
  synthesises an H1 from the title, and both exporters write it as the per-page
  heading. A body that starts with `# Introduction` therefore shows the title
  twice, and the fix is to delete the line and open the first section with `##`.
  Like the other warnings it never fails the run, because the page renders and
  pushes either way.

- Every item in a PDF, Word or markdown export opens with a heading built from
  its frontmatter title, emoji included, whatever the body starts with. Before,
  a leading heading in the body supplied the chapter heading instead, so a page
  whose title carried an emoji printed an emoji-free heading while a file or an
  external-URL item printed one, and the two disagreed inside the same document.
  A page that still opens with `#` now prints its title twice, and
  `npx course validate` names those pages.

- **Course: New Item** and `npx course new-item` write the frontmatter and
  nothing else. The `# Name` line they used to put under it repeated the title,
  which the preview site, Canvas and both exports already show as the page
  heading, so deleting it was the first edit an author made in every new file.

- **Course: Merge Items** and `npx course merge-items` introduce the merged-in
  body with the source item's title as a `##` heading, taken from its
  frontmatter or, failing that, from its filename. The source's own `# Title`
  used to travel along inside its body and marked where the appended material
  began; with no H1 in a page body that seam went to the bin with the source
  file, leaving two pages' prose to run together under one title. Level 2
  because level 1 is the page heading and comes from the target's frontmatter.
  An empty body on either side is left out rather than padded with blank lines,
  so merging a page that was still only frontmatter appends its heading alone.

- `npx course setup` recognises the shipped course home by its frontmatter title
  as well as by the H1 that older copies carry, and the two course-home
  templates it installs put the welcome in the title (`title: Welcome`,
  `title: Welkom`) with no heading in the body. The frontmatter title is the
  page heading in every output now, so the landing page this project publishes
  as its own site carries no `# Title`, while the check deciding whether
  `course/index.md` is still that page read nothing else. `course/` is a
  protected directory in `update-from-upstream.sh`, so a course project that
  pulls this release keeps the landing page it already had: the H1 form stays
  recognised for exactly those copies, which are the ones that still need the
  replacement offer.

## 1.1.1 (2026-09-01)

- **Course: New Item** and `npx course new-item` create a discussion. The list
  of types the two offer was five long while push and pull handled eight, so the
  one content type they left out was the one a course actually writes: a
  discussion had to be hand-written or copied off another file and edited. It
  now sits second in the list, after an assignment, and scaffolds the same shape
  a page does — a title, `canvas_type: discussion` and a heading.
  `discussion_type`, `require_initial_post` and the two dates stay optional and
  are added by hand, because a value nobody chose written into a new file reads
  exactly like one that was.

- A discussion row in the Course Manager tree offers the same right-click menu a
  page row does: **Rename Item**, **Move Item**, **Move Item to Module**,
  **Delete Item** and **Export Item**. The clauses gating those five were
  written when a discussion was sync-only and never widened, so the row carried
  nothing but **Open in Canvas** — and the tree could now create a discussion it
  could not then rename or delete. The CLI behind all five was never the
  problem: it reads files by name whatever type they declare, which is why the
  same commands have always worked on a discussion from the command palette.
  Merge is unchanged and stays pages and assignments only.

## 1.1.0 (2026-09-01)

- A file reused across modules gets a home: `course/_files/`, a shared assets
  folder at the root of the course tree, with subfolders welcome
  (`course/_files/aias/`). Reference it from a module page as `../_files/…` and
  from a page inside a subfolder as `../../_files/…`; the preview, both exports,
  `validate` and the Canvas sync all resolve it, one upload and one Canvas file
  however many pages embed it. On Canvas such a file lands in a `shared/` folder
  mirroring the tree under `course/_files/`, taken from the file's own path
  rather than from whichever module's page happened to push first — the old rule
  left a re-upload triggered from another module in another folder, where
  overwrite-on-name could not see the previous file, so Canvas minted a new id
  and stranded the old file beyond any prune. Pull preserves shared files but
  never creates one: a binary first met on Canvas still lands in the referencing
  module's own `_files/`.

- `npx course validate` reads the `_files/` folders themselves, which nothing
  else does: the scanner skips `_`-prefixed names, sync knows a binary only once
  markdown references it, and prune reads only `state.files` rows, so what sits
  in a `_files/` folder unreferenced is invisible to every command. Two new
  warnings, neither of which fails the run: a binary no markdown references (a
  pull once left twelve orphaned alert icons that way, and nothing could ever
  notice them), and a group of byte-identical copies in more than one `_files/`
  folder, which one shared file under `course/_files/` would replace.

## 1.0.3 (2026-09-01)

- A pull no longer downloads the alert icons into a module's `_files/`. The scan
  for embedded binaries reads the raw Canvas HTML, so it saw the icon `<img>` in
  every alert title — the one thing the markdown conversion throws away — and
  the guard against that was a list of the icon ids the sync state currently
  holds. That list is empty on a first pull, holds the wrong generation for a
  page not pushed since a theme change, and can never hold the ids in content
  copied from another Canvas course, so each of those wrote a set of SVGs
  nothing would ever reference or clean up: no markdown names them, no
  `state.files` row records them, and the scanner does not look inside
  `_files/`. The icons are now recognised by their place in the markup instead.
  Copies already on disk are not removed; delete them by hand, and note that a
  foreign-course one is the only thing in `_files/` with no row of its own.

- The alert icons upload under their own names again, so re-uploading them
  replaces the six in the Canvas `/course-icons` folder instead of adding six
  more. The theme-coloured copy went up from a temp file whose name carried the
  process id, and Canvas matches `on_duplicate=overwrite` on the name, so only a
  run that happened to draw the same pid ever matched. Every other run orphaned
  the previous six — still referenced by every page not pushed since — and left
  `course-icon-20452-info.svg` and its siblings in the author's own Files area.
  The run's uniqueness moved to the temp directory, where it costs nothing.
  Uploads from earlier versions are not cleaned up; delete them from the Canvas
  Files area if you want them gone.

## 1.0.2 (2026-08-31)

- Frontmatter is written with the emoji intact. `gray-matter` bundles a js-yaml
  3 of its own, whose dumper walks a string by UTF-16 code unit, so a page
  pulled from Canvas with an emoji in its title landed on disk as
  `title: "\U0001F3E5 Afwezig"`. Nothing was lost — every parser reads the
  escape back — but the file was unreadable, its diffs were noise, and the
  Course Manager tree showed the escape where the icon should be. Every
  frontmatter write now dumps through the top-level js-yaml, `new-item`,
  `rename-item`, `split-item` and `merge-items` included. Files already on disk
  keep their escapes until something rewrites them.

## 1.0.1 (2026-08-31)

- The course home page leads with the tutorial module. Its **Start Here** list
  opened by sending a first-time visitor back out to the documentation on
  GitHub, while the module the site exists to show off was a tip halfway up the
  page. The module is the first entry now, the tip shrinks to a nudge, and
  `docs/first-course.md` follows as the same path in one page.

- The tutorial module now starts from a computer with nothing installed. A
  **Setting Up** subsection covers VS Code, Node.js, git and a GitHub account,
  then **Use this template**, `git clone` and `npm install`, so a reader who
  lands on the module can follow it through instead of being sent to the
  documentation for the first half. The old **VS Code** page moves in as **The
  Course Manager** and keeps the extension install and the panel tour.
  `docs/first-course.md` is unchanged and remains the same path as one page,
  with the per-system detail the module links out to.

- The emoji legend in the writing-style guides gains `🔑` for a solution page,
  in all four language variants. Courses that publish worked solutions were
  already using it and each picked their own marker.

- Prettier leaves `.canvas-sync.json` alone. `lib/sync/state.js` writes that
  file, and `JSON.stringify` does not lay out a single-element array the way
  Prettier would, so every sync left a course repository failing
  `npm run format:check` on a file nobody had edited by hand. Running Prettier
  over it held only until the next sync.

- The tooling's own test workflow no longer runs in course projects. Every
  project created from the template inherited `.github/workflows/test.yml`, and
  it ran the template-only suite: the checks that read the README, the course
  home page and the two guides in `context/`, every one of which a course author
  is told to replace. The result was failure mail about a workflow the author
  never wrote. Both of its jobs are now guarded on the repository name, so a
  fork of the tooling keeps its CI while a course skips it.

- A pull no longer writes markdown the preview cannot build. Text a Canvas page
  held as `&lt;tel nr&gt;` came back as a bare `<tel nr>`, which MDX reads as an
  unclosed tag, so `npm run build` failed on a page the author never wrote. The
  same escape fixes the push: unescaped, that text went back to Canvas as markup
  and the words disappeared from the page. A spaced comparison like `a < b` is
  left alone, since MDX only starts a tag on a non-space.

- `npm test` no longer fails in a course project that has synced with Canvas.
  One test of `merge-items` reached past its own fixture and loaded the
  project's real `.canvas-sync.json`, where the mismatch guard refused it for
  describing a different course than the test's fake credentials. The command
  itself was never affected; only the test read the wrong file.

- Generated folder and file names are capped at 60 characters, cut on a word
  boundary. A Canvas title can be a whole sentence — a text header telling the
  author what to put in the module is a real example — and uncapped it became a
  folder name of nearly 200 characters. Two of those nested under `course/`
  carried a course past Windows' 260-character path limit, where `git clone`
  fails outright and the repository cannot be checked out on Windows at all.
  Only newly generated names are affected; nothing already on disk is renamed.

- A `Course checks` workflow takes its place in a course project, running
  `npx course validate` and `npm run build` on every push. It reports on the
  material rather than on the tooling, and unlike the Pages deploy it runs on
  every branch and without Pages being switched on, so a page that cannot
  compile is caught where it was written rather than at a deploy the project may
  not reach for months.

## 1.0.0 (2026-08-30)

First public release. Write your course as markdown, preview it as a Docusaurus
site, sync it two ways with Canvas LMS, export it to PDF and Word, and pull
later improvements to the tooling into your project without touching a line of
your course. Ships with a VS Code extension, a set of AI skills for lesson
design and quality checks, and a tutorial module that doubles as the demo site
at [coursewright.md](https://coursewright.md/).
