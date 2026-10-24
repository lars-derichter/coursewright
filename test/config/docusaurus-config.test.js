const { describe, it, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const CONFIG_PATH = require.resolve('../../docusaurus.config.js');
const WORKFLOW_PATH = path.resolve(
  __dirname,
  '../../.github/workflows/deploy.yml',
);

function setOrDelete(key, value) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

/** Load docusaurus.config.js under a given environment, then restore it. */
function loadConfig({ siteUrl, baseUrl } = {}) {
  const previous = {
    CW_SITE_URL: process.env.CW_SITE_URL,
    CW_BASE_URL: process.env.CW_BASE_URL,
  };
  setOrDelete('CW_SITE_URL', siteUrl);
  setOrDelete('CW_BASE_URL', baseUrl);
  delete require.cache[CONFIG_PATH];
  try {
    return require(CONFIG_PATH);
  } finally {
    setOrDelete('CW_SITE_URL', previous.CW_SITE_URL);
    setOrDelete('CW_BASE_URL', previous.CW_BASE_URL);
    delete require.cache[CONFIG_PATH];
  }
}

describe('docusaurus.config.js hosting values', () => {
  it('takes the site address from the environment', () => {
    const config = loadConfig({
      siteUrl: 'https://acme.github.io',
      baseUrl: '/my-course/',
    });
    assert.equal(config.url, 'https://acme.github.io');
    assert.equal(config.baseUrl, '/my-course/');
  });

  it('falls back to placeholders for a local build', () => {
    const config = loadConfig();
    assert.equal(config.url, 'https://example.com');
    assert.equal(config.baseUrl, '/');
  });
});

describe('docusaurus.config.js remark plugins', () => {
  /** The plugin list, with each entry reduced to its plugin function. */
  function remarkPlugins(config) {
    const [, options] = config.presets[0];
    return options.docs.beforeDefaultRemarkPlugins.map((entry) =>
      Array.isArray(entry) ? entry[0] : entry,
    );
  }

  // Quiz and external tool pages have no body of their own; without this
  // plugin they render as blank pages in the preview.
  it('registers the reference-item plugin', () => {
    const config = loadConfig();
    const remarkReferenceItem = require('../../src/plugins/remark-reference-item');
    assert.ok(remarkPlugins(config).includes(remarkReferenceItem));
  });

  it('passes the reference-item plugin its labels', () => {
    const config = loadConfig();
    const [, options] = config.presets[0];
    const entry = options.docs.beforeDefaultRemarkPlugins.find(
      (item) =>
        Array.isArray(item) &&
        item[0] === require('../../src/plugins/remark-reference-item'),
    );
    assert.equal(typeof entry[1].cards.quiz, 'string');
    assert.equal(typeof entry[1].reference.notice, 'string');
  });
});

describe('docusaurus.config.js footer', () => {
  // The footer values are pinned here rather than read from course.config.yml,
  // which a course author owns: a course that switches the credit off must
  // still pass npm test. Parsing the block is course-config.test.js's job.
  const courseConfig = require('../../lib/config/course-config');

  function loadWithFooter(footer, env) {
    const real = courseConfig.loadCourseConfig;
    const stub = mock.method(courseConfig, 'loadCourseConfig', (root) => ({
      ...real(root),
      footer,
    }));
    try {
      return loadConfig(env);
    } finally {
      stub.mock.restore();
    }
  }

  it('carries the Coursewright credit link', () => {
    const config = loadWithFooter({
      text: 'Copyright © {year}',
      license: null,
      credit: true,
    });
    assert.match(
      config.themeConfig.footer.copyright,
      /<a href="https:\/\/github\.com\/lars-derichter\/coursewright">Coursewright<\/a>/,
    );
  });

  it('prefixes the licence button with the baseUrl', () => {
    const config = loadWithFooter(
      { text: '', license: 'CC-BY-NC-SA-4.0', credit: false },
      { baseUrl: '/my-course/' },
    );
    assert.match(
      config.themeConfig.footer.copyright,
      /src="\/my-course\/img\/licenses\/by-nc-sa\.svg"/,
    );
  });

  it('leaves the footer out when every part is switched off', () => {
    const config = loadWithFooter({ text: '', license: null, credit: false });
    assert.equal(config.themeConfig.footer, undefined);
  });
});

describe('the deploy workflow', () => {
  const workflow = fs.readFileSync(WORKFLOW_PATH, 'utf-8');

  // The other half of the contract above: without these the site builds at
  // baseUrl '/' and every internal link 404s under the project path.
  it('passes the Pages address to the build', () => {
    assert.match(
      workflow,
      /CW_SITE_URL:\s*\$\{\{\s*steps\.pages\.outputs\.origin\s*\}\}/,
    );
    assert.match(
      workflow,
      /CW_BASE_URL:\s*\$\{\{\s*steps\.pages\.outputs\.base_path\s*\}\}\//,
    );
  });

  // configure-pages fails when Pages is not enabled. Tolerating that is what
  // keeps a course that never publishes from failing on every push.
  it('skips rather than fails when Pages is not enabled', () => {
    assert.match(workflow, /continue-on-error:\s*true/);
    assert.match(
      workflow,
      /if:\s*needs\.check\.outputs\.enabled\s*==\s*'true'/,
    );
  });

  // Cancelling a deployment mid-publish leaves the Pages site unpublished, and
  // every later run then reports success against a site that serves a 404.
  it('lets a running deployment finish', () => {
    assert.match(workflow, /cancel-in-progress:\s*false/);
  });
});
