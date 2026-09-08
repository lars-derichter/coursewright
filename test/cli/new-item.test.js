const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const matter = require('gray-matter');

const { _readPoints: readPoints } = require('../../cli/new-item');
const { POINTS_CASES, EMPTY_POINTS } = require('../helpers/points-cases');
const { seedPrettierConfig } = require('../helpers/prettier-config');

const CLI = path.join(__dirname, '..', '..', 'cli', 'index.js');

const made = [];

afterEach(() => {
  while (made.length) fs.rmSync(made.pop(), { recursive: true, force: true });
});

/**
 * A project root holding one empty module, which is everything `new-item`
 * needs: nothing here is synced, so no state file and no Canvas credentials
 * come into it.
 */
function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'new-item-'));
  made.push(dir);
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    '{ "name": "fixture", "private": true }\n',
    'utf8',
  );
  fs.mkdirSync(path.join(dir, 'course', '01-intro'), { recursive: true });
  return dir;
}

/** Run `npx course new-item` in `dir`, with no terminal to ask questions of. */
function newItem(dir, args) {
  return spawnSync(process.execPath, [CLI, 'new-item', ...args], {
    cwd: dir,
    input: '',
    encoding: 'utf8',
    // Every run below answers from flags. The timeout is what turns a
    // regression in that into a failure rather than a hung suite.
    timeout: 30000,
  });
}

/** Create one assignment called "Lab 1" and hand back what landed on disk. */
function assignment(dir, points) {
  const run = newItem(dir, [
    '--module',
    '01-intro',
    '--type',
    'assignment',
    '--name',
    'Lab 1',
    ...(points === undefined ? [] : ['--points', points]),
  ]);
  assert.equal(run.status, 0, run.stderr);
  return {
    run,
    raw: fs.readFileSync(
      path.join(dir, 'course', '01-intro', '01-lab-1.md'),
      'utf8',
    ),
  };
}

/**
 * Run `npx course new-item` with no flags at all and answer its questions as
 * they arrive, one `[question, answer]` pair per question in the order they are
 * asked. Resolves with everything the run printed.
 *
 * Each answer goes in only once its question has appeared on stdout. Writing
 * them all in at once does not work: readline hands a whole chunk out in one
 * synchronous pass, so every line after the first arrives before anything is
 * waiting for it and is dropped, and the run ends on "the input stream ended
 * before one arrived" (test/cli/init.test.js says the same thing about `init`).
 *
 * The timeout is what turns a question this list does not answer into a failure
 * that names the transcript, rather than a suite that hangs.
 */
function interactively(dir, answers, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, 'new-item', ...args], {
      cwd: dir,
    });
    let stdout = '';
    let stderr = '';
    let answered = 0;
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`new-item never finished asking:\n${stdout}`));
    }, 30000);

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      const asked = answers.filter(([q]) => stdout.includes(q)).length;
      while (answered < asked) {
        child.stdin.write(`${answers[answered][1]}\n`);
        answered += 1;
      }
      if (answered === answers.length) child.stdin.end();
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });

    child.on('error', reject);
    child.on('close', (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr });
    });
  });
}

/**
 * Answer the interactive run's four questions for an assignment called "Lab 1",
 * with `typed` as the points answer, and hand back what landed on disk.
 *
 * The module is auto-selected because the fixture holds exactly one, and it has
 * no subsections, so there is no question about where the item goes. The last
 * answer is empty on purpose: the offered position is the right one.
 */
async function typedAssignment(dir, typed, args = []) {
  const run = await interactively(
    dir,
    [
      ['Item type', 'assignment'],
      ['Item name', 'Lab 1'],
      ['Points possible', typed],
      ['Position', ''],
    ],
    args,
  );
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  return {
    run,
    data: matter(
      fs.readFileSync(
        path.join(dir, 'course', '01-intro', '01-lab-1.md'),
        'utf8',
      ),
    ).data,
  };
}

// ---------------------------------------------------------------------------

describe('readPoints', () => {
  // The value space `--points` can be handed lives in `test/helpers/
  // points-cases.js`, because the VS Code extension's input box holds a copy of
  // this rule and the two have to stay the same rule. `parseInt` used to be
  // this reader, and it read `abc` as NaN, `1.5` as 1 and `10abc` as 10, then
  // wrote that into the frontmatter as if the author had asked for it.
  for (const [input, expected] of POINTS_CASES) {
    it(`reads ${JSON.stringify(input)} as ${expected}`, () => {
      assert.equal(readPoints(input), expected);
    });
  }

  // An empty answer carries no number, so this reader says so and leaves the
  // fallback to its caller. The extension's box takes the same values as "the
  // 100 that was pre-filled", and both end at 100.
  for (const input of EMPTY_POINTS) {
    it(`reads ${JSON.stringify(input)} as nothing`, () => {
      assert.equal(readPoints(input), null);
    });
  }

  // Commander only ever hands over strings, and the interactive prompt only
  // ever hands over strings. These are the shapes a caller could still reach
  // this with, and none of them is a number of points either.
  it('reads a missing value as nothing', () => {
    assert.equal(readPoints(undefined), null);
    assert.equal(readPoints(null), null);
  });

  it('reads a number it is handed directly', () => {
    assert.equal(readPoints(25), 25);
    assert.equal(readPoints(2.5), 2.5);
  });
});

describe('npx course new-item --points', () => {
  it('never writes a NaN into an assignment', () => {
    // `parseInt('abc', 10)` is NaN, NaN is not null, and the YAML dump spells
    // NaN `.nan` — an assignment worth `.nan` points, on its way to Canvas.
    const dir = project();

    const { run, raw } = assignment(dir, 'abc');

    assert.ok(
      !raw.includes('.nan'),
      `points_possible: .nan reached the file:\n${raw}`,
    );
    assert.equal(matter(raw).data.points_possible, 100);
    assert.match(
      run.stdout,
      /"abc" is not a number of points .*Using 100\./,
      'a value the run did not use is worth a line: silently substituting the ' +
        'default is the same class of defect as silently substituting NaN',
    );
  });

  it('writes a fraction as the fraction that was asked for', () => {
    // Canvas takes a fractional `points_possible`, so this tool does too.
    // `parseInt('2.5', 10)` used to make it a 2 that looked exactly as
    // deliberate as a 2 the author had typed.
    const dir = project();

    const { run, raw } = assignment(dir, '2.5');

    assert.equal(matter(raw).data.points_possible, 2.5);
    assert.doesNotMatch(run.stdout, /is not a number of points/);
  });

  it('still refuses a decimal point with nothing on one side of it', () => {
    // `.5` is as easily a stray keystroke as it is a half, and `0.5` is right
    // there for anyone who means a half.
    const dir = project();

    const { run, raw } = assignment(dir, '.5');

    assert.equal(matter(raw).data.points_possible, 100);
    assert.match(run.stdout, /"\.5" is not a number of points/);
  });

  it('writes a negative through as the default rather than as points', () => {
    // Commander hands `-5` through as this flag's value rather than reading it
    // as a flag of its own, so it used to land in the frontmatter whole.
    const dir = project();

    const { raw } = assignment(dir, '-5');

    assert.equal(matter(raw).data.points_possible, 100);
  });

  it('keeps a zero, which is a real number of points', () => {
    // The guard that eats this is `|| 100`, and `lib/sync/canvas-write.js`
    // goes out of its way to send `points_possible: 0` rather than drop it.
    const dir = project();

    const { run, raw } = assignment(dir, '0');

    assert.equal(matter(raw).data.points_possible, 0);
    assert.doesNotMatch(run.stdout, /is not a number of points/);
  });

  it('leaves the default alone when the flag is not passed', () => {
    const dir = project();

    const { run, raw } = assignment(dir, undefined);

    assert.equal(matter(raw).data.points_possible, 100);
    assert.doesNotMatch(run.stdout, /is not a number of points/);
  });
});

describe('npx course new-item, answering the points question', () => {
  // The flag and the prompt read their answer with the same function, and only
  // the flag was covered. The prompt is where the change nobody asked about
  // lives: it used to read its answer with `parseInt(str, 10) || 100`, so a
  // typed 0 came back as 100 — the one input whose answer changes without
  // anything having been wrong with it.

  it('keeps a typed zero, which `|| 100` used to eat', async () => {
    const dir = project();

    const { run, data } = await typedAssignment(dir, '0');

    assert.equal(data.points_possible, 0);
    assert.doesNotMatch(run.stdout, /is not a number of points/);
  });

  it('takes a typed fraction the way the flag does', async () => {
    const dir = project();

    const { run, data } = await typedAssignment(dir, '2.5');

    assert.equal(data.points_possible, 2.5);
    assert.doesNotMatch(run.stdout, /is not a number of points/);
  });

  it('falls back out loud on an answer that is not a number', async () => {
    // Same fallback as the flag, and said in the same words: `parseInt` used to
    // turn this one into `points_possible: .nan` on its way to Canvas.
    const dir = project();

    const { run, data } = await typedAssignment(dir, 'abc');

    assert.equal(data.points_possible, 100);
    assert.match(run.stdout, /"abc" is not a number of points .*Using 100\./);
  });

  it('takes the offered 100 when the answer is just Enter', async () => {
    // The empty answer never reaches the reader: `prompt` substitutes the
    // default it offered, which is the same 100 the fallback would have used.
    const dir = project();

    const { run, data } = await typedAssignment(dir, '');

    assert.equal(data.points_possible, 100);
    assert.doesNotMatch(run.stdout, /is not a number of points/);
  });
});

describe('npx course new-item --points, with the questions still to answer', () => {
  // `--points` without `--module` and `--type` leaves the run interactive, and
  // the answer to the points question was already given on the command line.
  // The flag path read it and this one did not even look at it, so the value
  // went nowhere and nothing said so.

  it('offers the value from the flag as the answer to confirm', async () => {
    const dir = project();

    const { run, data } = await typedAssignment(dir, '', ['--points', '40']);

    assert.equal(data.points_possible, 40);
    assert.match(
      run.stdout,
      /Points possible \(40\)/,
      'the offered default is the value the author asked for',
    );
  });

  it('reads a fraction from the flag the same way the prompt does', async () => {
    const dir = project();

    const { data } = await typedAssignment(dir, '', ['--points', '2.50']);

    assert.equal(data.points_possible, 2.5);
  });

  it('falls back out loud on a flag value that is not a number', async () => {
    // Same reader, same sentence, same 100 as the flag-driven path: what is
    // offered at the prompt is what that path would have written.
    const dir = project();

    const { run, data } = await typedAssignment(dir, '', ['--points', 'abc']);

    assert.equal(data.points_possible, 100);
    assert.match(run.stdout, /"abc" is not a number of points .*Using 100\./);
    assert.match(run.stdout, /Points possible \(100\)/);
  });

  it('carries a zero from the flag through the prompt', async () => {
    // Two `||` fallbacks stand between this zero and the file — the one that
    // picks the offered default and the one `prompt` uses to read an empty
    // answer — and a zero is exactly what those eat.
    const dir = project();

    const { run, data } = await typedAssignment(dir, '', ['--points', '0']);

    assert.equal(data.points_possible, 0);
    assert.match(run.stdout, /Points possible \(0\)/);
  });

  it('lets a typed answer overrule the flag', async () => {
    const dir = project();

    const { data } = await typedAssignment(dir, '7', ['--points', '40']);

    assert.equal(data.points_possible, 7);
  });

  it('says the flag went unused on a type that has no points', async () => {
    // The other path's answer to the same situation, in the same words.
    const dir = project();

    const run = await interactively(
      dir,
      [
        ['Item type', 'page'],
        ['Item name', 'Notes'],
        ['Position', ''],
      ],
      ['--points', '40'],
    );
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);

    const { data } = matter(
      fs.readFileSync(
        path.join(dir, 'course', '01-intro', '01-notes.md'),
        'utf8',
      ),
    );
    assert.equal(data.points_possible, undefined);
    assert.match(run.stdout, /--points/);
    assert.match(run.stdout, /assignment/);
    assert.doesNotMatch(run.stdout, /Using 100/);
  });
});

describe('npx course new-item --points on a type that has none', () => {
  /** Create one page called "Notes" with `--points`, and read it back. */
  function page(dir, points) {
    const run = newItem(dir, [
      '--module',
      '01-intro',
      '--type',
      'page',
      '--name',
      'Notes',
      '--points',
      points,
    ]);
    assert.equal(run.status, 0, run.stderr);
    return {
      run,
      data: matter(
        fs.readFileSync(
          path.join(dir, 'course', '01-intro', '01-notes.md'),
          'utf8',
        ),
      ).data,
    };
  }

  it('writes no points, and does not claim a default was used', () => {
    // `--points` is read for every type and written for one: `createEntry`
    // puts `points_possible` in an assignment's frontmatter and nowhere else.
    // Reading it before the type is known meant an unusable value on a page
    // drew "Using 100." over a file that got no points at all — a line about a
    // fallback that never happened, which is worse than saying nothing.
    const dir = project();

    const { run, data } = page(dir, 'abc');

    assert.equal(data.points_possible, undefined);
    assert.doesNotMatch(
      run.stdout,
      /Using 100/,
      'nothing was written, so nothing defaulted',
    );
  });

  it('says the flag went unused rather than dropping it in silence', () => {
    // A perfectly good number, and still nothing to put it in. Silence here is
    // the same class of defect as silently substituting the default: the
    // author asked for something the run did not do, and only the run knows.
    const dir = project();

    const { run, data } = page(dir, '40');

    assert.equal(data.points_possible, undefined);
    assert.match(run.stdout, /--points/);
    assert.match(run.stdout, /assignment/);
  });
});

describe('npx course new-item, the bytes it leaves on disk', () => {
  it('writes the frontmatter block and stops there', () => {
    // Pinned byte for byte, because a file this tool writes has to be the file
    // `npm run format` would leave: anything else turns the author's very next
    // format run into an edit they did not make, and on a file sync tracks,
    // into a local change it pushes straight back. Two steps have to meet for
    // that to hold, and neither is visible from the other's side.
    // `serializeFrontmatter` pads a document with no body, and the Prettier run
    // inside `writeMarkdown` takes the padding off again, so what lands is the
    // closing fence and one newline.
    //
    // The repo's own Prettier configuration is copied in first: `resolveConfig`
    // finds nothing under `os.tmpdir()`, and a real course is formatted by a
    // configuration rather than by Prettier's defaults.
    const dir = seedPrettierConfig(project());

    const run = newItem(dir, [
      '--module',
      '01-intro',
      '--type',
      'page',
      '--name',
      'Notes',
    ]);
    assert.equal(run.status, 0, run.stderr);

    const raw = fs.readFileSync(
      path.join(dir, 'course', '01-intro', '01-notes.md'),
      'utf8',
    );
    assert.equal(raw, '---\ntitle: Notes\ncanvas_type: page\n---\n');
  });
});

describe('npx course new-item --type discussion', () => {
  /** Create one discussion called "Week 3 Reading", and read it back. */
  function discussion(dir) {
    const run = newItem(dir, [
      '--module',
      '01-intro',
      '--type',
      'discussion',
      '--name',
      'Week 3 Reading',
    ]);
    assert.equal(run.status, 0, run.stderr);
    return {
      run,
      file: matter(
        fs.readFileSync(
          path.join(dir, 'course', '01-intro', '01-week-3-reading.md'),
          'utf8',
        ),
      ),
    };
  }

  it('writes the type it was asked for, not the page it falls back to', () => {
    // The type chain in `createEntry` ends in an `else` that writes a page, so
    // a type listed in VALID_TYPES with no branch of its own scaffolds a page
    // under a discussion's name and says nothing about it. That is the failure
    // this pins: a wrong canvas_type reads as deliberate, and the first sign of
    // it is a push creating the wrong kind of Canvas object.
    const dir = project();

    const { file } = discussion(dir);

    assert.equal(file.data.canvas_type, 'discussion');
  });

  it('writes the two keys and nothing under them', () => {
    // A page's scaffold and a discussion's are the same shape on purpose:
    // `discussion_type`, `require_initial_post` and the two dates are optional
    // in Canvas, and a value nobody chose written into a new file reads exactly
    // like one that was. The body is empty for a related reason: the title is
    // the page heading in Canvas, in the preview site and in both exports, so
    // the `# Week 3 Reading` that used to sit here showed it twice and was the
    // first line an author deleted.
    const dir = project();

    const { file } = discussion(dir);

    assert.deepEqual(Object.keys(file.data), ['title', 'canvas_type']);
    assert.equal(file.data.title, 'Week 3 Reading');
    assert.equal(file.content, '');
  });

  it('takes no points, the way every non-assignment does', () => {
    const dir = project();
    const run = newItem(dir, [
      '--module',
      '01-intro',
      '--type',
      'discussion',
      '--name',
      'Week 3 Reading',
      '--points',
      '40',
    ]);

    assert.equal(run.status, 0, run.stderr);
    const { data } = matter(
      fs.readFileSync(
        path.join(dir, 'course', '01-intro', '01-week-3-reading.md'),
        'utf8',
      ),
    );
    assert.equal(data.points_possible, undefined);
    assert.match(run.stdout, /--points/);
  });
});
