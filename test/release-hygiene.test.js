const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { sectionFor } = require('../scripts/changelog-section.js');

const ROOT = path.join(__dirname, '..');

/**
 * Every file that records the tooling's version, and the value each holds.
 *
 * The root manifest is what `npx course --version` prints and what an upstream
 * update carries into a course project. The lockfile repeats it twice, and
 * `npm version` keeps those in step while a hand edit does not. The extension
 * manifest is what VS Code shows next to Course Manager in the Extensions
 * view. Nothing ties the three together at build time, so a release can bump
 * one and leave a user reading two different numbers.
 */
function recordedVersions() {
  const read = (relative) =>
    JSON.parse(fs.readFileSync(path.join(ROOT, relative), 'utf8'));
  const lock = read('package-lock.json');
  return {
    'package.json': read('package.json').version,
    'package-lock.json (version)': lock.version,
    'package-lock.json (packages[""])': lock.packages[''].version,
    '.vscode/extensions/course-manager/package.json': read(
      '.vscode/extensions/course-manager/package.json',
    ).version,
  };
}

describe('a release', () => {
  it('carries one version number into every manifest', () => {
    // docs/contributing.md#releasing has the two `npm version` calls that keep
    // these equal. The failure lists every file with its value, so the one
    // that missed the bump is visible without opening them.
    const versions = recordedVersions();
    const distinct = new Set(Object.values(versions));
    assert.equal(
      distinct.size,
      1,
      `the manifests disagree about the version:\n${Object.entries(versions)
        .map(([file, version]) => `  ${file}: ${version}`)
        .join('\n')}`,
    );
  });

  it('records the version in the form a release tag is cut from', () => {
    // `v${version}` is the tag name, and `git describe --match 'v*'` in a
    // course project resolves against it, so a stray `v` prefix or a missing
    // patch number would make the tag and the manifest name different things.
    const { 'package.json': version } = recordedVersions();
    assert.match(
      version,
      /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/,
      `package.json version ${JSON.stringify(version)} is not MAJOR.MINOR.PATCH`,
    );
  });

  it('has a changelog section under the version it records', () => {
    // Step 1 of the release procedure renames `## Unreleased` to the version
    // being released, and `.github/workflows/release.yml` publishes that
    // section as the release notes. Miss the rename and the workflow fails
    // after the tag is already public, which is the expensive moment to find
    // out; this fails in `npm test`, before step 3 lets the release proceed.
    const { 'package.json': version } = recordedVersions();
    const changelog = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
    assert.notEqual(
      sectionFor(changelog, version),
      null,
      `CHANGELOG.md has no "## ${version}" section, and package.json says ` +
        `${version} is the version. See docs/contributing.md#releasing.`,
    );
  });
});
