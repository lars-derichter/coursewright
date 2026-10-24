# Third-Party Assets

This repository is licensed under the MIT licence (tooling, see `LICENSE`) and
CC BY-NC-SA 4.0 (course content, see `course/LICENSE.md`). The files listed
below come from elsewhere and keep the licence of their own authors.

## Bundled Under a Free Licence

- `export-styles/thomas-more/fonts/Nunito-*.ttf`: the Nunito typeface, copyright
  2014 The Nunito Project Authors, under the SIL Open Font License 1.1. The full
  licence ships next to the fonts in `export-styles/thomas-more/fonts/OFL.txt`.
- `src/svg-icons/caution.svg`, `important.svg`, `info.svg`, `tip.svg` and
  `warning.svg`: the `stop`, `report`, `info`, `light-bulb` and `alert` icons
  from [GitHub Octicons](https://primer.style/octicons/), © GitHub, Inc., under
  the MIT licence. Full text in `src/svg-icons/LICENSE-octicons.txt`.
- `src/svg-icons/check.svg`: the `task_alt` symbol from
  [Google Material Symbols](https://fonts.google.com/icons), © Google, under the
  Apache License 2.0. Full text in `src/svg-icons/LICENSE-material-symbols.txt`.
  It covers this project's own `[!CHECK]` alert, which GitHub has no icon for.

The alert icons are uploaded to your Canvas course as files and embedded in PDF
exports, so those notices travel with the icons.

## Property of Their Owners

These belong to their owners. They are covered by **neither** of this
repository's licences.

- `export-styles/thomas-more/logo.png`: the logo of Thomas More University of
  Applied Sciences, a trademark of Thomas More. Used as the example cover mark
  in the `thomas-more` export style, a worked example of institutional branding.
- The colours in `src/css/themes/thomas-more.css` are Thomas More's, in the
  theme of the same name.
- `static/img/licenses/*.svg`: the 88×31 licence buttons from the
  [Creative Commons press kit](https://creativecommons.org/mission/downloads/),
  downloaded from `mirrors.creativecommons.org/presskit/buttons/88x31/svg/` and
  bundled unmodified. They are Creative Commons trademarks, which are not under
  a Creative Commons licence. The
  [Creative Commons trademark policy](https://creativecommons.org/policies/#trademark)
  licenses the button marks on the condition that a button is used "solely to
  describe the Creative Commons legal tool that applies to a particular work"
  and links to the relevant deed, and allows no modified version. The site
  footer shows one only as `footer.license` sets it and always links it to the
  deed. Do not edit, recolour or reuse these files for anything else.

## Fonts Referenced but Not Bundled

- **Century Gothic** (© Monotype Imaging Inc.) is the first choice for headings
  in the `thomas-more` style and is named in its `reference.docx`. The font
  files are not distributed here: Microsoft Office installs the typeface, and
  the exporter looks for it there. See
  [docs/export-styling.md](docs/export-styling.md). On a machine without it,
  headings fall back to the bundled Nunito.
- `src/css/themes/thomas-more.css` imports the Nunito and Inconsolata webfonts
  from Google Fonts for the preview site. Both are licensed under the SIL Open
  Font License 1.1 and are fetched at runtime rather than bundled here.

Neither the `thomas-more` style nor the `thomas-more` theme is the default: the
shipped defaults (`generic` and `github`) are brand-neutral. When you build your
own course, point `theme:` and `export.style:` in `course.config.yml` at your
institution's colours, fonts and logo;
[docs/customisation.md](docs/customisation.md) explains how.

If you add a font or logo of your own to a style, check that its licence permits
redistribution before committing it, and record it here.
