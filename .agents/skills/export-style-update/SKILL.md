---
name: export-style-update
description: Make a plain-language change to how course exports look (heading colour, fonts, margins, alert colours, paper size) by editing the theme (colour) and/or sources/export-style/template.typ and reference.docx (layout), then regenerating the sample to show the result. Forks the shipped defaults on first use. Use for "update export style", "headings dark blue", "different font for the export", "exportstijl aanpassen", "koppen donkerblauw", "ander lettertype voor de export".
---

# Export Style Update

Apply a small, plain-language change to how `npx course export` looks, and show
the result. The iterate-in-place companion to `/export-style-init`, which
derives a whole new look from a reference. This skill takes the change asked of
it and applies it straight away; it does not sweep the conversation for
decisions to record.

Two files can carry a change. **Colour** lives in the theme
(`src/css/themes/<name>.css`), shared with the preview site and Canvas and
injected into the PDF at export time. **Layout** lives in the export style
(`template.typ`, `reference.docx`). A colour request edits the theme, plus
`reference.docx`, which cannot read it.

## Input

`$ARGUMENTS` is the requested change in plain language ("headings dark blue",
"font Georgia", "bigger margins", "koppen donkerblauw", "grotere marges"). If
empty, ask what to change. If the request is really "build a style from this
document/site", hand off to `/export-style-init`.

## Steps

1. **Fork the defaults if needed.** Read `course.config.yml` for the active
   `theme` and `export.style`.
   - Layout files live in `sources/export-style/`; if a file you need is not
     there, copy it from `export-styles/<style>/` first.
   - The theme, if the change is about colour, must be a copy under `sources/`:
     `cp src/css/themes/<theme>.css sources/theme.css` and set
     `theme: sources/theme.css` in `course.config.yml`. Skip this when it
     already points into `sources/`.

   Never edit `export-styles/` or `src/css/themes/` in place: shipped defaults,
   overwritten on upstream updates.

2. **Locate the change** (see
   [`docs/export-styling.md`](../../../docs/export-styling.md) if unsure):

   | Request                  | Site, Canvas and PDF                                             | DOCX: `reference.docx`                                   |
   | ------------------------ | ---------------------------------------------------------------- | -------------------------------------------------------- |
   | Heading colour           | `--cw-heading` in the theme                                      | `Heading1/2/3` in `word/styles.xml`                      |
   | Link/accent colour       | `--cw-link`, `--cw-accent` in the theme                          | `Hyperlink` colour                                       |
   | Alert colours            | `--cw-alert-<kind>-fg` / `-bg` in the theme                      | the per-kind `AlertTitle<Kind>`/`AlertBody<Kind>` styles |
   | Body/muted/border colour | `--cw-fg`, `--cw-fg-muted`, `--cw-border` in the theme           | the matching Word styles                                 |
   | Heading font             | `show heading: set text(font:)` in `template.typ`                | `Heading1/2/3` in `word/styles.xml`                      |
   | Body font/size           | `font:`/`fontsize:` in `conf()`                                  | `Normal` + theme `<a:latin>`                             |
   | Margins / paper          | `margin:`/`paper:` in `conf()`                                   | `<w:pgMar>`/`<w:pgSz>`                                   |
   | Cover logo               | `sources/export-style/logo.png` (PDF only)                       | —                                                        |
   | Heading numbering        | `export.number_headings` in `course.config.yml` (both formats)   | —                                                        |
   | Bundled font files       | `sources/export-style/fonts/` (PDF only, via `TYPST_FONT_PATHS`) | install the font on the machine that opens the DOCX      |

   Apply each format-agnostic change to **both sides of its row** (the
   theme/template column and the DOCX column); a PDF-only tweak (justification,
   page numbering) touches only `template.typ`. Warn when a colour change cannot
   reach the DOCX because `reference.docx` is not forked yet.

3. **Edit the theme and/or the Typst template** with the Edit tool. In
   `template.typ`, keep the `alert(...)`, `linkcard(...)`, `attachment(...)`
   helpers and the `alert-colors` map (the Lua filter calls them by name) and
   keep the `pick("$cw-…$", "#fallback")` calls, which are how theme colours
   reach the PDF. Do not replace a `pick(...)` with a literal colour; change the
   theme token instead.

4. **Edit the DOCX** by editing its XML, never in Word (Word drops the custom
   styles):

   ```bash
   D=<fresh dir in the session scratchpad>
   unzip -oq sources/export-style/reference.docx -d "$D/docx"
   # Edit word/styles.xml and/or word/theme/theme1.xml, then:
   ( cd "$D/docx" && zip -Xrq "$D/reference.docx" . )
   cp "$D/reference.docx" sources/export-style/reference.docx
   ```

   Zip in the scratchpad and copy the result in; `zip` writing directly into a
   cloud-synced folder can fail on the in-place rename.

   Font size is in half-points (`<w:sz w:val="28">` = 14pt); colour is
   `<w:color w:val="RRGGBB">` (no `#`). Leave the per-kind
   `AlertTitle<Kind>`/`AlertBody<Kind>` pairs, `LinkCard`, `LinkCardTitle`,
   `Attachment`, and `SourceCode` untouched unless the request is specifically
   about them: the Lua filter references them by name.

5. **Regenerate and show**: `npx course export --sample -f pdf`, and a second
   run with `-f docx` when the change touched the DOCX (`--format` takes one
   value per run). Confirm the change landed, then iterate on request.

## Rules

- **Language.** Reply in chat in the language the author writes in; these style
  files carry no course prose.
- Write only under `sources/` (and `course.config.yml` when pointing `theme:` at
  a copy there).
- Do not silently redesign: make the requested change and nothing more.
- If a request cannot be met cleanly by the pipeline, say so and offer the
  nearest achievable alternative rather than a fragile hack.
- Bundle only fonts whose licence permits redistribution, recorded in
  `THIRD-PARTY.md`.
- No commits, no pushes, no staging.

$ARGUMENTS
