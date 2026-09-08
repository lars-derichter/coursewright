const { Marked } = require('marked');
const markedAlert = require('marked-alert');
const { parseFrontmatter } = require('./frontmatter');
const { LABEL_SETS } = require('../config/labels');
const { loadTheme } = require('../config/theme');
const { ICON_FILES } = require('./alert-icons');
const { replaceOutsideCode } = require('./link-resolver');

/**
 * Escape a string for use in HTML: inside a double-quoted attribute value, or
 * as element content.
 *
 * Every outside value this file interpolates into the HTML goes through here,
 * the ones that cannot contain a special character included. The rule is worth
 * more than the bytes it saves: "did I escape this one?" is a judgement call
 * that has to be made again at every edit and was already answered wrong three
 * times — a link href and an image src went out raw for as long as the
 * resolvers have existed, so a file named `say"cheese.png` closed the attribute
 * early and the pull read the truncated URL back as the author's new intent,
 * and the alert title went out raw for as long as titles have been
 * configurable, so a `labels:` override holding a `<` opened a tag in the
 * Canvas page that the next pull silently dropped.
 *
 * `&`, `"`, `<` and `>` only. Single quotes are left alone because no attribute
 * written here is delimited with one — a `'` inside a double-quoted value is an
 * ordinary character, and escaping it would only make the URLs harder to read
 * in a Canvas page's source.
 *
 * One escaper covers both positions rather than two. Element content only needs
 * `&`, `<` and `>`, so the attribute set is a superset of it, and the extra
 * `&quot;` renders as the `"` the author wrote. Splitting the two would buy a
 * literal quote in the page source and cost the thing that makes this work: a
 * rule with no per-site choice in it.
 *
 * A value that came out of a markdown token has to be decoded before it gets
 * here — see decodeSourceEntities below for marked's half of that contract.
 * Escaping alone would encode the `&` of an entity the author had already
 * written, which is how `&amp;` becomes `&amp;amp;`.
 *
 * The pull-side regexes over raw HTML are unaffected by any of this:
 * `downloadReferencedFiles` in lib/sync/local-write.js matches
 * `/courses/<id>/files/<id>`, all digits and slashes, which is upstream of the
 * `?` where an escapable character can first appear.
 */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** The five characters an HTML escaper encodes, by entity name. */
const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** One of those five, or a numeric reference. Nothing else is an entity here. */
const SOURCE_ENTITY =
  /&(?:(amp|lt|gt|quot|apos)|#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6}));/g;

/**
 * Decode the HTML entities in a value marked hands over as raw source text — a
 * link or image destination, an image's alt text, either one's title — as
 * CommonMark reads them, so the escape that follows re-encodes rather than
 * doubles up.
 *
 * This exists because of marked's contract: the renderer is handed those as
 * **raw source text**, entities undecoded, so the token for
 * `[x](https://e.com/?a=1&amp;b=2)` is the literal string `…?a=1&amp;b=2`.
 * Marked's own renderers interpolate that verbatim and rely on the HTML parser
 * to do the decoding — which is why they can get away without escaping, and
 * why escaping without decoding first is wrong: `&amp;` would go out as
 * `&amp;amp;` and Canvas would serve a query parameter literally named `amp;b`.
 * Decode then escape leaves both spellings of the author's URL — `?a=1&b=2` and
 * `?a=1&amp;b=2` — as the one attribute value Canvas resolves to `?a=1&b=2`.
 * The same holds one field over: `![a &amp; b]` is an ampersand between two
 * words, and undecoded it reached the reader as the six characters `&amp;`.
 *
 * Scope: the five characters an escaper encodes, plus numeric references. Those
 * are the forms a URL copied out of HTML source carries, and they are exactly
 * what escapeHtml can produce, so escape ∘ decode is stable over its own
 * output. The other ~2200 HTML5 named entities are left alone deliberately:
 * decoding them needs a table this project would have to take a dependency for,
 * and leaving one as literal text is the harmless direction — the characters
 * the author typed are the characters Canvas serves.
 *
 * For a destination the decode happens at the point of emission, on the
 * pass-through path only. A resolver is still handed, and still looks up, the
 * raw source text: that is the same string `extractFileReferences`
 * (lib/convert/link-resolver.js) keys the upload on, and the two have to agree
 * on what a file is called. What a resolver hands back is not source text at
 * all — `canvasItemUrl` and the `canvas_url` of a sync row assemble it out of
 * ids from `.canvas-sync.json` — so there is no encoding there to undo, and
 * running a decode over it would be a category error: it would rewrite a URL
 * whose path genuinely contains the characters `&amp;`, and a literal `&` in a
 * future verifier URL needs escaping rather than decoding anyway. No resolver
 * is ever handed an alt text or a title, so those are decoded unconditionally.
 *
 * @param {string} str - A destination, alt text or title, as marked hands it
 *   over.
 * @returns {string} The same value with those entities resolved.
 */
function decodeSourceEntities(str) {
  return String(str).replace(SOURCE_ENTITY, (match, name, decimal, hex) => {
    if (name) return NAMED_ENTITIES[name];
    const code = Number.parseInt(decimal || hex, decimal ? 10 : 16);
    // A code point that is not one — a lone surrogate, past the last plane,
    // or NUL — stays literal rather than throwing or being written out.
    if (code <= 0 || code > 0x10ffff) return match;
    if (code >= 0xd800 && code <= 0xdfff) return match;
    return String.fromCodePoint(code);
  });
}

/**
 * Alert styling: GFM type -> color, background. Colours come from the active
 * theme (lib/config/theme.js), so Canvas, the preview site and PDF exports all
 * read one source. Titles come from the course language (lib/config/labels.js)
 * via options.alertTitles.
 *
 * No icon filename. The renderer below emits `alt=""` for a decorative icon and
 * takes the `src` from `options.iconUrls`, which the caller fills from the
 * Canvas file ids in the sync state — so nothing here ever needed the name of
 * the file on disk. `ICON_FILES` is read only for its keys, which are the alert
 * kinds this tool supports; the icons themselves are uploaded by
 * `lib/canvas/icons.js`.
 *
 * @param {string} [rootDir] - Project root, forwarded to loadTheme().
 * @returns {object} Alert type -> `{ color, background }`.
 */
function getAlertConfig(rootDir) {
  const { alerts } = loadTheme(rootDir);
  const config = {};
  for (const type of Object.keys(ICON_FILES)) {
    config[type] = {
      color: alerts[type].fg,
      background: alerts[type].bg,
    };
  }
  return config;
}

/**
 * Table styling: the four inline `style` values a pipe table needs. The two
 * colours come from the active theme (lib/config/theme.js), the source the
 * alerts and the site already read.
 *
 * Inline because Canvas keeps no stylesheet. It strips a `<style>` block and
 * links none of its own, so a bare `<table>` arrives with no border and no
 * padding and every cell runs into the next. The `style` attribute is the
 * channel its sanitiser leaves open, which is how the alert renderer above
 * works too.
 *
 * Two tokens rather than a palette of this renderer's own. `--cw-border` draws
 * the cell borders on the preview site (`--ifm-color-emphasis-300` in
 * src/css/custom.css) and rules the grid in the generic PDF template;
 * `--cw-surface-subtle` fills the header row in both, and stripes every second
 * row on the site (`--ifm-table-stripe-background`). One token per job, so a
 * table cannot look like three different tables across the three surfaces.
 *
 * The padding is the one measurement written here rather than read from
 * somewhere: GitHub's proportions for a markdown table, tighter above and below
 * the text than beside it. The site is set to the same figures by hand
 * (`--ifm-table-cell-padding` in src/css/custom.css), so change the two
 * together or a pushed table stops matching its preview.
 *
 * `text-align` must never appear in any of these values. A pull reads a
 * column's alignment off the cell as
 * `node.getAttribute('align') || node.style.textAlign`
 * (@joplin/turndown-plugin-gfm), so a `text-align` in the style would come back
 * as `:---` in every column of every separator row, in tables the author never
 * aligned. Alignment stays the `align` attribute marked already emits.
 *
 * @param {string} [rootDir] - Project root, forwarded to loadTheme().
 * @returns {object} `{ table, head, cell, stripe }`, each an attribute value.
 */
function getTableStyles(rootDir) {
  const { tokens } = loadTheme(rootDir);
  // Read out of a theme's CSS as written, like the alert colours, so they are
  // outside data and take the same escape.
  const border = escapeHtml(tokens.border);
  const stripe = escapeHtml(tokens['surface-subtle']);
  return {
    table: 'border-collapse: collapse; margin-bottom: 1em;',
    head:
      `border: 1px solid ${border}; border-bottom: 2px solid ${border}; ` +
      `padding: .4em .8em; background: ${stripe};`,
    cell: `border: 1px solid ${border}; padding: .4em .8em;`,
    stripe: `background: ${stripe};`,
  };
}

/**
 * Convert a markdown string to Canvas-compatible HTML.
 *
 * Frontmatter is automatically stripped before conversion.
 *
 * @param {string} markdownContent - Raw markdown (may include frontmatter).
 * @param {object} [options] - Conversion options.
 * @param {object} [options.iconUrls] - Map of alert type to Canvas icon preview URL.
 * @param {object} [options.alertTitles] - Map of alert type to displayed title,
 *   merged over the built-in English titles. Pass the course language's
 *   `labels.alerts` from lib/config/course-config.js.
 * @param {Function} [options.linkResolver] - Callback `(href) => string|null` to resolve internal .md links.
 * @param {Function} [options.fileResolver] - Callback `(href) => string|null` to resolve file/image references.
 * @param {string} [options.rootDir] - Project root, forwarded to loadTheme()
 *   for the alert and table colours. Defaults to the CLI's PROJECT_ROOT.
 * @returns {string} HTML string suitable for Canvas.
 */
function markdownToHtml(markdownContent, options = {}) {
  const alertTitles = { ...LABEL_SETS.en.alerts, ...options.alertTitles };
  // Strip frontmatter so it does not appear in the HTML output
  const { content: rawContent } = parseFrontmatter(markdownContent);

  // Map [!ATTENTION] to [!CAUTION] so marked-alert recognises it. Outside code
  // regions only: this is the one rewrite here that works on the source as text
  // rather than on parsed tokens, so a ```md fence teaching a reader how to
  // write an alert was rewritten along with the real thing. What that cost was
  // the author's own file, not the rendering: the fence reached Canvas holding
  // `[!CAUTION]`, and the next pull read that back and wrote it into the
  // markdown over what had been typed there.
  //
  // `[ \t]*` rather than `\s*`, because the mask blanks a code region with
  // spaces but keeps its newlines: `\s*` let the prefix walk from a `>` on one
  // line, across a masked fence, down to a bare `[!ATTENTION]` further on.
  const content = replaceOutsideCode(
    rawContent,
    /^(>[ \t]*)\[!ATTENTION\]/gm,
    (real) => real.replace('[!ATTENTION]', '[!CAUTION]'),
  );

  const marked = new Marked();

  // Keep output simple for Canvas compatibility
  marked.setOptions({
    gfm: true,
    breaks: false,
  });

  // Register GFM alert tokenisation via marked-alert, adding CHECK as a custom variant
  marked.use(
    markedAlert({
      variants: [{ type: 'check', icon: '', title: alertTitles.check }],
    }),
  );

  // Override the alert renderer with Canvas-compatible inline-styled HTML
  const iconUrls = options.iconUrls || {};
  const alertConfig = getAlertConfig(options.rootDir);
  marked.use({
    extensions: [
      {
        name: 'alert',
        level: 'block',
        renderer({ meta, tokens = [] }) {
          const type = meta.variant;
          const cfg = alertConfig[type] || alertConfig.note;

          // The title is the one value here that lands in element content
          // rather than an attribute, and it is outside data all the same: a
          // `labels:` override in course.config.yml is whatever the author
          // wrote. Raw, an override reading `Let <b>op</b>` opened a bold run
          // in the Canvas page — markup the author never asked for, which the
          // next pull dropped again without a word. Same escaper, because the
          // attribute set is a superset of what content needs.
          const title = escapeHtml(alertTitles[type] || alertTitles.note);

          // The colours are read out of a theme's CSS as written, with no
          // validation of the value, so they are as much outside data as a URL
          // is. Every real one is a hex triplet and comes through untouched.
          const cls = escapeHtml(`markdown-alert markdown-alert-${type}`);
          const color = escapeHtml(cfg.color);
          const background = escapeHtml(cfg.background);

          let imgHtml = '';
          const url = iconUrls[type];
          if (url) {
            // alt="" because the icon is decorative: the title it sits against
            // says the same thing in words, immediately after it and in the
            // same paragraph. Naming the file instead had a screenreader
            // announce "info.svg Note". The Docusaurus preview has emitted an
            // empty alt for this icon all along (src/plugins/remark-gfm-alerts.js).
            imgHtml = `<img style="height: 0.8em; vertical-align: baseline;" src="${escapeHtml(url)}" alt="" /> `;
          }

          let html = `<div class="${cls}" style="border-left: .25em solid ${color}; background: ${background}; padding: .75em 1em;">\n`;
          html += `    <p class="markdown-alert-title" style="color: ${color}; font-size: 1.2em;">${imgHtml}${title}</p>\n`;
          html += `    ${this.parser.parse(tokens)}`;
          html += `</div>\n<p>&nbsp;</p>\n`;
          return html;
        },
      },
    ],
  });

  // Override the table renderers with inline-styled HTML, unconditionally:
  // the styling is the part Canvas cannot supply itself. Element order,
  // attribute order and whitespace are marked's own, so what a page's HTML
  // gains over the previous release is the style attributes and nothing else.
  const tableStyles = getTableStyles(options.rootDir);
  marked.use({
    renderer: {
      // marked's default `table` is re-implemented rather than wrapped because
      // it hands `tablerow` a row's cells and nothing else, and the stripe
      // needs to know which row this is. `tablerow` is therefore left alone;
      // the `<tr>` is built here.
      table(token) {
        let header = '';
        for (const cell of token.header) header += this.tablecell(cell);

        let body = '';
        for (const [index, row] of token.rows.entries()) {
          let cells = '';
          for (const cell of row) cells += this.tablecell(cell);
          // Infima stripes `table tr:nth-child(2n)`, which inside `<tbody>` is
          // the second body row and every other one after it.
          const open =
            index % 2 === 1 ? `<tr style="${tableStyles.stripe}">` : '<tr>';
          body += `${open}\n${cells}</tr>\n`;
        }
        // No `<tbody>` at all for a header-only table, as marked does it.
        if (body) body = `<tbody>${body}</tbody>`;

        return (
          `<table style="${tableStyles.table}">\n<thead>\n` +
          `<tr>\n${header}</tr>\n` +
          `</thead>\n${body}</table>\n`
        );
      },
      tablecell(token) {
        const content = this.parser.parseInline(token.tokens);
        const tag = token.header ? 'th' : 'td';
        const align = token.align ? ` align="${escapeHtml(token.align)}"` : '';
        const style = token.header ? tableStyles.head : tableStyles.cell;
        return `<${tag}${align} style="${style}">${content}</${tag}>\n`;
      },
    },
  });

  // Rewrite internal links: .md links via linkResolver, file links via fileResolver
  if (options.linkResolver || options.fileResolver) {
    const rendererOverrides = {};

    rendererOverrides.link = function ({ href, title, tokens }) {
      // `wasResolved` rather than a comparison against `href`: what decides
      // whether this is still source text is whether a resolver answered, and
      // one that answers with the string it was given has still answered.
      let finalHref = href;
      let wasResolved = false;
      if (options.linkResolver) {
        const resolved = options.linkResolver(href);
        if (resolved) {
          finalHref = resolved;
          wasResolved = true;
        }
      }
      // For non-.md links, try fileResolver as fallback
      if (finalHref === href && options.fileResolver) {
        const resolved = options.fileResolver(href);
        if (resolved) {
          finalHref = resolved;
          wasResolved = true;
        }
      }
      if (!wasResolved) finalHref = decodeSourceEntities(finalHref);
      const titleAttr = title
        ? ` title="${escapeHtml(decodeSourceEntities(title))}"`
        : '';
      const text = this.parser.parseInline(tokens);
      return `<a href="${escapeHtml(finalHref)}"${titleAttr}>${text}</a>`;
    };

    if (options.fileResolver) {
      rendererOverrides.image = function ({ href, title, text }) {
        let src = href;
        let wasResolved = false;
        if (src && !src.match(/^https?:\/\//) && !src.startsWith('//')) {
          const resolved = options.fileResolver(src);
          if (resolved) {
            src = resolved;
            wasResolved = true;
          }
        }
        if (!wasResolved) src = decodeSourceEntities(src);
        // Alt and title are source text like the destination, never resolver
        // output, so they are decoded every time.
        const titleAttr = title
          ? ` title="${escapeHtml(decodeSourceEntities(title))}"`
          : '';
        const alt = text ? escapeHtml(decodeSourceEntities(text)) : '';
        return `<img src="${escapeHtml(src)}" alt="${alt}"${titleAttr}>`;
      };
    }

    marked.use({ renderer: rendererOverrides });
  }

  const html = marked.parse(content);
  return html;
}

module.exports = {
  markdownToHtml,
  getAlertConfig,
  getTableStyles,
};
