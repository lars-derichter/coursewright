#!/usr/bin/env node
/**
 * Install the checked-in git hooks into .git/hooks.
 *
 * Copies scripts/pre-push to .git/hooks/pre-push and makes it executable, so
 * every `git push` runs `npx course check` first. Idempotent: re-run after
 * editing scripts/pre-push. Exits quietly when there is no git repository to
 * install into, such as a tarball checkout.
 *
 * Usage: npm run hooks:install
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function gitDir() {
  try {
    const out = execSync('git rev-parse --git-dir', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return path.resolve(out);
  } catch {
    return null;
  }
}

const dir = gitDir();
if (!dir) {
  console.error('hooks:install: not a git repository, nothing to do.');
  process.exit(0);
}

const hooksDir = path.join(dir, 'hooks');
fs.mkdirSync(hooksDir, { recursive: true });

const src = path.join(__dirname, 'pre-push');
const dest = path.join(hooksDir, 'pre-push');
fs.copyFileSync(src, dest);
fs.chmodSync(dest, 0o755);

console.log(`hooks:install: installed pre-push hook -> ${dest}`);
