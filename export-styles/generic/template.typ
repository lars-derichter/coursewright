$-- Course export template for pandoc's Typst writer (shipped default).
$-- A neutral, modern style: Helvetica/Arial, near-black headings, and the
$-- alert colours of the active theme. Override by placing a template.typ in
$-- sources/export-style/, or pick another style with `export.style` in
$-- course.config.yml.
$if(highlighting-definitions)$
// syntax highlighting functions from skylighting:
$highlighting-definitions$

$endif$
// Colours come from the theme (src/css/themes/<name>.css), which the exporter
// parses and passes in as pandoc variables. The literals below are the
// fallback for rendering this template without them — they mirror the shipped
// `github` theme. Change a colour in the theme file, not here: the site,
// Canvas and this PDF all read the same source.
#let pick(injected, fallback) = {
  let value = injected.trim()
  rgb(if value == "" { fallback } else { value })
}

#let fg = pick("$cw-fg$", "#1f2328")
#let fg-muted = pick("$cw-fg-muted$", "#59636e")
#let border = pick("$cw-border$", "#d1d9e0")
#let surface-subtle = pick("$cw-surface-subtle$", "#f6f8fa")
#let code-bg = pick("$cw-code-bg$", "#eff1f3")
#let heading-color = pick("$cw-heading$", "#1f2328")
#let link-color = pick("$cw-link$", "#0969da")

#let alert-colors = (
  note: (
    fg: pick("$cw-alert-note-fg$", "#0969da"),
    bg: pick("$cw-alert-note-bg$", "#ddf4ff"),
  ),
  tip: (
    fg: pick("$cw-alert-tip-fg$", "#1a7f37"),
    bg: pick("$cw-alert-tip-bg$", "#dafbe1"),
  ),
  important: (
    fg: pick("$cw-alert-important-fg$", "#8250df"),
    bg: pick("$cw-alert-important-bg$", "#fbefff"),
  ),
  warning: (
    fg: pick("$cw-alert-warning-fg$", "#9a6700"),
    bg: pick("$cw-alert-warning-bg$", "#fff8c5"),
  ),
  caution: (
    fg: pick("$cw-alert-caution-fg$", "#cf222e"),
    bg: pick("$cw-alert-caution-bg$", "#ffebe9"),
  ),
  check: (
    fg: pick("$cw-alert-check-fg$", "#59636e"),
    bg: pick("$cw-alert-check-bg$", "#f6f8fa"),
  ),
)

// Headings use the body font: one typeface throughout keeps the style neutral
// and available on every machine.
#let heading-font = ("Helvetica", "Arial")

// Thematic breaks. Pandoc emits `#divider()` (Typst 0.15+) and `#horizontalrule`
// on older versions; both are defined so the rule is a hairline either way
// rather than Typst's default full-weight black line.
#let divider() = line(length: 100%, stroke: 0.5pt + border)
#let horizontalrule = line(start: (0%, 0%), end: (100%, 0%), stroke: 0.5pt + border)

#show terms.item: it => block(breakable: false)[
  #text(weight: "bold")[#it.term]
  #block(inset: (left: 1.5em, top: -0.4em))[#it.description]
]

// Alerts, code, tables and lists read badly when split. A block short enough
// to move to the next page without leaving most of it empty stays whole; a
// taller one breaks, and Typst's own rule still forbids a lone first or last
// line. `make` builds the block for a given `breakable`, measured at the width
// of the container it lands in. `ratio` is the share of the page's text area
// up to which a block moves whole: half by default, a quarter for lists, which
// are long and frequent enough that moving bigger ones empties too many pages.
#let keep-together(make, ratio: 0.5) = layout(size => {
  let height = measure(make(true), width: size.width).height
  make(height > size.height * ratio)
})

// Called by filter.lua for every `::: {.alert .<kind>}` block. The kinds match
// ALERT_KINDS in lib/config/theme.js and the per-kind Alert styles in
// reference.docx. The title is a sticky block, so an alert tall enough to
// break never leaves its title alone at the foot of a page.
#let alert(kind, title, body) = {
  let palette = alert-colors.at(kind, default: alert-colors.note)
  keep-together(breakable => block(
    width: 100%,
    stroke: (left: 3pt + palette.fg),
    fill: palette.bg,
    inset: (left: 12pt, right: 12pt, top: 10pt, bottom: 10pt),
    radius: (top-right: 4pt, bottom-right: 4pt),
    above: 1.2em,
    below: 1.2em,
    breakable: breakable,
  )[
    #block(sticky: true, above: 0pt, text(weight: "bold", fill: palette.fg)[#title])
    #v(3pt)
    #body
  ])
}

#let linkcard(title, url) = block(
  width: 100%,
  stroke: 0.5pt + border,
  radius: 4pt,
  inset: 12pt,
  above: 1.2em,
  below: 1.2em,
  breakable: false,
)[
  #text(weight: "bold")[#title]
  #linebreak()
  #link(url)[#text(size: 0.9em)[#url]]
]

$-- Attachment label follows the course language via the `labels:` metadata
$-- that the exporter emits (see lib/config/labels.js); English fallback.
$if(labels.attachment)$
#let attachment-label = [$labels.attachment$]
$else$
#let attachment-label = [Attachment:]
$endif$
#let attachment(name) = block(
  above: 1.2em,
  below: 1.2em,
)[
  #text(weight: "bold")[#attachment-label] #raw(name)
]

#let conf(
  title: none,
  subtitle: none,
  course: none,
  date: none,
  logo: none,
  lang: "en",
  region: "BE",
  paper: "a4",
  margin: (left: 2.5cm, right: 2.5cm, top: 2.5cm, bottom: 2.5cm),
  font: ("Helvetica", "Arial"),
  codefont: ("DejaVu Sans Mono",),
  fontsize: 11pt,
  // Off unless `export.number_headings` in course.config.yml (or a
  // `--var section-numbering=1.1.`) passes a pattern in: module and page
  // titles often carry a number of their own.
  sectionnumbering: none,
  pagenumbering: "1",
  toc: false,
  toc-depth: 2,
  doc,
) = {
  // Centred page number, muted, hidden on the cover (page 1).
  let page-footer = if pagenumbering == none { none } else {
    context {
      if counter(page).get().first() > 1 {
        align(center, text(size: 9pt, fill: fg-muted,
          counter(page).display(pagenumbering)))
      }
    }
  }
  set page(paper: paper, margin: margin, numbering: pagenumbering, footer: page-footer)
  set text(font: font, size: fontsize, fill: fg, lang: lang, region: region)
  // Ragged right: Helvetica at this measure justifies poorly, and course notes
  // read better without the rivers.
  set par(justify: false, leading: 0.65em, spacing: 1.15em)
  set heading(numbering: sectionnumbering)
  set list(indent: 1em)
  set enum(indent: 1em)

  show link: set text(fill: link-color)

  show heading: set text(font: heading-font, weight: "bold", fill: heading-color)
  show heading: set block(above: 1.5em, below: 0.7em)
  show heading.where(level: 1): set text(size: 20pt)
  show heading.where(level: 2): set text(size: 15pt)
  show heading.where(level: 3): set text(size: 12.5pt)
  show heading.where(level: 4): set text(size: 11pt)
  show heading.where(level: 1): it => {
    pagebreak(weak: true)
    it
  }
  // A rule under H2 gives the long documents a visible spine, as on the site.
  // The wrapper replaces the heading's own block, so it has to be sticky
  // itself or the heading can end a page.
  show heading.where(level: 2): it => block(
    width: 100%,
    stroke: (bottom: 0.5pt + border),
    inset: (bottom: 5pt),
    sticky: true,
    breakable: false,
    it,
  )
  // H5/H6 are small bold-caps labels, not numbered headings.
  show heading.where(level: 5): it => block(above: 1.4em, below: 0.7em, sticky: true,
    text(size: 10pt, weight: "bold", fill: fg, tracking: 0.05em, upper(it.body)))
  show heading.where(level: 6): it => block(above: 1.4em, below: 0.7em, sticky: true,
    text(size: 10pt, weight: "bold", fill: fg-muted, tracking: 0.05em, upper(it.body)))

  // Replace the quote outright: a `set block` rule would style both the quote
  // and its inner block, drawing the left rule twice.
  show quote.where(block: true): it => block(
    width: 100%,
    stroke: (left: 3pt + border),
    inset: (left: 14pt, top: 4pt, bottom: 4pt),
    above: 1.2em,
    below: 1.2em,
    text(fill: fg-muted, it.body),
  )

  show raw.where(block: true): it => keep-together(breakable => block(
    width: 100%,
    fill: surface-subtle,
    stroke: 0.5pt + border,
    inset: 10pt,
    radius: 4pt,
    breakable: breakable,
    text(font: codefont, size: 0.85em, it),
  ))
  show raw.where(block: false): it => box(
    fill: code-bg,
    inset: (x: 3pt, y: 0pt),
    outset: (y: 3pt),
    radius: 3pt,
    text(font: codefont, size: 0.9em, it),
  )

  // Full hairline grid with a tinted header row.
  set table(
    inset: (x: 8pt, y: 5pt),
    fill: (x, y) => if y == 0 { surface-subtle } else { none },
    stroke: 0.5pt + border,
  )
  show table.cell.where(y: 0): set text(weight: "bold")

  show figure.where(kind: table): set figure.caption(position: top)
  show figure.where(kind: image): set figure.caption(position: bottom)
  show figure.caption: set text(size: 9pt, fill: fg-muted)
  // Pandoc wraps every table in a figure, and a figure is unbreakable: a table
  // taller than the page would run off it. Let it break (the header row
  // repeats), under the same rule as code: a short one moves whole instead.
  show figure.where(kind: table): set block(breakable: true)
  show figure.where(kind: table): it => keep-together(breakable => block(breakable: breakable, it))
  // Lists too, so a short list never strands its first item at the foot of a page.
  show list: it => keep-together(ratio: 0.25, breakable => block(breakable: breakable, it))
  show enum: it => keep-together(ratio: 0.25, breakable => block(breakable: breakable, it))

  show outline.entry.where(level: 1): set block(above: 1em)
  show outline.entry.where(level: 1): set text(weight: "bold")

  if title != none {
    if logo != none {
      image(logo, width: 4cm)
    }
    v(7cm)
    if subtitle != none {
      text(size: 11pt, weight: "bold", fill: fg-muted, tracking: 0.08em,
        upper(subtitle))
      v(0.9em, weak: true)
    }
    par(leading: 0.5em, text(font: heading-font, size: 30pt, weight: "bold",
      fill: heading-color, title))
    v(1.2em, weak: true)
    line(length: 4cm, stroke: 2pt + link-color)
    if course != none {
      v(1.4em, weak: true)
      text(size: 12pt)[#course]
    }
    if date != none {
      v(0.7em, weak: true)
      text(size: 11pt, fill: fg-muted)[#date]
    }
    v(1fr)
    pagebreak()
  }

  if toc {
    outline(depth: toc-depth, indent: auto)
    pagebreak(weak: true)
  }

  doc
}

$if(smart)$
$else$
#set smartquote(enabled: false)

$endif$
$for(header-includes)$
$header-includes$

$endfor$
#show: doc => conf(
$if(title)$
  title: [$title$],
$endif$
$if(subtitle)$
  subtitle: [$subtitle$],
$endif$
$if(course)$
  course: [$course$],
$endif$
$if(date)$
  date: [$date$],
$endif$
$if(logo)$
  logo: "$logo$",
$endif$
$if(lang)$
  lang: "$lang$",
$endif$
$if(region)$
  region: "$region$",
$endif$
$if(papersize)$
  paper: "$papersize$",
$endif$
$if(margin)$
  margin: ($for(margin/pairs)$$margin.key$: $margin.value$,$endfor$),
$endif$
$if(mainfont)$
  font: ("$mainfont$",),
$endif$
$if(codefont)$
  codefont: ($for(codefont)$"$codefont$",$endfor$),
$endif$
$if(fontsize)$
  fontsize: $fontsize$,
$endif$
$if(section-numbering)$
  sectionnumbering: "$section-numbering$",
$endif$
  pagenumbering: $if(page-numbering)$"$page-numbering$"$else$"1"$endif$,
$if(toc)$
  toc: true,
  toc-depth: $toc-depth$,
$endif$
  doc,
)

$for(include-before)$
$include-before$

$endfor$
$body$
$if(citations)$
$for(nocite-ids)$
#cite(label("${it}"), form: none)
$endfor$
$if(csl)$

#set bibliography(style: "$csl$")
$elseif(bibliographystyle)$

#set bibliography(style: "$bibliographystyle$")
$endif$
$if(bibliography)$

#bibliography(($for(bibliography)$"$bibliography$"$sep$,$endfor$)$if(full-bibliography)$, full: true$endif$)
$endif$
$endif$
$for(include-after)$

$include-after$
$endfor$
