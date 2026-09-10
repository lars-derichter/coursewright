const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

/**
 * The heading a release section opens with: `## 1.3.0 (2026-09-08)`. The date
 * is not optional in this changelog, but it is not what identifies the
 * section either, so the pattern matches the version and lets the rest of the
 * line be whatever the entry says.
 */
function headingFor(version) {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^## ${escaped}(?:\\s|$)`);
}

function fail(message) {
  process.stderr.write(`changelog-section: ${message}\n`);
  process.exit(1);
}

/**
 * The body of one version's section, heading excluded: everything from its
 * heading to the next `## ` or the end of the file.
 *
 * Returns null when the file has no such heading, which is the case the
 * release workflow has to fail on rather than publish around: a release
 * whose notes are silently empty says less than no release at all.
 */
function sectionFor(changelog, version) {
  const lines = changelog.split('\n');
  const heading = headingFor(version);
  const start = lines.findIndex((line) => heading.test(line));
  if (start === -1) return null;

  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith('## '));
  const body = (end === -1 ? rest : rest.slice(0, end)).join('\n').trim();
  return body;
}

module.exports = { sectionFor };

// Run directly, this prints the section to stdout so a workflow can redirect
// it into a notes file. Required as a module, it exports the parser alone.
if (require.main === module) {
  const argument = process.argv[2];
  if (!argument) {
    fail(
      'no version given. Call this with the release version or its tag, ' +
        'as in `node scripts/changelog-section.js 1.3.0`.',
    );
  }

  // A tag is what the workflow has in hand, and the version is what the
  // changelog headings carry. Taking either saves every caller the strip.
  const version = argument.replace(/^v/, '');
  const file = path.join(ROOT, 'CHANGELOG.md');
  const body = sectionFor(fs.readFileSync(file, 'utf8'), version);

  if (body === null) {
    fail(
      `CHANGELOG.md has no "## ${version}" section. Step 1 of the release ` +
        'procedure renames `## Unreleased` to the version being released; ' +
        'this is what it looks like when that was missed. See ' +
        'docs/contributing.md#releasing.',
    );
  }
  if (body === '') {
    fail(`the "## ${version}" section in CHANGELOG.md is empty.`);
  }

  process.stdout.write(`${body}\n`);
}
