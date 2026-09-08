const fs = require('fs');
const path = require('path');

const { flattenItems } = require('../convert/course-scanner');
const { getLabels } = require('../config/labels');
const { preprocessItem } = require('./preprocess');

/**
 * The Canvas types that carry no body of their own: the item is a reference to
 * something authored and stored in Canvas (a Classic Quiz, an LTI tool), and
 * the markdown file only records that it belongs in this module. Mirrors
 * REFERENCE_TYPES in src/plugins/remark-reference-item.js, which gives the same
 * two types a body in the preview. Each name doubles as the key of its label in
 * the `cards` label group.
 */
const REFERENCE_TYPES = new Set(['quiz', 'external_tool']);

/**
 * Image formats both export engines render: typst (PDF) and Word (DOCX).
 * webp (older Word), avif and bmp (typst) are preview-only; their file items
 * keep the attachment block alone, like video and audio.
 */
const EXPORT_IMAGE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.svg',
]);

/**
 * Deterministic anchor id for an item's relativePath. Shared by assemble (which
 * injects it into the item's chapter heading) and preprocess (which rewrites
 * cross-links to `#anchor`), so a link and its target always agree.
 *
 * @param {string} relativePath - Item path relative to course/ (posix or native).
 * @returns {string}
 */
function anchorFor(relativePath) {
  return (
    'sec-' +
    relativePath
      .replace(/\\/g, '/')
      .replace(/\.md$/i, '')
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase()
  );
}

/** Escape a value for inclusion inside a double-quoted pandoc attribute. */
function escapeAttr(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** Escape a value for inclusion inside a double-quoted YAML scalar. */
function escapeYaml(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Build the pandoc YAML metadata block for the combined document. Only fields
 * that are set are emitted. `title` drives the title page in template.typ;
 * `toc` drives the generated table of contents. `labels` (a flat map of label
 * key -> display string) is what filter.lua and template.typ read so alert
 * titles and the attachment label follow the course language.
 *
 * @param {object} meta
 * @returns {string} A `---`-delimited YAML block, or '' when nothing to emit.
 */
function buildMetaBlock(meta = {}) {
  const lines = [];
  for (const key of ['title', 'subtitle', 'course', 'date']) {
    if (meta[key]) lines.push(`${key}: "${escapeYaml(meta[key])}"`);
  }
  lines.push(`lang: ${meta.lang || 'en'}`);
  if (meta.toc) lines.push('toc: true');
  if (meta.labels && Object.keys(meta.labels).length > 0) {
    lines.push('labels:');
    for (const [key, value] of Object.entries(meta.labels)) {
      lines.push(`  ${key}: "${escapeYaml(value)}"`);
    }
  }
  return `---\n${lines.join('\n')}\n---`;
}

/**
 * Head the item body with its chapter heading, carrying the chapter anchor. The
 * heading is always built from the frontmatter title, emoji and all, because a
 * course page carries no H1 of its own: the title is the page heading in every
 * output, Canvas and the preview site included. A body that still opens with a
 * heading therefore prints its title twice, and `npx course validate` reports
 * the page.
 *
 * An empty body yields the heading alone, so a scaffolded page with nothing
 * under its frontmatter does not join into a run of blank lines.
 *
 * @param {string} body - Preprocessed markdown body.
 * @param {object} item - Scanner item.
 * @param {number} level - Target heading level for this item.
 * @param {string} anchor - Anchor id to attach.
 * @returns {string}
 */
function prependTitleHeading(body, item, level, anchor) {
  const heading = `${'#'.repeat(level)} ${item.title} {#${anchor}}`;
  const trimmed = body.trim();
  return trimmed ? `${heading}\n\n${trimmed}` : heading;
}

/**
 * Render a reference item (quiz, external tool): a chapter heading, a card
 * naming what the item is, and the notice saying it is managed in Canvas. The
 * same two facts the preview site shows, in the export's idiom.
 *
 * A tool's launch URL is worth printing in full — a reader holding the PDF can
 * type it — so it becomes the same bordered link card an external_url item
 * gets, labelled by type rather than by title (the heading already carries the
 * title). A quiz has no address this document can print: the preview builds one
 * from the Canvas host in .canvas-sync.json, which is no part of the export, and
 * a card promising a link it cannot give is worse than none. It gets the type
 * label alone, as does a tool whose launch URL is missing.
 *
 * @param {object} item - Scanner item of a REFERENCE_TYPES canvasType.
 * @param {string} hashes - Heading hashes for the target level.
 * @param {string} anchor - Anchor id for this item.
 * @param {object} labels - Full label set (lib/config/labels.js shape).
 * @returns {string}
 */
function renderReferenceItem(item, hashes, anchor, labels) {
  const cardLabel = labels.cards[item.canvasType] || item.canvasType;
  const url =
    item.canvasType === 'external_tool'
      ? String((item.frontmatter && item.frontmatter.external_url) || '').trim()
      : '';
  const card = url
    ? `::: {.link-card title="${escapeAttr(cardLabel)}" url="${escapeAttr(url)}"}\n:::`
    : `**${cardLabel}**`;

  return (
    `${hashes} ${item.title} {#${anchor}}\n\n` +
    `${card}\n\n` +
    `*${labels.reference.notice}*`
  );
}

/**
 * Render one item to markdown at the given heading level. Pages and assignments
 * contribute their preprocessed body; external_url and file items become a
 * chapter heading followed by a link-card / attachment div; quiz and
 * external_tool items become a reference card (see renderReferenceItem).
 *
 * @param {object} item - Scanner item, optionally carrying `rawMd`.
 * @param {number} level - Target heading level.
 * @param {number} shift - Heading shift for the body (level - 1, plus indent).
 * @param {object} ctx - Preprocess context (courseDir, includedPaths, ...),
 *   optionally carrying `labels` (a full label set); English when absent.
 * @returns {string}
 */
function renderItem(item, level, shift, ctx) {
  const anchor = anchorFor(item.relativePath);
  const hashes = '#'.repeat(level);

  if (REFERENCE_TYPES.has(item.canvasType)) {
    return renderReferenceItem(item, hashes, anchor, ctx.labels || getLabels());
  }

  if (item.canvasType === 'external_url') {
    const url = (item.frontmatter && item.frontmatter.external_url) || '';
    return (
      `${hashes} ${item.title} {#${anchor}}\n\n` +
      `::: {.link-card title="${escapeAttr(item.title)}" url="${escapeAttr(url)}"}\n:::`
    );
  }

  if (item.canvasType === 'file') {
    const ref = item.frontmatter && item.frontmatter.file_ref;
    const name = ref ? path.posix.basename(ref.replace(/\\/g, '/')) : item.file;
    // An image file item embeds above its attachment block, mirroring the
    // preview's media-above-card layout. Absolute path for the same reason as
    // rewriteImagePaths (pandoc runs in a temp dir); empty alt so pandoc's
    // implicit_figures never adds a caption duplicating the heading; angle
    // brackets keep paths with spaces intact. A missing binary embeds
    // nothing, so the export can never fail on a file the preview would
    // merely warn about.
    let embed = '';
    if (ref && EXPORT_IMAGE_EXTENSIONS.has(path.extname(name).toLowerCase())) {
      const abs = path.resolve(
        ctx.courseDir,
        path.posix.dirname(item.relativePath),
        ref.replace(/\\/g, '/'),
      );
      if (fs.existsSync(abs)) embed = `![](<${abs}>)\n\n`;
    }
    return (
      `${hashes} ${item.title} {#${anchor}}\n\n` +
      embed +
      `::: {.attachment name="${escapeAttr(name)}"}\n:::`
    );
  }

  const raw =
    item.rawMd != null
      ? item.rawMd
      : fs.readFileSync(path.join(ctx.courseDir, item.relativePath), 'utf8');
  const body = preprocessItem(raw, item, { ...ctx, headingShift: shift });
  return prependTitleHeading(body, item, level, anchor);
}

/**
 * Assemble one combined markdown string for the whole export.
 *
 * Heading regimes:
 *  - `course` — module title as H1, items as H2 (body shifted +1). Used for
 *    full-course export and for selections spanning more than one module.
 *  - `flat`   — items as H1 (no shift). Used for a single module or a
 *    single-module selection.
 *  - `bare`   — one item as H1, no title page. Used for single-item export.
 *
 * Subheaders (subfolders) become a heading at the item level; their children
 * are nested one level deeper via their `indent`.
 *
 * @param {Array<{moduleTitle: string, moduleFolder?: string, items: object[]}>} groups
 * @param {object} meta - { title?, subtitle?, course?, date?, lang?, toc?, regime }
 * @param {object} ctx - { courseDir, includedPaths, linkMap?, courseId?, labels? }
 * @returns {string}
 */
function buildCombinedMarkdown(groups, meta, ctx) {
  const regime = meta.regime || 'flat';
  // Reference cards are the only labels rendered into the markdown itself (the
  // rest travel as `labels:` metadata for filter.lua and template.typ). A caller
  // that has resolved the course's labels — overrides included — passes them in;
  // otherwise the document language decides.
  const labels = ctx.labels || getLabels(meta.lang);
  const fullCtx = { ...ctx, anchorFor, labels };
  const parts = [];

  const metaBlock = buildMetaBlock(meta);
  if (metaBlock) parts.push(metaBlock);

  if (regime === 'bare') {
    const item = groups[0].items[0];
    parts.push(renderItem(item, 1, 0, fullCtx));
    return parts.join('\n\n') + '\n';
  }

  const itemLevel = regime === 'course' ? 2 : 1;
  const baseShift = itemLevel - 1;

  for (const group of groups) {
    if (regime === 'course') {
      const manchor = anchorFor(`${group.moduleFolder}/`);
      parts.push(`# ${group.moduleTitle} {#${manchor}}`);
    }

    for (const node of flattenItems(group.items)) {
      if (node.type === 'subheader') {
        parts.push(
          `${'#'.repeat(itemLevel)} ${node.title} {#${anchorFor(
            `${group.moduleFolder}/${node.folderName}`,
          )}}`,
        );
        continue;
      }
      const extra = node.indent || 0;
      parts.push(
        renderItem(node, itemLevel + extra, baseShift + extra, fullCtx),
      );
    }
  }

  return parts.join('\n\n') + '\n';
}

module.exports = {
  buildCombinedMarkdown,
  buildMetaBlock,
  prependTitleHeading,
  renderItem,
  anchorFor,
  REFERENCE_TYPES,
};
