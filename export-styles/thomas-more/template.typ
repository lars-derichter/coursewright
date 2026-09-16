$-- Course export template for pandoc's Typst writer.
$-- Styled after the Thomas More course template (Cursussjabloon A4). Select it
$-- with `export.style: thomas-more` in course.config.yml, or override single
$-- files by placing them in sources/export-style/.
$if(highlighting-definitions)$
// syntax highlighting functions from skylighting:
$highlighting-definitions$

$endif$
// Colours come from the theme (src/css/themes/<name>.css), which the exporter
// parses and passes in as pandoc variables. The literals below are the Thomas
// More fallback for rendering this template without them — they mirror
// src/css/themes/thomas-more.css. Pair this style with `theme: thomas-more`
// for the full house style.
#let pick(injected, fallback) = {
  let value = injected.trim()
  rgb(if value == "" { fallback } else { value })
}

#let tm-orange = pick("$cw-accent$", "#FA6432")
#let tm-navy = pick("$cw-secondary$", "#00283C")
#let tm-link = pick("$cw-link$", "#00637C")
#let tm-grey = pick("$cw-code-bg$", "#E8EBEE")
#let tm-muted = pick("$cw-fg-muted$", "#595959")
#let tm-tableline = pick("$cw-border$", "#AABDCA")
#let heading-color = pick("$cw-heading$", "#FA6432")

// Century Gothic first: Microsoft Office installs it, and the exporter points
// Typst at Office's font directory. Nunito ships in this style's fonts/ folder
// as the guaranteed fallback, and matches the thomas-more theme on the web.
#let heading-font = ("Century Gothic", "Nunito", "Arial")

// Thematic breaks. Pandoc emits `#divider()` (Typst 0.15+) and `#horizontalrule`
// on older versions; both are defined so the rule keeps the centred hairline
// look rather than Typst's default full-weight black line.
#let divider() = align(center, line(length: 50%, stroke: 0.5pt + tm-tableline))
#let horizontalrule = line(start: (25%, 0%), end: (75%, 0%), stroke: 0.5pt + tm-tableline)

#show terms.item: it => block(breakable: false)[
  #text(weight: "bold")[#it.term]
  #block(inset: (left: 1.5em, top: -0.4em))[#it.description]
]

// Alert kinds mirror ALERT_KINDS in lib/config/theme.js and the per-kind Alert
// styles in reference.docx.
#let alert-colors = (
  note: (
    fg: pick("$cw-alert-note-fg$", "#4bafe1"),
    bg: pick("$cw-alert-note-bg$", "#f4fafd"),
  ),
  tip: (
    fg: pick("$cw-alert-tip-fg$", "#64c8c8"),
    bg: pick("$cw-alert-tip-bg$", "#f6fcfc"),
  ),
  important: (
    fg: pick("$cw-alert-important-fg$", "#967dc8"),
    bg: pick("$cw-alert-important-bg$", "#f9f7fc"),
  ),
  warning: (
    fg: pick("$cw-alert-warning-fg$", "#ffc87d"),
    bg: pick("$cw-alert-warning-bg$", "#fffcf7"),
  ),
  caution: (
    fg: pick("$cw-alert-caution-fg$", "#fa6432"),
    bg: pick("$cw-alert-caution-bg$", "#fff6f3"),
  ),
  check: (
    fg: pick("$cw-alert-check-fg$", "#00283c"),
    bg: pick("$cw-alert-check-bg$", "#f5f6f7"),
  ),
)

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

// The title is a sticky block, so an alert tall enough to break never leaves
// its title alone at the foot of a page.
#let alert(kind, title, body) = {
  let palette = alert-colors.at(kind, default: alert-colors.note)
  keep-together(breakable => block(
    width: 100%,
    stroke: (left: 3pt + palette.fg),
    fill: palette.bg,
    inset: (left: 12pt, right: 10pt, top: 8pt, bottom: 8pt),
    radius: (top-right: 3pt, bottom-right: 3pt),
    above: 1.2em,
    below: 1.2em,
    breakable: breakable,
  )[
    #block(sticky: true, above: 0pt,
      text(weight: "bold", fill: palette.fg.darken(10%))[#title])
    #v(2pt)
    #body
  ])
}

#let linkcard(title, url) = block(
  width: 100%,
  stroke: 0.5pt + tm-tableline,
  radius: 4pt,
  inset: 10pt,
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
  margin: (left: 2.5cm, right: 2.5cm, top: 2.5cm, bottom: 2.3cm),
  font: ("Arial", "Nunito"),
  codefont: ("DejaVu Sans Mono",),
  fontsize: 12pt,
  // Off unless `export.number_headings` in course.config.yml (or a
  // `--var section-numbering=1.1.`) passes a pattern in: module and page
  // titles often carry a number of their own.
  sectionnumbering: none,
  pagenumbering: "1",
  toc: false,
  toc-depth: 2,
  doc,
) = {
  // Footer per the TM template: centred page number with a small vertical
  // orange rule near the left page edge. Hidden on the cover (page 1).
  let tm-footer = if pagenumbering == none { none } else {
    context {
      if counter(page).get().first() > 1 {
        place(left + horizon, dx: -1.5cm,
          line(start: (0pt, -0.4cm), end: (0pt, 0.4cm), stroke: 0.5pt + tm-orange))
        align(center, text(size: 9pt, fill: tm-muted,
          counter(page).display(pagenumbering)))
      }
    }
  }
  set page(paper: paper, margin: margin, numbering: pagenumbering, footer: tm-footer)
  set text(font: font, size: fontsize, lang: lang, region: region)
  set par(justify: true, leading: 0.6em, spacing: 1.2em)
  set heading(numbering: sectionnumbering)
  set list(indent: 1em)
  set enum(indent: 1em)

  show link: set text(fill: tm-link)

  show heading: set text(font: heading-font, weight: "bold")
  show heading: set block(above: 1.4em, below: 0.8em)
  show heading.where(level: 1): set text(size: 21pt, fill: heading-color)
  show heading.where(level: 2): set text(size: 15pt, fill: tm-navy)
  show heading.where(level: 3): set text(size: 13pt, fill: heading-color)
  show heading.where(level: 4): set text(size: 12pt, fill: tm-navy, style: "italic")
  show heading.where(level: 1): it => {
    pagebreak(weak: true)
    it
  }
  // H5/H6 are small bold-caps labels in the TM template, not numbered. The
  // blocks replace the heading's own, so they have to be sticky themselves.
  show heading.where(level: 5): it => block(above: 1.4em, below: 0.8em, sticky: true,
    text(font: font, size: 11pt, weight: "bold", fill: heading-color, upper(it.body)))
  show heading.where(level: 6): it => block(above: 1.4em, below: 0.8em, sticky: true,
    text(font: font, size: 11pt, weight: "bold", fill: tm-navy, upper(it.body)))

  show quote.where(block: true): set text(style: "italic", fill: tm-muted)

  show raw.where(block: true): it => keep-together(breakable => block(
    width: 100%,
    fill: tm-grey,
    inset: 8pt,
    radius: 3pt,
    breakable: breakable,
    text(font: codefont, size: 0.85em, it),
  ))
  show raw.where(block: false): it => box(
    fill: tm-grey,
    inset: (x: 3pt, y: 0pt),
    outset: (y: 3pt),
    radius: 2pt,
    text(font: codefont, size: 0.9em, it),
  )

  // Tables per the TM "Tabel (oranje)" style: navy header row with white bold
  // text, inner hairlines only, no outer border.
  set table(
    inset: (x: 8pt, y: 4pt),
    fill: (x, y) => if y == 0 { tm-navy } else { none },
    stroke: (x, y) => (
      left: if x > 0 { 0.5pt + tm-tableline } else { none },
      top: if y > 0 { 0.5pt + tm-tableline } else { none },
    ),
  )
  show table.cell.where(y: 0): set text(weight: "bold", fill: white)

  show figure.where(kind: table): set figure.caption(position: top)
  show figure.where(kind: image): set figure.caption(position: bottom)
  show figure.caption: set text(size: 9pt, style: "italic")
  // Pandoc wraps every table in a figure, and a figure is unbreakable: a table
  // taller than the page would run off it. Let it break (the header row
  // repeats), under the same rule as code: a short one moves whole instead.
  show figure.where(kind: table): set block(breakable: true)
  show figure.where(kind: table): it => keep-together(breakable => block(breakable: breakable, it))
  // Lists too, so a short list never strands its first item at the foot of a page.
  show list: it => keep-together(ratio: 0.25, breakable => block(breakable: breakable, it))
  show enum: it => keep-together(ratio: 0.25, breakable => block(breakable: breakable, it))

  // TOC: level-1 entries bold navy, per the TM toc styles.
  show outline.entry.where(level: 1): set block(above: 1em)
  show outline.entry.where(level: 1): set text(weight: "bold", fill: tm-navy)

  if title != none {
    if logo != none {
      place(top + left, dx: -0.49cm, dy: -0.49cm, image(logo, width: 3.76cm))
    }
    v(8cm)
    if subtitle != none {
      text(font: heading-font, size: 13pt, weight: "bold", fill: tm-navy,
        tracking: 0.03em, upper(subtitle))
      v(0.8em, weak: true)
    }
    par(leading: 0.45em, text(font: heading-font, size: 32pt, weight: "bold",
      fill: heading-color, title))
    if course != none {
      v(1.6em, weak: true)
      text(size: 12pt)[#course]
    }
    if date != none {
      v(0.9em, weak: true)
      text(size: 12pt, fill: tm-muted)[#date]
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
