const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  COURSEWRIGHT_URL,
  LICENSES,
  findLicense,
  renderFooterHtml,
} = require('../../lib/config/footer');
const { getLabels } = require('../../lib/config/labels');

const en = getLabels('en');
const nl = getLabels('nl');

function footer(overrides) {
  return {
    text: 'Copyright © {year}',
    license: null,
    credit: true,
    ...overrides,
  };
}

describe('LICENSES', () => {
  // A button the table names but static/ lacks would 404 on every page.
  it('has a bundled button for every licence', () => {
    for (const [id, { slug }] of Object.entries(LICENSES)) {
      const file = path.resolve(
        __dirname,
        `../../static/img/licenses/${slug}.svg`,
      );
      assert.ok(fs.existsSync(file), `${id}: ${file} is missing`);
    }
  });

  it('points CC0 at its public-domain deed', () => {
    assert.equal(
      LICENSES['CC0-1.0'].deed,
      'https://creativecommons.org/publicdomain/zero/1.0/',
    );
  });

  it('finds a licence by SPDX identifier, ignoring case', () => {
    assert.equal(findLicense(' cc-by-nc-sa-4.0 '), 'CC-BY-NC-SA-4.0');
    assert.equal(findLicense('cc0-1.0'), 'CC0-1.0');
    assert.equal(findLicense('none'), null);
    assert.equal(findLicense('MIT'), null);
  });
});

describe('renderFooterHtml', () => {
  it('substitutes the year in the notice', () => {
    const html = renderFooterHtml(footer({ credit: false }), en, '/', 2031);
    assert.equal(html, 'Copyright © 2031');
  });

  it('renders the notice as inline markdown', () => {
    const html = renderFooterHtml(
      footer({
        text: '© {year} [Jane Doe](https://example.com)',
        credit: false,
      }),
      en,
      '/',
      2031,
    );
    assert.equal(html, '© 2031 <a href="https://example.com">Jane Doe</a>');
  });

  it('prefixes the licence button with the baseUrl and links its deed', () => {
    const html = renderFooterHtml(
      footer({ text: '', license: 'CC-BY-NC-SA-4.0', credit: false }),
      en,
      '/my-course/',
      2031,
    );
    assert.equal(
      html,
      '<a href="https://creativecommons.org/licenses/by-nc-sa/4.0/" rel="license">' +
        '<img src="/my-course/img/licenses/by-nc-sa.svg" ' +
        'alt="Licensed under CC BY-NC-SA 4.0"></a>',
    );
  });

  it('adds the credit by default and joins the parts with a middle dot', () => {
    const html = renderFooterHtml(
      footer({ license: 'CC0-1.0' }),
      en,
      '/',
      2031,
    );
    const parts = html.split(' · ');
    assert.equal(parts.length, 3);
    assert.equal(parts[0], 'Copyright © 2031');
    assert.match(parts[1], /img\/licenses\/cc-zero\.svg/);
    assert.equal(
      parts[2],
      `Made with <a href="${COURSEWRIGHT_URL}">Coursewright</a>`,
    );
  });

  it('leaves the credit out when it is switched off', () => {
    const html = renderFooterHtml(footer({ credit: false }), en, '/', 2031);
    assert.doesNotMatch(html, /Coursewright/);
  });

  it('renders nothing when every part is switched off', () => {
    const html = renderFooterHtml(
      footer({ text: '', credit: false }),
      en,
      '/',
      2031,
    );
    assert.equal(html, '');
  });

  it('uses the Dutch labels for a Dutch course', () => {
    const html = renderFooterHtml(
      footer({ license: 'CC-BY-4.0' }),
      nl,
      '/',
      2031,
    );
    assert.match(html, /alt="Gepubliceerd onder CC BY 4\.0"/);
    assert.match(html, /Gemaakt met <a href="[^"]+">Coursewright<\/a>/);
  });

  it('escapes an overridden label', () => {
    const labels = {
      site: {
        credit: 'Tools & <tricks> by {coursewright}',
        license: '"{license}"',
      },
    };
    const html = renderFooterHtml(
      footer({ text: '', license: 'CC-BY-4.0' }),
      labels,
      '/',
      2031,
    );
    assert.match(html, /alt="&quot;CC BY 4\.0&quot;"/);
    assert.match(html, /Tools &amp; &lt;tricks&gt; by <a href=/);
  });
});
