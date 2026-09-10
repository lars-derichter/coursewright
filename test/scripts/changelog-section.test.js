const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { sectionFor } = require('../../scripts/changelog-section.js');

const CHANGELOG = [
  '# Changelog',
  '',
  '## Unreleased',
  '',
  '- Something not yet released.',
  '',
  '## 1.3.0 (2026-09-08)',
  '',
  '- The newest released thing.',
  '',
  '- A second entry.',
  '',
  '## 1.2.1 (2026-09-08)',
  '',
  '- An older thing.',
  '',
  '## 1.2 (2026-09-07)',
  '',
  '- A version whose number is a prefix of the one above.',
  '',
  '## 1.0.0 (2026-08-30)',
  '',
  '- The first release.',
  '',
].join('\n');

describe('the changelog section a release is published from', () => {
  it('is the body of the matching heading, heading excluded', () => {
    assert.equal(
      sectionFor(CHANGELOG, '1.3.0'),
      '- The newest released thing.\n\n- A second entry.',
    );
  });

  it('stops at the next version heading', () => {
    assert.equal(sectionFor(CHANGELOG, '1.2.1'), '- An older thing.');
  });

  it('runs to the end of the file for the last section', () => {
    assert.equal(sectionFor(CHANGELOG, '1.0.0'), '- The first release.');
  });

  it('matches the whole version number, not a prefix of it', () => {
    // `1.2` and `1.2.1` are different releases, and a pattern anchored on the
    // digits alone would hand the notes of one to the other.
    assert.equal(
      sectionFor(CHANGELOG, '1.2'),
      '- A version whose number is a prefix of the one above.',
    );
  });

  it('finds a section by a name that is not a version number', () => {
    assert.equal(
      sectionFor(CHANGELOG, 'Unreleased'),
      '- Something not yet released.',
    );
  });

  it('is null when the version has no section', () => {
    // The release workflow fails on this rather than publishing empty notes.
    assert.equal(sectionFor(CHANGELOG, '9.9.9'), null);
  });

  it('is empty rather than null for a heading with nothing under it', () => {
    // A distinct outcome from a missing heading, so the failure can say which
    // of the two happened.
    assert.equal(
      sectionFor('## 1.4.0 (2026-09-10)\n\n## 1.3.0\n', '1.4.0'),
      '',
    );
  });

  it('takes a prerelease version', () => {
    assert.equal(
      sectionFor(
        '## 1.4.0-rc.1 (2026-09-10)\n\n- A candidate.\n',
        '1.4.0-rc.1',
      ),
      '- A candidate.',
    );
  });
});
