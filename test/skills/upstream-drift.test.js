const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCRIPT = path.join(
  __dirname,
  '..',
  '..',
  '.agents',
  'skills',
  'upstream-update',
  'scripts',
  'upstream-drift.js',
);
const tool = require(SCRIPT);

const CONF = `# Configuration for update-from-upstream.sh
protected_dirs = course evaluations sources   # trailing comment
protected_files = README.md update-from-upstream.conf

upstream_remote = upstream
upstream_branch = main
`;

describe('parseConf', () => {
  it('reads lists, scalars and strips comments', () => {
    const conf = tool.parseConf(CONF);
    assert.deepEqual(conf.protected_dirs, ['course', 'evaluations', 'sources']);
    assert.deepEqual(conf.protected_files, [
      'README.md',
      'update-from-upstream.conf',
    ]);
    assert.equal(conf.upstream_remote, 'upstream');
    assert.equal(conf.upstream_branch, 'main');
    assert.deepEqual(conf.warnings, []);
  });

  it('warns about unknown keys and malformed lines', () => {
    const conf = tool.parseConf('colour = blue\nthis is not a pair\n');
    assert.equal(conf.warnings.length, 2);
    assert.match(conf.warnings[0], /unknown config key 'colour'/);
    assert.match(conf.warnings[1], /malformed/);
  });
});

describe('isProtected', () => {
  const conf = tool.parseConf(CONF);

  it('matches protected files exactly and dirs by prefix', () => {
    assert.equal(tool.isProtected('README.md', conf), true);
    assert.equal(tool.isProtected('course/01-intro/page.md', conf), true);
    assert.equal(tool.isProtected('docs/README.md', conf), false);
    assert.equal(tool.isProtected('courseware.md', conf), false);
  });

  it('protects a protected dir that is a single tree entry', () => {
    // A submodule is one gitlink entry at the dir's own path, not files under it.
    assert.equal(tool.isProtected('sources', conf), true);
  });
});

describe('parseTree', () => {
  it('splits NUL-separated records and keeps paths with spaces', () => {
    const tree = tool.parseTree(
      ['100644 aaa\tdocs/a b.md', '120000 bbb\t.claude/skills', ''].join('\0'),
    );
    assert.equal(tree.get('docs/a b.md'), '100644 aaa');
    assert.equal(tree.get('.claude/skills'), '120000 bbb');
    assert.equal(tree.size, 2);
  });
});

describe('compareTrees', () => {
  const conf = tool.parseConf(CONF);
  const upstream = new Map([
    ['docs/a.md', '100644 aaa'],
    ['docs/new.md', '100644 nnn'],
    ['script.sh', '100755 sss'],
    ['lib/x.js', '100644 xxx'],
    ['README.md', '100644 up-readme'],
    ['course/01/page.md', '100644 up-page'],
  ]);
  const local = new Map([
    ['docs/a.md', '100644 aaa'],
    ['script.sh', '100644 sss'],
    ['lib/x.js', '100644 xx2'],
    ['old.md', '100644 ooo'],
    ['README.md', '100644 local-readme'],
    ['course/02/page.md', '100644 local-page'],
  ]);

  it('reports missing, stray and drifted outside the protected paths', () => {
    assert.deepEqual(tool.compareTrees(local, upstream, conf), {
      missing: ['docs/new.md'],
      stray: ['old.md'],
      drifted: ['lib/x.js', 'script.sh'],
    });
  });
});

describe('configGaps', () => {
  it('lists upstream protected entries the local conf lacks', () => {
    const local = tool.parseConf(CONF);
    const upstream = tool.parseConf(
      'protected_dirs = course sources\nprotected_files = README.md AGENTS.md\n',
    );
    assert.deepEqual(tool.configGaps(local, upstream), [
      'protected_files: AGENTS.md',
    ]);
  });
});

describe('formatReport', () => {
  const conf = tool.parseConf(CONF);

  it('says in sync when nothing is found', () => {
    const { text, total } = tool.formatReport(
      { missing: [], stray: [], drifted: [], gaps: [] },
      conf,
      'upstream/main (abc1234)',
    );
    assert.equal(total, 0);
    assert.match(text, /In sync with upstream\/main \(abc1234\)/);
  });

  it('lists only the sections with findings', () => {
    const { text, total } = tool.formatReport(
      { missing: [], stray: ['old.md'], drifted: ['a.js', 'b.js'], gaps: [] },
      conf,
      'x',
    );
    assert.equal(total, 3);
    assert.match(text, /^Stray \(1\)$/m);
    assert.match(text, /^Drifted \(2\)$/m);
    assert.doesNotMatch(text, /Missing locally/);
    assert.match(text, /3 finding\(s\)/);
  });
});

describe('the command, end to end', () => {
  let dir;

  const run = (...args) =>
    spawnSync(process.execPath, [SCRIPT, ...args], {
      cwd: dir,
      encoding: 'utf8',
    });
  const git = (...args) =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
  const write = (file, text) => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), text);
  };

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upstream-drift-'));
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
    git('config', 'commit.gpgsign', 'false');
    write('update-from-upstream.conf', CONF);
    write('docs/guide.md', 'upstream guide\n');
    write('course/01/page.md', 'upstream page\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'upstream');
    git('tag', 'up');
  });

  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('exits 0 when the trees match outside the protected paths', () => {
    write('course/01/page.md', 'local page\n');
    git('commit', '-q', '-am', 'local content');
    const res = run('--no-fetch', 'up');
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /In sync with up/);
  });

  it('exits 1 and names the drifted and stray files', () => {
    write('docs/guide.md', 'local edit\n');
    write('extra.md', 'local only\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'local drift');
    const res = run('--no-fetch', 'up');
    assert.equal(res.status, 1, res.stderr);
    assert.match(res.stdout, /Drifted \(1\)\n.*\n {4}docs\/guide\.md/);
    assert.match(res.stdout, /Stray \(1\)\n.*\n {4}extra\.md/);
  });
});
