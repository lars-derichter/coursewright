# Export Styling

`npx course export` turns course markdown into a printable PDF or an editable
Word document. This guide explains how the export pipeline is put together and
how to customise the look, either by hand or with the
[`/export-style-init`](#deriving-a-style-from-a-reference) and
`/export-style-update` skills.

For prerequisites and everyday usage, see the [exporting guide](exporting.md).

## The Pipeline

One export is a single [pandoc](https://pandoc.org/) run over one combined
markdown string that the exporter assembles from the selected items:

```
course/*.md ─▶ preprocess (alerts→divs, heading shift, link/image rewrite)
            ─▶ assemble  (title page, TOC, chapters, link cards, page breaks)
            ─▶ pandoc ──┬─▶ Typst  ─(template.typ)─▶  PDF
                        └─▶ Word   ─(reference.docx)─▶ DOCX
                     via filter.lua (maps the exporter's divs per format)
```

The same combined markdown feeds both formats. What differs is the final
renderer: PDF goes through [Typst](https://typst.app/) using `template.typ`,
DOCX through pandoc's Word writer using `reference.docx`. A single Lua filter
translates the exporter's fenced divs (alerts, link cards, attachments, page
breaks) into the right thing for each renderer.

## Two Axes: Style and Theme

What an export looks like is decided by two settings in `course.config.yml`, on
purpose kept apart:

```yml
theme: github        # colour, shared with the site and Canvas
export:
  style: generic     # PDF/DOCX typography, margins, cover, bundled fonts
```

- The **export style** is a folder in [`export-styles/`](../export-styles/). It
  owns everything about layout. `generic` is the default: Helvetica/Arial,
  near-black headings, A4 with 2.5 cm margins, unnumbered headings (see
  [Customisation](customisation.md#branding) for `export.number_headings`),
  every H1 on a new page, a muted centred page number, and a cover carrying a
  "Built with Coursewright" watermark. `thomas-more` ships alongside it as a
  worked example of institutional branding: Century Gothic headings where the
  machine has that font, Nunito bundled as the fallback, and the institution's
  logo. The logo belongs to its owner and Nunito ships under the SIL Open Font
  License (see [THIRD-PARTY.md](../THIRD-PARTY.md)).
- The **theme** is a CSS file in [`src/css/themes/`](../src/css/themes/) and
  owns colour. The exporter parses it and passes every colour to Typst as a
  pandoc variable, so the PDF, the website, Canvas pages and the alert icons all
  read one file. [Customisation](customisation.md#branding) lists every token.

The two combine freely: `theme: thomas-more` with `export.style: generic` gives
the institution's colours in the neutral layout.
`npx course export --style <name|path>` overrides the style for a single run.

Both axes are about the look. The cover's _words_ come from elsewhere: an export
covering the whole course is headed by `title` from `course.config.yml` and
subtitled by `tagline`, a module export by the module's name with the course
name beneath it. `--title` and `--subtitle` override either.

> [!IMPORTANT]
>
> **DOCX does not follow the theme.** Word styles are baked into
> `reference.docx` and cannot be injected at export time, so switching `theme:`
> recolours the site, Canvas and the PDF but leaves Word output alone.
> `/export-style-update` rewrites `reference.docx` to match.

## The Style Files

Each style folder holds the files that decide the look. The three files at the
root of `export-styles/` drive the pandoc pipeline rather than the look, so
every style shares one copy of each.

Resolution is per file: a `--template` or `--reference-doc` CLI flag wins, then
`sources/export-style/<file>`, then the selected style (or, for the shared
files, the root of `export-styles/`). `sources/` is protected during
[upstream updates](updating-your-project.md), so a file you put there survives
them, which is how you change one part of a shipped style without forking the
rest.

| File             | Where     | Renderer    | Controls                                                                                                                                                                                                                                                                        |
| ---------------- | --------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `template.typ`   | per style | PDF (Typst) | Fonts, sizes, margins, title page, TOC, alert/link-card/attachment styling, page-break behaviour. Reads its colours from the theme.                                                                                                                                             |
| `reference.docx` | per style | DOCX (Word) | All Word paragraph and character styles: `Normal`, `Heading 1/2/3`, `Hyperlink`, and the custom styles listed below, including their colours.                                                                                                                                   |
| `logo.png`       | per style | PDF (Typst) | Cover logo. The filename is fixed. Optional: without it the cover simply has no logo.                                                                                                                                                                                           |
| `fonts/`         | per style | PDF (Typst) | Fonts shipped with the style, passed to Typst via `TYPST_FONT_PATHS` so they render where not installed. Ship only fonts whose licence allows redistribution; `generic` ships none and relies on Helvetica/Arial.                                                               |
| `defaults.yml`   | shared    | both        | Pandoc defaults shared by every export (TOC depth). Layout defaults deliberately live in `template.typ` instead, so `--var` can override them. `number-sections` stays `false` here: `export.number_headings` makes the exporter pass the flag on the command line, which wins. |
| `filter.lua`     | shared    | both        | Maps the exporter's `.alert`, `.link-card`, `.attachment`, and `.page-break` divs onto Typst function calls (PDF) or custom-style paragraphs (DOCX), and keeps an intro line with the block it introduces (PDF). Rarely needs editing.                                          |
| `sample.md`      | shared    | both        | The kitchen-sink preview document (see [Previewing a style](#previewing-a-style)).                                                                                                                                                                                              |

The custom Word styles `reference.docx` must define (pandoc matches on the
spaced display names): `Alert Title <Kind>` and `Alert Body <Kind>` for each of
Note, Tip, Important, Warning, Caution, and Check, plus `Link Card Title`,
`Link Card`, `Attachment`, and `Source Code`.

### How a Colour Reaches the PDF

`template.typ` never hardcodes a palette. The exporter reads the theme file,
keeps every token whose value is a plain hex colour, and passes them to pandoc
as variables named after the token: `--cw-alert-note-fg` becomes
`cw-alert-note-fg`. The template reads them through a small `pick()` helper that
falls back to a literal when the variable is absent, so the file still compiles
on its own:

```typst
#let fg = pick("$cw-fg$", "#1f2328")
```

> [!NOTE]
>
> Alert titles and the attachment label are single-sourced the same way from
> `lib/config/labels.js`: the exporter passes them as `labels:` metadata, which
> `filter.lua` and `template.typ` read (with English fallbacks). The alert
> _kinds_ are listed in `ALERT_KINDS` in `lib/config/theme.js`. That leaves
> `reference.docx` as the one place holding its own copy of the alert colours.
> Everything else derives from the theme.

## Overriding Layout with `--var`

`--var key=value` passes a variable straight into the Typst template, so you can
tweak the PDF without editing any file:

```bash
npx course export -m 01-intro --var mainfont="Georgia" --var fontsize=12pt
npx course export -m 01-intro --var margin=2cm
```

Recognised variables mirror the `conf()` signature in `template.typ`:
`mainfont`, `codefont`, `fontsize`, `margin`, `papersize`. `--var` affects **PDF
only**. DOCX styling comes entirely from `reference.docx`.

To see which fonts Typst can actually use on this machine:

```bash
typst fonts
```

Typst renders with installed **system fonts**, plus whatever the style ships in
its `fonts/` directory, which the exporter passes to Typst via
`TYPST_FONT_PATHS`. If you set `mainfont` to something you have not installed,
Typst falls back and the result will not match. Install the font, drop its files
in `sources/export-style/fonts/` (only if its licence allows redistribution), or
pick one `typst fonts` lists.

### Microsoft Office Fonts on macOS

Office fonts are a special case worth knowing about. On Windows, Office installs
typefaces like Century Gothic into the system font folder, so Typst finds them
like any other. On macOS it keeps them inside the application bundles instead,
where nothing outside Office looks, which is why `typst fonts` does not list
Century Gothic even on a Mac with Word installed.

The exporter closes that gap: on macOS it adds Office's own font directories to
`TYPST_FONT_PATHS`, so a Mac with Word exports in the same typeface a Windows
machine does. Nothing is copied or installed; it reads the fonts already
licensed on that machine. `npx course export --verbose` prints the directories
it ended up searching.

Without Office, headings fall through to the next font in the style's list:
Nunito for `thomas-more`, which ships in its `fonts/` folder.

The `generic` style bundles no fonts and asks for Helvetica, then Arial. On a
machine without one of them, Typst prints a `unknown font family` warning and
uses the next in the list; that is informational, not an error. Silence it with
`--var mainfont=Arial`, or drop font files into `sources/export-style/fonts/`.

## Deriving a Style from a Reference

Two skills automate the editing described above:

- **`/export-style-init`** takes a Word document, a PDF, a website URL, or a CSS
  file, works out the fonts, colours, spacing, and margins, proposes a style
  spec, and, after you approve, writes `template.typ` and `reference.docx` into
  `sources/export-style/` and regenerates the sample.
- **`/export-style-update`** makes a plain-language change ("headings dark
  blue", "bigger margins", "font Georgia") to an existing style and regenerates
  the sample so you can see it.

Both edit the DOCX by unzipping it, editing its XML, and rezipping, never in
Word, which would drop the custom alert and link-card styles.

## Previewing a Style

`--sample` renders a kitchen-sink document that exercises every element (all
alert kinds, code, tables, lists, a link card, an attachment, a page break):

```bash
npx course export --sample -f pdf
npx course export --sample -f docx
npx course export --sample -f pdf --style thomas-more   # compare styles
```

The sample is shared by every style, so pandoc gets both its directory and the
selected style's on the resource path: that is what lets `![](logo.png)` inside
it resolve to whichever style's cover logo is active.

### Regenerating the Watermark Logo

`export-styles/generic/logo.png` is generated from `logo.typ` beside it, using
the Typst binary the PDF export already needs:

```bash
typst compile export-styles/generic/logo.typ export-styles/generic/logo.png --ppi 600
```

The source sets `fill: none` and an auto-sized page, so the PNG comes out
transparent and cropped to the wordmark.

## Page Breaks in the PDF

Both shipped templates decide where a page may break with three rules:

- **A short block moves whole rather than splitting.** An alert, a code block or
  a table up to half the page's text area, and a list up to a quarter, goes to
  the next page in one piece. The `keep-together` helper in `template.typ`
  measures each block and sets `breakable` accordingly; a taller block still
  breaks, and Typst never leaves a single line of it behind. The share is the
  helper's `ratio` argument, so a forked template can tune it.
- **A title stays with its body.** Every heading is sticky, including the
  generic style's H2 rule and both styles' H5/H6 label blocks, and so is the
  title of an alert tall enough to break. `filter.lua` gives the same to a
  paragraph that ends in a colon or is at most three words long ("Voorbeeld:",
  "Bijv.") when a code block, list, table or alert follows it.
- **A long table breaks** with its header row repeated on every page. Pandoc
  wraps every table in a figure, and Typst does not break a figure unless told
  to; without the rule a table taller than the page runs off it.

The price is white space: a block that moves whole leaves a gap above the break,
and a sticky chain (heading, intro line, code block) moves together. Expect a
few more pages than an export that splits freely.

## DOCX Degradations

DOCX is a lossy target next to the Typst PDF. These are known and accepted:

- **Table of contents.** Word writes the TOC as a field that shows empty until
  you update it: open the document, select all (Ctrl/Cmd-A), then press F9.
  Heading numbers, when `export.number_headings` is on, need no such step:
  pandoc writes them into the heading text.
- **Page breaks.** Word keeps a heading and an alert title with what follows,
  through the styles in `reference.docx`. The rest of the
  [PDF rules](#page-breaks-in-the-pdf) (short blocks moving whole, intro lines
  sticking to their block, long tables) are Typst's alone.
- **`--var` font/margin variables** affect the PDF only. Style the DOCX through
  `reference.docx`.
- **The theme** recolours the site, Canvas and the PDF, but not the DOCX: Word
  styles are baked into `reference.docx`. `/export-style-update` rewrites them.
- **Cover logo** appears in the PDF only; the DOCX cover is typographic
  (Title/Subtitle styles).
- **The course name under the title** appears in the PDF only. Word's writer
  renders title, subtitle and date, and ignores any other metadata field.
- **Alerts** keep their per-kind coloured border and localised title but have no
  icon.
- **Inline SVG** renders natively in the PDF. For DOCX, pandoc needs
  `rsvg-convert` (from librsvg, e.g. `brew install librsvg`) on the PATH to
  rasterise it; without it the image is dropped with a warning. SVG shown
  directly in Word also needs Word 2016 or newer. Use PNG for images that must
  appear in DOCX everywhere.

## Further Reading

- [Pandoc manual: Templates](https://pandoc.org/MANUAL.html#templates)
- [Pandoc manual: Creating a PDF with Typst](https://pandoc.org/MANUAL.html#creating-a-pdf)
- [Typst: Tutorial](https://typst.app/docs/tutorial/) and
  [Reference](https://typst.app/docs/reference/)
- [Pandoc: Custom Styles in DOCX](https://pandoc.org/MANUAL.html#custom-styles)
