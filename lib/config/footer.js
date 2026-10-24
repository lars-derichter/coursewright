/**
 * The site footer: the Creative Commons licences a course can declare, and the
 * HTML docusaurus.config.js hands Docusaurus as `footer.copyright`.
 *
 * This module is pure data plus a renderer, no I/O. lib/config/course-config.js
 * resolves the `footer:` block of course.config.yml against LICENSES; only the
 * website reads the result, never an export or the Canvas sync.
 */

const { Marked } = require('marked');

/** Where the "Made with Coursewright" credit points. */
const COURSEWRIGHT_URL = 'https://github.com/lars-derichter/coursewright';

/**
 * The licences `footer.license` accepts, keyed by SPDX identifier. `slug` names
 * the button under static/img/licenses/, copied unmodified from the Creative
 * Commons press kit (see THIRD-PARTY.md); `deed` is the page the button links
 * to, which the Creative Commons trademark policy requires of every button.
 */
const LICENSES = Object.freeze({
  'CC-BY-4.0': ccLicense('by', 'CC BY 4.0', 'licenses/by/4.0/'),
  'CC-BY-SA-4.0': ccLicense('by-sa', 'CC BY-SA 4.0', 'licenses/by-sa/4.0/'),
  'CC-BY-NC-4.0': ccLicense('by-nc', 'CC BY-NC 4.0', 'licenses/by-nc/4.0/'),
  'CC-BY-NC-SA-4.0': ccLicense(
    'by-nc-sa',
    'CC BY-NC-SA 4.0',
    'licenses/by-nc-sa/4.0/',
  ),
  'CC-BY-ND-4.0': ccLicense('by-nd', 'CC BY-ND 4.0', 'licenses/by-nd/4.0/'),
  'CC-BY-NC-ND-4.0': ccLicense(
    'by-nc-nd',
    'CC BY-NC-ND 4.0',
    'licenses/by-nc-nd/4.0/',
  ),
  'CC0-1.0': ccLicense('cc-zero', 'CC0 1.0', 'publicdomain/zero/1.0/'),
});

function ccLicense(slug, name, deedPath) {
  return Object.freeze({
    slug,
    name,
    deed: `https://creativecommons.org/${deedPath}`,
  });
}

/**
 * Look a licence up by SPDX identifier, ignoring case.
 *
 * @param {string} id
 * @returns {string|null} The identifier as LICENSES spells it, or null.
 */
function findLicense(id) {
  const wanted = String(id).trim().toLowerCase();
  return (
    Object.keys(LICENSES).find((key) => key.toLowerCase() === wanted) || null
  );
}

/** A private instance, so nothing here depends on global marked options. */
const marked = new Marked();

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Render the footer line: the author's notice, the licence button and the
 * credit, in that order, joined by a middle dot. A part that is switched off is
 * left out, so the result can be an empty string.
 *
 * Docusaurus inserts `copyright` as raw HTML, without rewriting any path in it,
 * so the button's src is prefixed with the site's baseUrl here. The notice is
 * the author's own markdown and passes through as written; the labels are
 * escaped, because an override in course.config.yml is plain text.
 *
 * @param {{ text: string, license: string|null, credit: boolean }} footer -
 *   The resolved `footer` of loadCourseConfig.
 * @param {object} labels - The resolved labels; reads `labels.site`.
 * @param {string} baseUrl - The site's baseUrl, with its trailing slash.
 * @param {number} year - Substituted for `{year}` in the notice.
 * @returns {string} Inline HTML.
 */
function renderFooterHtml(footer, labels, baseUrl, year) {
  const parts = [];

  if (footer.text) {
    const text = footer.text.replaceAll('{year}', String(year));
    parts.push(marked.parseInline(text).trim());
  }

  const license = footer.license && LICENSES[footer.license];
  if (license) {
    const alt = labels.site.license.replaceAll('{license}', license.name);
    const src = `${baseUrl}img/licenses/${license.slug}.svg`;
    parts.push(
      `<a href="${escapeHtml(license.deed)}" rel="license">` +
        `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}"></a>`,
    );
  }

  if (footer.credit) {
    const link = `<a href="${COURSEWRIGHT_URL}">Coursewright</a>`;
    parts.push(
      escapeHtml(labels.site.credit).replaceAll('{coursewright}', link),
    );
  }

  return parts.join(' · ');
}

module.exports = {
  COURSEWRIGHT_URL,
  LICENSES,
  findLicense,
  renderFooterHtml,
};
