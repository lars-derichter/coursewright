# Coursewright

Write your course in markdown, in your own editor, with git underneath. Publish
it as a website for your students, hand it out as a styled PDF or DOCX, or sync
it straight into Canvas LMS, whichever you need. Bundled AI skills pitch in on
lesson design, module building and proofreading when you ask. Both the AI and
Canvas are optional: your course is plain files, and it works without either.

Course material tends to live wherever it was last edited: an LMS editor, a Word
file, a slide deck. Maintaining a whole course that way means losing history,
search and replace, and any review of changes before students see them.
Coursewright moves the source of truth to plain markdown files on your computer,
and every output is built from that one source: the website, the handout, the
Canvas modules.

The suggested workflow has a didactic backbone: backward design and constructive
alignment. Learning goals come first, then the assessment that evidences them,
then the lessons; the skills read that chain from one file, check your material
against it, and a retro folds what happened in class back into next year's plan.
It is a proven base that never becomes a straitjacket: every structure is a
default your own conventions override. The reasoning is in
[didactic foundations](docs/didactics.md).

## What You Get

- **Your own tools.** Write in VS Code or any editor, keep everything in git,
  and review every change before it goes live.
- **Instant preview, publishable.** A local website
  ([Docusaurus](https://docusaurus.io/)) shows your course as you write, in the
  same structure students will see. One GitHub setting
  [publishes it](docs/hosting.md) as a public course website, and any static
  host can serve the same build. The tool's own site,
  [coursewright.md](https://coursewright.md/), is the built-in tutorial module
  published this way.
- **PDF and DOCX export.** Hand out a styled course text or a single chapter,
  with your institution's branding. See [exporting](docs/exporting.md).
- **A VS Code extension.** Every command is reachable from the sidebar or the
  command palette, so daily work needs no terminal. The two destructive ones and
  the glossary builder are palette-only, kept out of the tree so no stray click
  can start them. What the panel does not reach is flags, not commands.
- **One-command Canvas sync.** `npx course sync` reconciles modules, pages,
  assignments, discussions and files with
  [Canvas LMS](https://www.instructure.com/canvas) in both directions, and
  deletes nothing unless you ask. `push` and `pull` are the same run with the
  direction pinned, and `status` shows what a sync would do without doing it.
- **AI-assisted authoring on didactically sound foundations.** Bundled skills
  help design lessons, build student modules, generate Canvas quizzes,
  proofread, and check course consistency, with any AI coding agent that reads
  `AGENTS.md`. The [lesson workflow](docs/lesson-workflow.md) shows how they
  chain from idea to published module.
- **A template that stays updatable.** Create your course from this template and
  keep pulling tooling improvements later; your course content is never
  overwritten.

## What It Does Not Do

Worth knowing before you commit a semester to it. Every entry here is about the
Canvas sync, because that is where the surprises live; the website and the
export have far less small print, and [limitations](docs/limitations.md) opens
with their short list.

- **Not every type syncs as content.** Pages, assignments, discussions and files
  live in your markdown and are rebuilt from it. A quiz and an external tool
  (LTI) sync as references: the file says which Canvas object goes where in a
  module, and push never creates or changes the object itself.
- **Quiz questions never sync.** A bundled skill generates a QTI package you
  import into Canvas by hand, once, in one direction.
- **A push makes your markdown win.** It reconciles a module item by item, so
  anything you added by hand in Canvas stays where it is. But a Canvas object
  whose type and title match a local file is claimed by that file, and from then
  on the file decides what it holds.
- **The folder layout is a contract**: one folder per module, one level of
  nesting, numbered prefixes.
- **Nothing merges two versions of one item.** A sync decides which side wins
  and writes that copy whole; it never blends the two. Git is the undo, which is
  why a local file holding uncommitted work is never written over, and only
  `pull --force` overrides that.

The full list, with what to do instead, is in
[limitations](docs/limitations.md). Before pointing it at a course that already
has content, read [backups](docs/backups.md).

## Who It's For

Lecturers and teaching teams who want course material in files, folders and
version control, whatever it ends up published to: a course website, a printed
reader, Canvas, or all three. You don't need to be technical:
[your first course](docs/first-course.md) starts from a computer with nothing
installed, and there is a [git and GitHub guide](docs/git-and-github.md) for
complete beginners. The project has many other files; day to day, only
`course/`, `sources/`, `context/`, `evaluations/` and `README.md` are yours to
edit.

## Quick Start

**New to this?** [Your first course, step by step](docs/first-course.md) goes
from a computer with nothing installed to a published course, assuming no
experience with VS Code, the terminal, or git.

The short version, if you have done this sort of thing before:

1. Click **Use this template** on GitHub and create your course repository.
2. Clone it, install Node.js 24+, and run `npm install`.
3. Run `npm run vscode:install`, then **Developer: Reload Window**. A book icon
   appears in the activity bar: the Course Manager panel, which is where the
   rest of this happens by clicking.
4. Make it your course with `npx course setup`: it asks for the language, the
   name and the look, and puts the matching templates in place (see
   [customisation](docs/customisation.md)). Preview the built-in tutorial module
   with `npm start`.
5. Publish, to whichever of the three targets you need:
   - **Website**: switch on [GitHub Pages](docs/hosting.md); publishing is one
     repository setting.
   - **PDF or Word**: [export](docs/exporting.md) an item, a module, or the
     whole course.
   - **Canvas**: back up the Canvas course ([how](docs/backups.md)), connect it
     with `npx course init` ([Canvas setup](docs/canvas-setup.md)), and push
     your first module.

## Documentation

The [docs folder](docs/README.md) has the full map. Start with:

- [The built-in tutorial module](https://coursewright.md/): the tool's own
  course, a guided walk through the sidebar and the three publish routes, and a
  live example of every content type; source in
  [`course/01-getting-started/`](course/01-getting-started/)
- [Your first course](docs/first-course.md): the complete beginner walkthrough,
  from installing nothing to a published module
- [VS Code extension](docs/vscode.md): the Course Manager panel and command
  palette reference
- [User guide](docs/user-guide.md): course structure and every daily command
- [CLI reference](docs/cli-reference.md): every command and flag, and the npm
  scripts
- [Markdown guide](docs/markdown.md): supported syntax, links, and alerts
- [Hosting](docs/hosting.md): the course website on GitHub Pages
- [Exporting](docs/exporting.md): PDF, DOCX and markdown handouts and course
  texts
- [Canvas setup](docs/canvas-setup.md): connecting a Canvas course
- [Limitations](docs/limitations.md): what the tool does not do
- [Backups](docs/backups.md): protecting a Canvas course before you sync
- [Customisation](docs/customisation.md): README, language, branding, and
  licence
- [AI assistants](docs/ai-assistants.md): the bundled skills and how to add your
  own
- [Didactic foundations](docs/didactics.md): the course-design ideas the
  workflow is built on
- [Troubleshooting](docs/troubleshooting.md): common issues and fixes

## Licensing

- **Tooling** (CLI, libraries, site, VS Code extension): [MIT](LICENSE). Free to
  use, change and redistribute, as long as the copyright notice travels with it.
- **Course content** (`course/`): [CC BY-NC-SA 4.0](course/LICENSE.md) by
  default. Content you write in your own course is yours to license as you wish.
- **Borrowed assets** (the alert icons, the bundled Nunito typeface, and the
  example logo in `export-styles/thomas-more/`): each under its own licence, see
  [THIRD-PARTY.md](THIRD-PARTY.md).

## Contributing

Bug reports, ideas and pull requests are welcome: see the
[contributing guide](docs/contributing.md) and the
[ideas list](docs/roadmap.md). Taking part means following the
[code of conduct](CODE_OF_CONDUCT.md); security problems have their own
[private reporting route](SECURITY.md).
