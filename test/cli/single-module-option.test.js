const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const CLI = path.resolve(__dirname, '../../cli/index.js');

const made = [];
afterEach(() => {
  for (const dir of made.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * A throwaway project of three modules, each with a page, the first with a
 * glossary page and the glossary it is built from. Every command below runs in
 * a child process from here, because `COURSE_DIR` is resolved from the working
 * directory when `cli/module-utils.js` is first required: run in this process,
 * the commands would edit the repository's own course.
 */
function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'single-module-'));
  made.push(dir);
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    '{ "name": "fixture", "private": true }\n',
    'utf8',
  );
  for (const folder of ['01-intro', '02-html', '03-css-basics']) {
    fs.mkdirSync(path.join(dir, 'course', folder), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'course', folder, '01-welcome.md'),
      '---\ntitle: Welcome\n---\n\nBody\n',
      'utf8',
    );
  }
  fs.writeFileSync(
    path.join(dir, 'course', '01-intro', '02-glossary.md'),
    '---\ntitle: Glossary\n---\n\nstale body\n',
    'utf8',
  );
  fs.mkdirSync(path.join(dir, 'sources', 'reference-materials'), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(dir, 'sources', 'reference-materials', 'glossary.yml'),
    'terms:\n  - term: loop\n    lesson: 1\n    kind: concept\n    definition: A repeated block.\n',
    'utf8',
  );
  return dir;
}

function run(dir, args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: dir,
    input: '',
    encoding: 'utf8',
    timeout: 30000,
  });
}

function modulesIn(dir) {
  return fs.readdirSync(path.join(dir, 'course')).sort();
}

/**
 * Each command with a single-valued module option: how to call it with a given
 * selector, the number to call it with, and what that run should have done.
 */
const COMMANDS = [
  {
    name: 'move-module',
    args: (m) => ['move-module', '-m', m, '--position', '3'],
    number: '2',
    did: (dir) =>
      assert.deepEqual(modulesIn(dir), [
        '01-intro',
        '02-css-basics',
        '03-html',
      ]),
  },
  {
    name: 'rename-module',
    args: (m) => ['rename-module', '-m', m, '--name', 'Markup'],
    number: '2',
    did: (dir) =>
      assert.deepEqual(modulesIn(dir), [
        '01-intro',
        '02-markup',
        '03-css-basics',
      ]),
  },
  {
    name: 'delete-module',
    args: (m) => ['delete-module', '-m', m, '-y'],
    number: '3',
    did: (dir, out) => {
      assert.deepEqual(modulesIn(dir), ['01-intro', '02-html']);
      // A number never deletes silently: the line names the folder.
      assert.match(out.stdout, /\[delete-module\] Deleted 03-css-basics\//);
    },
  },
  {
    name: 'new-item',
    args: (m) => ['new-item', '-m', m, '--type', 'page', '--name', 'Lab'],
    number: '2',
    did: (dir) =>
      assert.ok(
        fs.existsSync(path.join(dir, 'course', '02-html', '02-lab.md')),
      ),
  },
  {
    name: 'movetomodule-item',
    args: (m) => [
      'movetomodule-item',
      '--path',
      'course/01-intro/01-welcome.md',
      '--to-module',
      m,
    ],
    number: '3',
    did: (dir) =>
      assert.ok(
        fs.existsSync(
          path.join(dir, 'course', '03-css-basics', '02-welcome.md'),
        ),
      ),
  },
  {
    name: 'build-glossary',
    args: (m) => ['build-glossary', '-m', m],
    number: '1',
    did: (dir, out) => {
      assert.match(out.stdout, /wrote 01-intro\/02-glossary\.md/);
      assert.match(
        fs.readFileSync(
          path.join(dir, 'course', '01-intro', '02-glossary.md'),
          'utf8',
        ),
        /A repeated block/,
      );
    },
  },
];

for (const command of COMMANDS) {
  describe(`npx course ${command.name} with a module number`, () => {
    it(`acts on the module a number names (${command.number})`, () => {
      const dir = project();
      const out = run(dir, command.args(command.number));
      assert.equal(out.status, 0, out.stderr);
      command.did(dir, out);
    });

    it('refuses a range that selects more than one module', () => {
      const dir = project();
      const before = modulesIn(dir);
      const out = run(dir, command.args('01-03'));
      assert.equal(out.status, 1);
      assert.match(
        out.stderr,
        /takes one module, but 01-03 selects 3: 01-intro, 02-html, 03-css-basics/,
      );
      assert.deepEqual(modulesIn(dir), before);
    });

    it('refuses a number no module has', () => {
      const dir = project();
      const out = run(dir, command.args('9'));
      assert.equal(out.status, 1);
      assert.match(out.stderr, /[Mm]odule not found: 9$/m);
    });
  });
}

// The message `docs/troubleshooting.md` quotes, under "no module named".
it('keeps the message an unknown full name always got', () => {
  const dir = project();
  const out = run(dir, [
    'new-item',
    '-m',
    '01-introduction',
    '--type',
    'page',
    '--name',
    'Lab',
  ]);
  assert.equal(out.status, 1);
  assert.match(
    out.stderr,
    /^\[new-item\] Error: Module not found: 01-introduction$/m,
  );
});

it('keeps the destination wording of movetomodule-item', () => {
  const dir = project();
  const out = run(dir, [
    'movetomodule-item',
    '--path',
    'course/01-intro/01-welcome.md',
    '--to-module',
    '09-nope',
  ]);
  assert.equal(out.status, 1);
  assert.match(
    out.stderr,
    /^\[movetomodule\] Error: Destination module not found: 09-nope$/m,
  );
});
