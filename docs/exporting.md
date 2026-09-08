# Exporting to PDF, DOCX and Markdown

Turn course materials into a printable PDF or an editable Word document: a
handout for one lesson, a module as a chapter, or the whole course as a styled
course text with your institution's branding. A third format writes plain
markdown instead: one text file, meant to be attached to a chatbot as a study
pack or read as it is. Exports are generated from the same markdown the website
and Canvas read, so a handout never drifts from the course it came from.

## What You Need

DOCX export needs only [pandoc](https://pandoc.org/); PDF export also needs
[Typst](https://typst.app/). Both are free, and nothing else in Coursewright
needs either, so you can skip this until your first export. The markdown format
(`-f md`) needs neither.

Pandoc ships a real installer on every platform, downloaded from
[pandoc.org/installing.html](https://pandoc.org/installing.html):

- **macOS:** a `.pkg`. Two are offered, and the choice matters: `arm64` for
  Apple Silicon (M1 and later), `x86_64` for an Intel Mac; there is no universal
  package. Apple menu > About This Mac names which: "Apple M…" is Apple Silicon,
  "Intel" is Intel.
- **Windows:** a `.msi`, which installs pandoc and adds it to the PATH.
- **Linux:** a `.deb` for Debian and Ubuntu (amd64 and arm64), opened by the
  graphical app installer on double-click. There is no `.rpm`; on Fedora the
  package is `pandoc-cli`.

Typst ships no installer, on any platform: every release is an archive, never a
`.pkg`, `.msi` or `.deb`. It has to come from a package manager instead:

- **macOS:** `brew install typst`, via [Homebrew](https://brew.sh), the standard
  package manager for developer tools on a Mac. It is not installed by default.
- **Windows:** `winget install --id Typst.Typst`. Winget ships with Windows 11
  and current Windows 10 as part of "App Installer", so it is usually already
  present; a terminal is still needed to run it.
- **Linux:** `sudo snap install typst`, an official snap published by Typst
  GmbH, or install "Typst" from the Ubuntu App Center with no terminal at all.

Neither `apt install typst` nor `dnf install typst` exists: Typst is in neither
Debian/Ubuntu's nor Fedora's repositories.

## Exporting

Right-click an item and choose **Course: Export Item to PDF/DOCX...**, or a
module and choose **Course: Export Module to PDF/DOCX...**. Select several items
first (Ctrl/Cmd-click or Shift-click in the tree) and the item export combines
them into one document. Either way you then pick PDF or Word.

For the whole course, open the panel's `…` dropdown and choose **Course: Export
Course to PDF/DOCX...**. It offers three scopes: the full course, only the items
flagged `export: true`, or a curated table of contents. Choosing the
table-of-contents option writes `exports/toc.md` and opens it for editing;
delete the lines you do not want, and once the file exists, **Course: Export via
TOC...** appears in the `…` dropdown to render it.

The flagged scope, `--flagged` on the terminal, reads the `export: true`
frontmatter flag, so you can mark the exam-relevant items once and keep
exporting just those. See [Frontmatter](frontmatter.md#common-fields).

Output lands in `exports/` (gitignored). A whole-course export takes its title,
and its filename, from `title` in `course.config.yml`
(`exports/programming-fundamentals.pdf`); a module export is titled after the
module. Multiple items combine into one document with a title page, a generated
table of contents, and a page break between chapters. Each item opens with a
heading built from its `title` in the frontmatter, page-type emoji included,
whatever its body starts with; see [Markdown](markdown.md#headings).
Non-markdown items keep their place: an external URL becomes a link card, a file
item an attachment reference, and an image file item is embedded above its
attachment line.

### From the Terminal

```bash
npx course export course/01-intro/03-alerts.md   # one item
npx course export -m 01-intro                    # a whole module
npx course export                                # the full course
npx course export -m 01-intro -f docx            # Word instead of PDF
npx course export --flagged                      # only items with export: true
npx course export-toc                            # writes exports/toc.md
npx course export --toc exports/toc.md           # render a curated selection
```

`-o`, `--title`, `--subtitle`, `--style`, `--var` and `-f md` are terminal-only:
the panel has no route to any of them. See
[CLI reference](cli-reference.md#export) for the full flag list.

### Markdown

`-f md` writes the export as a plain markdown file rather than a rendered
document. It takes the same scopes as PDF and Word, one item, a module, the
whole course, `--flagged` or a curated TOC file, and it needs neither pandoc nor
Typst.

```bash
npx course export -f md                   # the whole course as one file
npx course export -m 01-intro -f md       # one module
npx course export --flagged -f md         # only items with export: true
```

The result is meant to be read as text. A student attaches it to ChatGPT, Claude
or Gemini and asks the chatbot questions about the course; you can also read it
yourself as one file instead of clicking through the site. The document opens
with a header: the title as a first-level heading, the subtitle and the course
name on one italic line, then the date. The items follow at the same heading
levels the PDF uses, module titles as H1 and items as H2 for a whole course,
items as H1 for a module. Each item heading is built from its `title` in the
frontmatter, page-type emoji included, exactly as the PDF builds it. A single
item gets no header, the way it gets no title page in PDF, and its own title is
the one H1 in the file.

Everything the chatbot cannot follow is taken out. Images become their alt text
in italics, and disappear when they have none. Links to other pages, to
`#anchors` and to files in `_files/` become plain text, while web and mailto
links keep their href. HTML comments go, image TODOs and notes to yourself
included, and frontmatter goes with them. Alerts survive as written, `> [!NOTE]`
and the rest, being readable markdown already. A file item becomes a heading and
an `Attachment:` line naming the file, an external URL a heading and the URL, a
quiz or an external tool a heading and the notice that it is managed in Canvas.
Nothing pandoc-specific reaches the file: no `:::` blocks, no `{#anchor}`
attributes, no YAML.

Output lands in `exports/<slug>.md`, next to the PDFs. `-o` writes it anywhere
else, `course/01-intro/_files/study-pack.md` for instance, when the file should
ship with the course as a download. One combination is refused: a curated export
without `-o`, whose default filename is `exports/toc.md`, the TOC file the run
just read.

This is the format the [`/ai-tutor-build`](ai-assistants.md#students-and-ai)
skill uses for its study packs, the files students attach to a chatbot together
with a course prompt.

## Changing the Look

`course.config.yml` picks the layout with `export.style` and the colours with
`theme`; `--style <name>` overrides the layout for one run, and the
`/export-style-init` and `/export-style-update` skills derive a house style from
a Word template, a PDF or a website. [Export styling](export-styling.md) has the
pipeline, the style files and every override;
[Customisation](customisation.md#branding) covers the colour side.

## When Something Fails

The failures worth knowing (a font Typst cannot find, a missing `rsvg-convert`
for SVG in Word, Word's table of contents showing empty) are covered in
[troubleshooting](troubleshooting.md#exports) and the
[DOCX degradations](export-styling.md#docx-degradations) list.
