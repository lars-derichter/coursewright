const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { resolveChecks } = require('../../cli/check');
const { _clearCache } = require('../../lib/config/course-config');

/** Run `fn` against a fresh project root, with the config cache clear. */
function withRoot(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'check-'));
  try {
    _clearCache();
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    _clearCache();
  }
}

describe('resolveChecks', () => {
  it('runs validate and check-links, skipping the glossary a course does not keep', () => {
    withRoot((root) => {
      const checks = resolveChecks({ root });
      assert.deepEqual(
        checks.map((check) => check.args ?? null),
        [['validate'], null, ['check-links']],
      );
      assert.equal(checks[1].label, 'glossary');
      assert.match(checks[1].skipped, /glossary\.yml/);
    });
  });

  it('checks glossary freshness when the default glossary file exists', () => {
    withRoot((root) => {
      const dir = path.join(root, 'sources', 'reference-materials');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'glossary.yml'), 'terms: []\n');
      const checks = resolveChecks({ root });
      assert.deepEqual(checks[1], {
        label: 'glossary',
        args: ['build-glossary', '--check'],
      });
    });
  });

  it('appends checks.extra after the built-in list, each split into argv', () => {
    withRoot((root) => {
      fs.writeFileSync(
        path.join(root, 'course.config.yml'),
        [
          'checks:',
          '  extra:',
          '    - build-games',
          '    - "check-links  --root docs"',
          '',
        ].join('\n'),
      );
      const checks = resolveChecks({ root });
      assert.equal(checks.length, 5);
      assert.deepEqual(checks.slice(3), [
        { label: 'build-games', args: ['build-games'] },
        {
          label: 'check-links --root docs',
          args: ['check-links', '--root', 'docs'],
        },
      ]);
    });
  });

  it('takes a config handed to it over the one on disk', () => {
    withRoot((root) => {
      fs.writeFileSync(
        path.join(root, 'course.config.yml'),
        'checks:\n  extra: [on-disk]\n',
      );
      const config = { checks: { extra: ['handed-in'] } };
      const checks = resolveChecks({ root, config });
      assert.deepEqual(checks.at(-1), {
        label: 'handed-in',
        args: ['handed-in'],
      });
    });
  });
});
