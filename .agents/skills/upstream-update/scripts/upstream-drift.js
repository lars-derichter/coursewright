#!/usr/bin/env node
'use strict';

/**
 * Report how far a course repository has drifted from the upstream Coursewright
 * template. Read-only: it changes nothing, it only says what
 * update-from-upstream.sh left behind.
 *
 *   node .agents/skills/upstream-update/scripts/upstream-drift.js [--no-fetch] [<ref>]
 *
 * <ref> defaults to <upstream_remote>/<upstream_branch> from
 * update-from-upstream.conf, and the remote is fetched first unless --no-fetch
 * is given. The protected paths the same conf names are left out of every
 * comparison: local content there is authoritative by design, so a difference
 * is expected, not drift. Four sections are reported: files upstream has and
 * this repository lacks, files only this repository has, files on both sides
 * whose mode or content differs, and protected entries upstream's own conf
 * carries that the local one does not. Exits 1 on any finding, 0 when in sync.
 *
 * Trees are compared by mode and object hash from `git ls-tree`, not by reading
 * files, so symlinks, executable bits and type changes count, and nothing is
 * followed out of the repository. Node built-ins only: the skill folder has no
 * node_modules.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const CONF_NAME = 'update-from-upstream.conf';
const LIST_KEYS = ['protected_dirs', 'protected_files'];
const SCALAR_KEYS = ['upstream_remote', 'upstream_branch'];

/**
 * Parse update-from-upstream.conf the way update-from-upstream.sh does:
 * `key = value`, `#` starts a comment, lists are space-separated.
 * @returns {{ protected_dirs: string[], protected_files: string[],
 *   upstream_remote: string, upstream_branch: string, warnings: string[] }}
 */
function parseConf(text) {
  const conf = {
    protected_dirs: [],
    protected_files: [],
    upstream_remote: '',
    upstream_branch: '',
    warnings: [],
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '');
    if (!line.trim()) continue;
    const m = /^\s*([a-z_]+)\s*=\s*(.*)$/.exec(line);
    if (!m) {
      conf.warnings.push(`ignoring malformed config line: ${line.trim()}`);
      continue;
    }
    const [, key, value] = m;
    if (LIST_KEYS.includes(key)) {
      conf[key] = value.trim().split(/\s+/).filter(Boolean);
    } else if (SCALAR_KEYS.includes(key)) {
      conf[key] = value.trim();
    } else {
      conf.warnings.push(`unknown config key '${key}'`);
    }
  }
  return conf;
}

/**
 * True when `file` is a protected file, a protected dir itself (a submodule is
 * a single gitlink entry at the dir's path), or a path under a protected dir.
 */
function isProtected(file, conf) {
  if (conf.protected_files.includes(file)) return true;
  return conf.protected_dirs.some(
    (dir) => file === dir || file.startsWith(`${dir}/`),
  );
}

/**
 * Parse `git ls-tree -r -z --format='%(objectmode) %(objectname)%x09%(path)'`
 * output into a Map of path to "mode hash".
 */
function parseTree(output) {
  const tree = new Map();
  for (const record of output.split('\0')) {
    if (!record) continue;
    const tab = record.indexOf('\t');
    tree.set(record.slice(tab + 1), record.slice(0, tab));
  }
  return tree;
}

/** The tree of `ref` in the repository at `cwd`, as parseTree returns it. */
function listTree(ref, cwd) {
  const out = execFileSync(
    'git',
    [
      'ls-tree',
      '-r',
      '-z',
      '--format=%(objectmode) %(objectname)%x09%(path)',
      ref,
    ],
    { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
  );
  return parseTree(out);
}

/**
 * Compare two trees, leaving out the protected paths.
 * @returns {{ missing: string[], stray: string[], drifted: string[] }}
 */
function compareTrees(local, upstream, conf) {
  const missing = [];
  const stray = [];
  const drifted = [];
  for (const [file, entry] of upstream) {
    if (isProtected(file, conf)) continue;
    if (!local.has(file)) missing.push(file);
    else if (local.get(file) !== entry) drifted.push(file);
  }
  for (const file of local.keys()) {
    if (!isProtected(file, conf) && !upstream.has(file)) stray.push(file);
  }
  return {
    missing: missing.sort(),
    stray: stray.sort(),
    drifted: drifted.sort(),
  };
}

/**
 * The protected entries upstream's own conf lists that the local conf lacks:
 * a local conf that predates them leaves those paths unprotected silently.
 * @returns {string[]} lines of the form "protected_dirs: name"
 */
function configGaps(localConf, upstreamConf) {
  const gaps = [];
  for (const key of LIST_KEYS) {
    for (const entry of upstreamConf[key]) {
      if (!localConf[key].includes(entry)) gaps.push(`${key}: ${entry}`);
    }
  }
  return gaps;
}

const SECTIONS = [
  ['missing', 'Missing locally', 'upstream has these, this repo does not'],
  [
    'stray',
    'Stray',
    'this repo has these, upstream does not; candidates for STALE_PATHS',
  ],
  ['drifted', 'Drifted', 'present on both sides with different content'],
  ['gaps', 'Config gaps', `upstream protects these, ${CONF_NAME} does not`],
];

/** Render the findings; returns the report text and the finding count. */
function formatReport(findings, conf, refLabel) {
  const lines = [];
  let total = 0;
  for (const [key, title, hint] of SECTIONS) {
    const items = findings[key];
    if (!items.length) continue;
    total += items.length;
    lines.push(`${title} (${items.length})`, `  ${hint}`);
    for (const item of items) lines.push(`    ${item}`);
    lines.push('');
  }
  if (total === 0) {
    lines.push(`In sync with ${refLabel}. Nothing to report.`);
  } else {
    lines.push(
      `${total} finding(s). Protected paths were not compared:`,
      `  dirs:  ${conf.protected_dirs.join(' ') || 'none'}`,
      `  files: ${conf.protected_files.join(' ') || 'none'}`,
    );
  }
  return { text: lines.join('\n'), total };
}

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function main(argv, cwd) {
  const args = argv.filter((a) => a !== '--no-fetch');
  const fetch = args.length === argv.length;

  const root = git(['rev-parse', '--show-toplevel'], cwd);
  const confPath = path.join(root, CONF_NAME);
  if (!fs.existsSync(confPath)) {
    console.error(
      `Error: ${CONF_NAME} not found. Run update-from-upstream.sh once to create it.`,
    );
    return 2;
  }
  const conf = parseConf(fs.readFileSync(confPath, 'utf8'));
  for (const w of conf.warnings) console.error(`Warning: ${w} in ${CONF_NAME}`);

  let ref = args[0];
  if (!ref) {
    if (!conf.upstream_remote || !conf.upstream_branch) {
      console.error(
        `Error: ${CONF_NAME} must set upstream_remote and upstream_branch.`,
      );
      return 2;
    }
    ref = `${conf.upstream_remote}/${conf.upstream_branch}`;
    if (fetch) {
      console.log(`Fetching ${conf.upstream_remote}...`);
      execFileSync('git', ['fetch', '--quiet', conf.upstream_remote], {
        cwd: root,
        stdio: 'inherit',
      });
    }
  }

  const refLabel = `${ref} (${git(['rev-parse', '--short', ref], root)})`;
  console.log(`Comparing against ${refLabel}\n`);

  const findings = compareTrees(
    listTree('HEAD', root),
    listTree(ref, root),
    conf,
  );
  let upstreamConfText = '';
  try {
    upstreamConfText = git(['show', `${ref}:${CONF_NAME}`], root);
  } catch {
    // An upstream without a conf has nothing to compare against.
  }
  findings.gaps = upstreamConfText
    ? configGaps(conf, parseConf(upstreamConfText))
    : [];

  const { text, total } = formatReport(findings, conf, refLabel);
  console.log(text);
  return total === 0 ? 0 : 1;
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2), process.cwd());
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exitCode = 2;
  }
}

module.exports = {
  parseConf,
  isProtected,
  parseTree,
  listTree,
  compareTrees,
  configGaps,
  formatReport,
  main,
};
