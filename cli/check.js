const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const log = require('./logger');
const { PROJECT_ROOT } = require('./project-root');
const { loadCourseConfig } = require('../lib/config/course-config');
const { DEFAULT_GLOSSARY_PATH } = require('./build-glossary');

/**
 * The checks a push should pass, as argv lists for `cli/index.js`, in the order
 * they run. The built-in three come first: `validate`; `build-glossary --check`
 * when the course keeps a glossary at the default path, and a skip naming the
 * missing file when it does not, because the glossary command exits non-zero
 * without one and would fail every course that has none; then `check-links`.
 * Whatever `checks.extra` in course.config.yml names follows, each entry split
 * on whitespace into a subcommand and its flags. No shell is involved, so an
 * entry is a course-local `npx course` command and nothing more, and one the
 * CLI does not know fails the run the way a typo should.
 *
 * Reads the filesystem for the glossary and nothing else, so a test can hand
 * it a root and a config.
 *
 * @param {object} [options]
 * @param {string} [options.root] - Project root (default: PROJECT_ROOT).
 * @param {object} [options.config] - Resolved course config (default: the one
 *   under `root`).
 * @returns {Array<{ label: string, args?: string[], skipped?: string }>}
 */
function resolveChecks({
  root = PROJECT_ROOT,
  config = loadCourseConfig(root),
} = {}) {
  const checks = [{ label: 'validate', args: ['validate'] }];

  if (fs.existsSync(path.join(root, DEFAULT_GLOSSARY_PATH))) {
    checks.push({ label: 'glossary', args: ['build-glossary', '--check'] });
  } else {
    checks.push({ label: 'glossary', skipped: `no ${DEFAULT_GLOSSARY_PATH}` });
  }

  checks.push({ label: 'links', args: ['check-links'] });

  for (const entry of config.checks.extra) {
    const args = entry.split(/\s+/).filter(Boolean);
    checks.push({ label: args.join(' '), args });
  }

  return checks;
}

/**
 * Run every pre-ship check and exit non-zero if any failed. Each runs as a
 * subprocess of cli/index.js, so a check that calls process.exit() ends itself
 * and not the run: every check runs, and the summary names the ones that
 * failed.
 */
async function checkCommand() {
  const cliEntry = path.join(PROJECT_ROOT, 'cli', 'index.js');
  const failed = [];

  for (const check of resolveChecks()) {
    if (check.skipped) {
      log.info(`\n[check] ${check.label}: skipped (${check.skipped})`);
      continue;
    }
    log.info(`\n[check] ${check.args.join(' ')}`);
    const result = spawnSync(process.execPath, [cliEntry, ...check.args], {
      cwd: PROJECT_ROOT,
      stdio: 'inherit',
    });
    if (result.status !== 0) failed.push(check.label);
  }

  if (failed.length) {
    log.error(`\n[check] FAILED: ${failed.join(', ')}`);
    process.exit(1);
  }

  log.info('\n[check] All checks passed.');
}

module.exports = checkCommand;
module.exports.resolveChecks = resolveChecks;
