# Making the Template Yours

The template ships as a working example: a README about the tooling, English
student-facing labels, an English writing style guide, and a neutral look for
the website and the exports. Together they show what a fully configured course
looks like, but they are starting points, not requirements. This page covers
replacing each of them with your own language, course name, README, course
context, branding, and licence, in that order, because the language you pick
decides which of the later templates you want.

> [!NOTE]
>
> Everything this page asks you to edit survives an
> [upstream update](updating-your-project.md): `README.md`, `course.config.yml`,
> both files under `context/`, and anything you keep in `sources/`. The folders
> you copy _out of_ (`templates/`, `export-styles/`, `src/css/themes/`) are
> deliberately unprotected: they hold shipped defaults, so take a copy rather
> than editing one in place.

## Run the Wizard First

```bash
npx course setup
```

The wizard asks the questions on this page in this order, writes
`course.config.yml`, and installs the templates that match the language you
pick. It ends by offering the two things a fresh course still needs: removing
the built-in tutorial module, and connecting Canvas. Run it again whenever you
want to change an answer. It offers your current settings as the defaults, and
never replaces a file you have written in without asking.

That leaves the writing itself: the README prose, and the course context. Both
sections below say what goes in them. Working with an AI assistant,
[`/course-setup`](ai-assistants.md#project) drives the same command and then
writes those two for you.

The rest of this page is what each choice means and how to change it by hand
afterwards. You never have to run the wizard; every question it asks is a file
you can edit yourself.

## Language

`course.config.yml` sets the language of every generated student-facing label:
alert titles ("Note"/"Info"), link and file cards, export labels, the glossary
heading, and the locale of the website.

```yml
language: nl # built-in label sets: en, nl
```

The shipped default is `en`. Change it to `nl`, restart `npm start`, and the
website and all generated labels switch to Dutch. Individual labels can be
overridden under `labels:`; the file contains a commented block showing every
overridable key.

Answer this one first. It also decides which README, course context and writing
style guide you want below: each of those ships in more than one language.

After changing the language or a label, re-push modules whose pages contain
alerts (`npx course push`) and regenerate the glossary pages
(`npx course build-glossary`), so Canvas picks up the new wording.

## The Course Name

`course.config.yml` holds the name of the course. It titles the website and its
navbar, and heads the cover of a full-course PDF or Word export:

```yml
title: Programming Fundamentals
tagline: Bachelor 1, semester 2 # optional, sits above the title on covers
```

Leave `title` out and it falls back to the generic label for your course
language ("Course", "Cursus"), which is a nudge, not a name. Set it once.

The `tagline` is optional and does double duty: Docusaurus keeps it in the site
metadata, and it subtitles the cover of an export covering the whole course. A
module export gets the course name under its title instead, since the tagline
describes the course rather than the module.

Do not put the title in `docusaurus.config.js`. That file belongs to the tooling
project and is overwritten on upstream updates; a title set in
`course.config.yml` sticks.

## The README

The `README.md` in your project root describes Coursewright, the tooling (not
your course). Replace it with the course README template:

```bash
cp templates/README-course-en.md README.md
```

Courses taught in Dutch want
[`templates/README-course-nl.md`](../templates/README-course-nl.md) instead; it
is the same template with its headings, prose and TODO comments in Dutch, and it
links to the same English guides under `docs/`.

Then work through the copy: change `Course Name` to the name of your course,
write the course overview, fill in the module table, check that the licence line
matches [`course/LICENSE.md`](../course/LICENSE.md), and trim the "Useful links"
list to the guides your colleagues will actually need. Delete the tip at the top
when you are done. The TODO comments in the template mark the sections that need
writing.

## The Course Context

[`context/course-context.md`](../context/course-context.md) describes what your
course _is_: learning goals, assessment, pedagogy, module conventions, scope
boundaries. The lesson skills (`/lesson-design`, `/lesson-summarize`,
`/lesson-module-build`) work from it instead of guessing, and it is equally the
document to hand a colleague who takes the course over, a co-teacher joining
you, or yourself next academic year: it holds the reasoning behind the course
rather than its contents.

Those first three sections are in that order on purpose: what students should be
able to do, how you will know they can, and only then how you teach it. That is
backward design ([didactic foundations](didactics.md)), the chain every lesson
skill reads from top to bottom. Filling in the first two sections is the single
highest-value thing you can do for the skills.

It ships as the English fill-in template, every section marked `TODO`.
`/course-context-init` completes it in whatever language you work in, reading
the repo first and interviewing you for the rest, and `/course-context-update`
keeps it current by folding in the design decisions you settle while working.
For a Dutch scaffold to start from, copy
[`templates/course-context-nl.md`](../templates/course-context-nl.md) over it
first.

Three documents describe your course, and each answers a different question:

| File                        | Answers                                                    | Written for                                          |
| --------------------------- | ---------------------------------------------------------- | ---------------------------------------------------- |
| `course.config.yml`         | What is it called, in what language, in which colours?     | The tooling                                          |
| `README.md`                 | What is this course, and how do I work in this repository? | Whoever opens the repository                         |
| `context/course-context.md` | Why is the course built this way, and what are its rules?  | The lesson skills, and anyone taking the course over |

The name and the language live in `course.config.yml`: the other two point at it
rather than restating it. `/course-context-init` reads `course.config.yml` and
`README.md` before it asks you anything, so writing a fact in the README saves
you typing it again.

## The Writing Style Guide

[`context/writing-style.md`](../context/writing-style.md) holds the rules the
authoring skills follow: language, tone, headings, callouts, punctuation. It
ships as the English baseline, usable as it stands, but make it yours early.
`/proofread` derives its checks from whatever the guide says, so it follows your
rules in whatever language you write as soon as you change them.

Two routes, and they combine:

- Run `/writing-style-init` with your AI assistant to replace it with a guide
  matching your own language, voice, and audience. It reads samples of your
  writing and interviews you about the rest.
- Or copy one of the baselines below over `context/writing-style.md` for a ready
  guide with no interview, then edit it by hand or run `/writing-style-init` on
  top of it.

Each baseline is a complete guide, not a fill-in-the-blanks template. All four
keep the same two registers, the page-title emoji and the callout set, and each
is written in the language it prescribes.

| Baseline                                                                  | Language                                                                                    |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| [`templates/writing-style-en.md`](../templates/writing-style-en.md)       | English, UK spelling, title-case headings. Already installed as `context/writing-style.md`. |
| [`templates/writing-style-en-us.md`](../templates/writing-style-en-us.md) | English, US spelling, title-case headings                                                   |
| [`templates/writing-style-nl-be.md`](../templates/writing-style-nl-be.md) | Nederlands, Vlaamse variant                                                                 |
| [`templates/writing-style-nl.md`](../templates/writing-style-nl.md)       | Nederlands, variant Nederland                                                               |

## Branding

Branding splits along two axes, both set in `course.config.yml`:

```yml
theme: github # colour everywhere, plus the site's fonts
export:
  style: generic # PDF and DOCX layout, fonts and cover
```

The shipped defaults are deliberately neutral. `thomas-more` is available for
both keys as a worked example of full institutional branding; set both to it for
the complete house style.

### Colour: The Theme

A theme is a CSS file of custom properties, and it is the single source of truth
for colour. The website, the alert and table colours in Canvas pages, the alert
icons uploaded to Canvas, and PDF exports all read the same file, so a colour
you change in one place changes everywhere.

Built-in themes live in [`src/css/themes/`](../src/css/themes/):

| Theme                                                  | Look                                                                                                                            |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| [`github.css`](../src/css/themes/github.css)           | The default. GitHub's light-mode palette, near-black headings, a blue accent, and a system font stack with no web-font request. |
| [`thomas-more.css`](../src/css/themes/thomas-more.css) | Orange accent, navy secondary, Nunito and Inconsolata from Google Fonts, and the pastel alert set.                              |

Every token is prefixed `--cw-` and sits under a comment saying what it colours,
so [`github.css`](../src/css/themes/github.css) reads as the token reference.
Two groups are worth knowing before you open it: the alert colours come as a
`--cw-alert-<kind>-fg` / `-bg` pair for each of `note`, `tip`, `important`,
`warning`, `caution` and `check`, where `fg` is the left rule and the title and
`bg` fills the box; and the font tokens set the website's typography only:
export typography belongs to the export style below.

Some tokens are required. Alongside the twelve alert values, a theme has to
define `--cw-border` and `--cw-surface-subtle`: they draw the tables in Canvas
pages and the borders and row stripes on the website, and nothing falls back to
a colour of its own if they are absent. A theme missing one is refused with an
error naming it.

To make a theme of your own, copy one into `sources/` and point `theme:` at the
path:

```bash
cp src/css/themes/github.css sources/my-theme.css
```

```yml
theme: sources/my-theme.css
```

Then edit the colours. Restart `npm start` to see the site change; an export
picks it up on its next run. A Canvas page picks it up the next time it is
pushed, and a push writes a page only when its file has changed: the sync
compares markdown, not rendered HTML, so a theme change on its own re-sends
nothing. Edit and push a page to recolour it.

> [!NOTE]
>
> One surface does not follow the theme: **Word output**. Colours in DOCX
> exports are baked into the export style's `reference.docx` and cannot be
> injected. Use `/export-style-update` to recolour it to match.

[`src/css/custom.css`](../src/css/custom.css) holds no colours of its own: it
maps the `--cw-*` tokens onto Docusaurus's `--ifm-*` variables and styles the
components. The site title and navbar label come from `title` in
`course.config.yml`, above.

### Layout: The Export Style

An export style decides how a PDF or Word document is laid out: typography,
margins, the cover, and any fonts it ships. Built-in styles live in
[`export-styles/`](../export-styles/):

| Style         | Look                                                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------------------- |
| `generic`     | The default: a neutral A4 layout with a "Built with Coursewright" cover watermark.                                  |
| `thomas-more` | A worked example of institutional branding. The logo belongs to its owner: see [THIRD-PARTY.md](../THIRD-PARTY.md). |

`npx course export --style thomas-more` overrides the config for one run.

The comfortable route to a style of your own is AI-assisted:
`/export-style-init` derives a complete style from a reference you give it, and
`/export-style-update` makes plain-language tweaks to an existing one (see
[the catalogue](ai-assistants.md#export-styling)).

By hand, copy the closest style out and point `export.style` at it:

```bash
cp -r export-styles/generic sources/my-style
```

Inside are `template.typ` for PDF, `reference.docx` for Word, an optional
`logo.png` for the cover, and an optional `fonts/` for typefaces to embed. Only
put a font there if its licence allows you to redistribute it, and note it in
`THIRD-PARTY.md`. To change one file without forking a whole style, drop it in
`sources/export-style/` instead: that path wins per file over whatever style is
selected.

See [export-styling.md](export-styling.md) for what each file controls and for
the full export pipeline.

## Pre-Ship Checks

`npx course check` runs every check a course should pass before a push, and
`npm run hooks:install` installs it as a git pre-push hook. Its built-in list is
`validate`, `build-glossary --check` when the course keeps a glossary, and
`check-links`. The `checks:` section of `course.config.yml` shapes it for your
course:

```yaml
checks:
  links:
    roots: [course, games]
  extra:
    - build-games
```

`links.roots` lists the folders `check-links` scans for broken relative links,
each relative to the project root. The default is `course` alone; add a folder
here when you keep markdown students read elsewhere. `extra` lists subcommands
`check` runs after its built-in list, each written as you would type it after
`npx course`, so a command your course registered itself is gated by the same
command and the same hook. An entry the CLI does not know fails the run, which
is the point: a typo here should not pass as green. Both keys are optional, and
a value of the wrong shape is ignored with a warning naming it. The
[CLI reference](cli-reference.md#checks) has the two commands and their flags.

## Licence

The licences follow the tooling/content split:

- The **tooling** is [MIT licensed](../LICENSE). Leave `LICENSE` where it is:
  MIT asks that the copyright notice stays with the code, so it has to travel
  along if you publish your course repository.
- Your **course content** defaults to CC BY-NC-SA 4.0, declared in
  [`course/LICENSE.md`](../course/LICENSE.md). That file is yours: edit it to
  change or replace the licence for your own material, and update the licence
  section of your README to match.

## The Built-In Tutorial Module

`course/01-getting-started/` is two things at once. It is a guided walk through
the project, sidebar first: markdown, alerts, course structure, git, the three
publish routes and working with an AI assistant, with every step taken in the VS
Code Course Manager panel and the terminal command named alongside. And it is a
working example of every content type a course can create on its own, which
makes it the handiest reference while you build your first module. It is also
the tool's own site: [coursewright.md](https://coursewright.md/) is this
repository's `course/` folder published as a website.

It is also a real module in `course/`, which means `npx course push` publishes
it to your students along with everything else.

> [!WARNING]
>
> Remove it, or move it out of `course/`, before your first push to a course
> students can see. Otherwise a full module about Coursewright appears in their
> module list.

`npx course setup` offers to delete it. Deleting is safe: the module stays
readable at [coursewright.md](https://coursewright.md/), and in the
[upstream repository](https://github.com/lars-derichter/coursewright/tree/main/course/01-getting-started),
so you can consult it, or copy it back, long after your own course has replaced
it. To keep it locally without publishing it, rename the folder with a leading
underscore (`_01-getting-started`), which excludes it from Canvas syncing while
the website still ignores it too.

## Files That Belong to the Tooling Project

"Use this template" copies the whole repository, so your course also inherits
the files that govern the upstream project: its code of conduct, security
policy, issue and pull-request templates, contributing guide and changelog.
Leaving them costs nothing; deleting them takes one extra step, because the next
upstream update would otherwise deliver them again. See
[deleting files that belong to the tooling project](updating-your-project.md#deleting-files-that-belong-to-the-tooling-project).
