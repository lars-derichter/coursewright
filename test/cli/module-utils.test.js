const { describe, it, mock, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  EOF,
  MAX_SLUG_LENGTH,
  UnanswerableError,
  ask,
  createRL,
  moduleCandidates,
  prompt,
  resolveModuleFilter,
  resolveModuleSelectors,
  toSlug,
  truncateSlug,
} = require('../../cli/module-utils');
const { _promptPosition: promptPosition } = require('../../cli/new-item');

const CLI_INDEX = path.join(__dirname, '..', '..', 'cli', 'index.js');
const INIT_SOURCE = path.join(__dirname, '..', '..', 'cli', 'init.js');

// A question that never settles used to leave the run at exit 0. Anything here
// that sets a non-zero code has to put it back, or a suite where every test
// passed still fails.
beforeEach(() => {
  process.exitCode = 0;
});
afterEach(() => {
  process.exitCode = 0;
});

/**
 * The cap exists because a Canvas title is not a filename. A text header whose
 * title is a whole instruction sentence produced a folder name of nearly 200
 * characters, and two of those nested under `course/` put a real course past
 * Windows' 260-character `MAX_PATH` — where the failure is not a warning but
 * `git clone` refusing to create the directory, so the repository could not be
 * checked out on Windows at all.
 */
describe('toSlug length cap', () => {
  const sentence =
    'Put an overview of every evaluation that counts towards the final mark ' +
    'here, with the date and the percentage, ready for the first lesson';

  it('leaves a name inside the cap exactly as it was', () => {
    assert.equal(toSlug('My New Module'), 'my-new-module');
    assert.equal(truncateSlug('short-enough'), 'short-enough');
  });

  it('caps a title that is really a sentence', () => {
    const slug = toSlug(sentence);
    assert.ok(
      slug.length <= MAX_SLUG_LENGTH,
      `expected at most ${MAX_SLUG_LENGTH} characters, got ${slug.length}`,
    );
  });

  it('cuts on a word boundary, so what survives still reads', () => {
    assert.equal(
      toSlug(sentence),
      'put-an-overview-of-every-evaluation-that-counts-towards-the',
    );
  });

  it('leaves no trailing hyphen when the cut lands on one', () => {
    // The 60th character is the hyphen after `aaa`, so the naive cut keeps it.
    const slug = truncateSlug(`${'a'.repeat(56)}-bbbb-cccc`);
    assert.equal(slug, 'a'.repeat(56));
    assert.doesNotMatch(slug, /-$/);
  });

  it('cuts through a first word that is longer than the cap', () => {
    const slug = toSlug('a'.repeat(200));
    assert.equal(slug.length, MAX_SLUG_LENGTH);
    assert.equal(slug, 'a'.repeat(MAX_SLUG_LENGTH));
  });

  it('still yields a usable slug for a name that is all punctuation', () => {
    assert.equal(toSlug('--- ... ---'), '');
  });
});

describe('resolveModuleSelectors', () => {
  // 04 is missing on purpose, for the range-with-a-gap case.
  const folders = [
    '01-intro',
    '02-html',
    '03-css-basics',
    '05-layout',
    '06-forms',
  ];
  const resolve = (selectors, options) =>
    resolveModuleSelectors(selectors, folders, options);

  it('takes a two-digit number', () => {
    assert.deepEqual(resolve(['03']), ['03-css-basics']);
  });

  it('takes a number without its leading zero', () => {
    assert.deepEqual(resolve(['3']), ['03-css-basics']);
  });

  it('skips a gap in a range quietly', () => {
    assert.deepEqual(resolve(['03-06']), [
      '03-css-basics',
      '05-layout',
      '06-forms',
    ]);
  });

  it('splits a value on commas', () => {
    assert.deepEqual(resolve(['01,05']), ['01-intro', '05-layout']);
  });

  it('mixes numbers, ranges and full names across values', () => {
    assert.deepEqual(resolve(['06', '01-02,03-css-basics']), [
      '01-intro',
      '02-html',
      '03-css-basics',
      '06-forms',
    ]);
  });

  it('names each module once however often it was selected', () => {
    assert.deepEqual(resolve(['03', '3', '02-03', '03-css-basics']), [
      '02-html',
      '03-css-basics',
    ]);
  });

  it('returns course order whatever order they were typed in', () => {
    assert.deepEqual(resolve(['06', '01', '03']), [
      '01-intro',
      '03-css-basics',
      '06-forms',
    ]);
  });

  it('accepts a single string as well as an array', () => {
    assert.deepEqual(resolve('02'), ['02-html']);
  });

  it('tries the exact folder name before reading a range', () => {
    const odd = ['01-intro', '02-html', '03-05', '04-js'];
    assert.deepEqual(resolveModuleSelectors(['03-05'], odd), ['03-05']);
  });

  it('names an unknown number', () => {
    assert.throws(() => resolve(['04']), /Module not found: 04/);
  });

  it('names an unknown folder name', () => {
    assert.throws(() => resolve(['03-css']), /Module not found: 03-css/);
  });

  it('names the unknown token, not the whole value', () => {
    assert.throws(() => resolve(['01,09']), /Module not found: 09$/);
  });

  it('says a path is not a module, since -m swallows what follows it', () => {
    assert.throws(
      () => resolve(['02', 'course/01-intro/01-welcome.md']),
      /Not a module: course\/01-intro\/01-welcome\.md\. -m takes modules only/,
    );
  });

  it('refuses a range that matches nothing', () => {
    assert.throws(() => resolve(['10-12']), /No module in range 10-12/);
  });

  it('refuses a range that runs backwards', () => {
    assert.throws(() => resolve(['05-03']), /runs backwards/);
  });

  it('names both folders behind an ambiguous number', () => {
    const twice = ['01-intro', '03-css', '03-js'];
    assert.throws(
      () => resolveModuleSelectors(['03'], twice),
      /ambiguous.*03-css, 03-js/,
    );
  });

  it('takes every folder in a range, two sharing a number included', () => {
    const twice = ['01-intro', '03-css', '03-js', '04-forms'];
    assert.deepEqual(resolveModuleSelectors(['02-03'], twice), [
      '03-css',
      '03-js',
    ]);
  });

  it('refuses an empty selection', () => {
    assert.throws(() => resolve([' , ']), /No module given/);
  });

  describe('with single', () => {
    it('refuses a range that selects more than one module', () => {
      assert.throws(
        () => resolve(['01-03'], { single: true }),
        /takes one module.*01-intro, 02-html, 03-css-basics/,
      );
    });

    it('refuses a list that selects more than one module', () => {
      assert.throws(() => resolve(['01,02'], { single: true }), /one module/);
    });

    it('accepts a number', () => {
      assert.deepEqual(resolve(['5'], { single: true }), ['05-layout']);
    });

    it('accepts a full folder name', () => {
      assert.deepEqual(resolve(['06-forms'], { single: true }), ['06-forms']);
    });

    it('accepts a range that yields one module', () => {
      assert.deepEqual(resolve(['04-05'], { single: true }), ['05-layout']);
    });
  });
});

describe('resolveModuleSelectors with passUnknownNames', () => {
  const folders = ['01-intro', '02-html', '03-css-basics'];
  const resolve = (selectors) =>
    resolveModuleSelectors(selectors, folders, { passUnknownNames: true });

  it('hands an unknown name back, after the matches, as it was typed', () => {
    assert.deepEqual(resolve(['99-nope', '02', '98-also-nope', '99-nope']), [
      '02-html',
      '99-nope',
      '98-also-nope',
    ]);
  });

  it('still refuses a number that matches nothing', () => {
    assert.throws(() => resolve(['09']), /Module not found: 09/);
  });

  it('still refuses a range that matches nothing', () => {
    assert.throws(() => resolve(['07-09']), /No module in range 07-09/);
  });

  it('still says a path is not a module', () => {
    assert.throws(() => resolve(['course/01-intro']), /Not a module/);
  });
});

describe('moduleCandidates', () => {
  const local = (...folders) => ({
    modules: folders.map((folder) => ({ folder })),
  });
  const state = (entries) => ({ modules: entries });

  it('takes a folder only the tree has', () => {
    assert.deepEqual(
      moduleCandidates({ local: local('01-intro'), state: state({}) }),
      ['01-intro'],
    );
  });

  it('takes a folder only the sync state has', () => {
    assert.deepEqual(
      moduleCandidates({
        local: local(),
        state: state({ '03-deleted': { canvas_module_id: 30 } }),
      }),
      ['03-deleted'],
    );
  });

  it('merges both, local first, each once', () => {
    assert.deepEqual(
      moduleCandidates({
        local: local('01-intro', '02-html'),
        state: state({
          '02-html': { canvas_module_id: 20 },
          '03-deleted': { canvas_module_id: 30 },
        }),
      }),
      ['01-intro', '02-html', '03-deleted'],
    );
  });

  it('takes the folder a Canvas module the state does not know would get', () => {
    assert.deepEqual(
      moduleCandidates({
        local: local('01-intro'),
        state: state({ '01-intro': { canvas_module_id: 10 } }),
        canvas: {
          modules: [
            { canvasModuleId: 10, suggestedFolder: '01-intro' },
            { canvasModuleId: 40, suggestedFolder: '04-new-in-canvas' },
          ],
        },
      }),
      ['01-intro', '04-new-in-canvas'],
    );
  });

  it('leaves out a tracked Canvas module renamed in Canvas', () => {
    // Its suggested folder is the new name; listed beside the state's folder,
    // it would make `-m 01` ambiguous for a module that is only one.
    assert.deepEqual(
      moduleCandidates({
        local: local('01-intro'),
        state: state({ '01-intro': { canvas_module_id: 10 } }),
        canvas: {
          modules: [{ canvasModuleId: 10, suggestedFolder: '01-welcome' }],
        },
      }),
      ['01-intro'],
    );
  });
});

describe('resolveModuleFilter', () => {
  const sides = {
    local: { modules: [{ folder: '01-intro' }] },
    state: { modules: { '03-deleted': { canvas_module_id: 30 } } },
  };

  it('is null without -m, so the planner reads the whole course', () => {
    assert.equal(resolveModuleFilter(undefined, sides), null);
  });

  it('leaves an -m given nothing empty, as it always was', () => {
    assert.deepEqual(resolveModuleFilter([''], sides), []);
  });

  it('resolves a number against the state as well as the tree', () => {
    assert.deepEqual(resolveModuleFilter(['3', '01'], sides), [
      '01-intro',
      '03-deleted',
    ]);
  });

  it('passes an unknown name on for the command to refuse', () => {
    assert.deepEqual(resolveModuleFilter('99-nope', sides), ['99-nope']);
  });
});

describe('prompt', () => {
  it('refuses an input stream that ends without an answer', async () => {
    const answer = await withStdin('', () =>
      within(prompt(createRL(), 'Module name')),
    );
    assert.notEqual(
      answer,
      HUNG,
      'rl.question never fires its callback at EOF, so a prompt that waits ' +
        'only for one leaves the command hanging on a question nothing will ' +
        'ever answer',
    );
    assert.equal(answer, THREW);
  });

  it('still takes a piped answer', async () => {
    const answer = await withStdin('Intro\n', () =>
      within(prompt(createRL(), 'Module name')),
    );
    assert.equal(
      answer,
      'Intro',
      'piping the answers in has no terminal either and is a legitimate way ' +
        'to script this, so failing on EOF must not fail on that',
    );
  });

  it('still falls back to the default on an empty line', async () => {
    const answer = await withStdin('\n', () =>
      within(prompt(createRL(), 'Position number', '02')),
    );
    assert.equal(answer, '02');
  });

  it('does not let a default stand in for an answer that never came', async () => {
    // delete-item asks `Delete x? (y/N)` with 'N' as the default, which reads
    // like a safe fallback for a run that cannot answer. It is not one: the
    // default fires on an empty line, and EOF is the absence of a line.
    const answer = await withStdin('', () =>
      within(prompt(createRL(), 'Delete 03-page.md? (y/N)', 'N')),
    );
    assert.equal(
      answer,
      THREW,
      'a default that fires only on an empty line leaves EOF unhandled',
    );
  });

  it('refuses a question asked after the stream already ended', async () => {
    // What a second question meets when the whole pipe arrived in one chunk:
    // readline hands out the first line, emits the rest with nobody listening,
    // and closes. `rl.question` then throws ERR_USE_AFTER_CLOSE rather than
    // hanging, which is the same ended stream and must not escape as a stack.
    const outcome = await withStdin('one\ntwo\n', async () => {
      const rl = createRL();
      await within(prompt(rl, 'First'));
      return within(prompt(rl, 'Second'));
    });
    assert.notEqual(outcome, HUNG);
    assert.equal(outcome, THREW);
  });

  it('names the command and the flags that skip the questions', async () => {
    const error = await withStdin('', () =>
      within(
        caught(
          prompt(
            createRL({ command: 'new-item', flags: '--module and --type' }),
            'Item type',
          ),
        ),
      ),
    );
    assert.ok(error instanceof UnanswerableError);
    assert.match(error.message, /^\[new-item\] Error:/);
    assert.match(error.message, /"Item type"/);
    assert.match(
      error.message,
      /npx course new-item` in a terminal/,
      'a scripted run needs to be told the one thing that always works',
    );
    assert.match(
      error.message,
      /--module and --type/,
      'and the flags that make it scriptable, where the command has them',
    );
  });

  it('still says what to do for a command with no flags to offer', async () => {
    const error = await withStdin('', () =>
      within(caught(prompt(createRL({ command: 'init' }), 'Canvas URL'))),
    );
    assert.match(error.message, /^\[init\] Error:/);
    assert.match(error.message, /npx course init` in a terminal\./);
    assert.doesNotMatch(
      error.message,
      /flags/,
      'init takes no flags at all, so offering some would be a lie',
    );
  });

  it('takes its close listener off again once a question is answered', async () => {
    // Every question adds a 'close' hook, and a command asking a dozen of them
    // on one interface would trip Node's leak warning if they were never taken
    // off again. The stream has to still be open to see it: once it closes, the
    // hook fires and `once` removes it whether or not anything else would have.
    await withOpenStdin(async (stdin) => {
      const rl = createRL();
      // readline keeps one of its own, so the count that matters is the delta.
      const baseline = rl.listenerCount('close');
      const answered = prompt(rl, 'First');
      assert.equal(
        rl.listenerCount('close'),
        baseline + 1,
        'a pending question is exactly what the hook is for',
      );
      stdin.write('a\n');
      assert.equal(await within(answered), 'a');
      assert.equal(
        rl.listenerCount('close'),
        baseline,
        'an answered question leaves nothing behind, or the tenth question a ' +
          "command asks trips Node's leak warning",
      );
      rl.close();
    });
  });
});

describe('ask', () => {
  it('reports the end of the stream instead of throwing', async () => {
    // What `confirm` in backup-warning.js reads, because cancelling is a safe
    // answer to a destructive question and refusing to run is not.
    const answer = await withStdin('', () => within(ask(createRL(), 'Sure?')));
    assert.notEqual(answer, HUNG);
    assert.equal(answer, EOF);
  });
});

describe('promptPosition', () => {
  it('leaves its retry loop when the answers run out', async () => {
    // The loop re-asks until the answer parses as 1-99. An EOF that resolved to
    // an empty string instead of throwing would spin it forever, printing its
    // own complaint — strictly worse than the hang it replaced.
    //
    // The cap is what keeps that from spinning this suite too: a loop with no
    // exit starves the event loop, so `within`'s timer would never get to fire.
    // Throwing from the complaint itself unwinds the loop instead, and the test
    // fails with a description rather than stopping the run.
    let complaints = 0;
    const spy = mock.method(console, 'log', (...args) => {
      if (!String(args[0]).includes('Position must be a number')) return;
      complaints++;
      if (complaints > 3) {
        throw new Error(
          'promptPosition kept re-asking after the input stream ended',
        );
      }
    });
    try {
      const outcome = await withStdin('abc\n', () =>
        within(promptPosition(createRL(), [])),
      );
      assert.notEqual(outcome, HUNG, 'the loop has to end without a terminal');
      assert.equal(outcome, THREW);
      assert.equal(complaints, 1, 'one bad answer, one complaint, then out');
    } finally {
      spy.mock.restore();
    }
  });
});

describe('cli/init.js', () => {
  it('takes its prompt from module-utils rather than carrying its own', () => {
    // init used to define a private copy of `prompt`, so fixing the shared one
    // left init hanging. Read as source: calling init() would read the real
    // .env and write over it.
    const source = fs.readFileSync(INIT_SOURCE, 'utf8');
    assert.doesNotMatch(
      source,
      /^function prompt\(/m,
      'a second copy of prompt is a second copy of this defect',
    );
    assert.match(source, /require\('\.\/module-utils'\)/);
    assert.match(source, /createRL\(\{ command: 'init' \}\)/);
  });
});

describe('the CLI on an input stream that cannot answer', () => {
  it('exits non-zero and says what to do', () => {
    // The one end-to-end check, because the exit code is the whole point and no
    // unit test can see it: the throw is caught in cli/index.js. new-module
    // reads course/ and writes nothing before its first question.
    const run = spawnSync(process.execPath, [CLI_INDEX, 'new-module'], {
      input: '',
      encoding: 'utf8',
      timeout: 30000,
    });

    assert.equal(
      run.status,
      1,
      'a run that answered nothing reporting success is the defect itself',
    );
    assert.match(run.stderr, /\[new-module\] Error:/);
    assert.match(run.stderr, /in a terminal, or pass --name/);

    // Exit 1 on its own does not prove the message was handled: an unawaited
    // rejection also exits 1, and prints the same sentence buried in a stack
    // dump. What is being pinned is the clean line.
    assert.doesNotMatch(
      run.stderr,
      /UnanswerableError|\n\s+at /,
      'the author of a scripted run gets one line, not a stack trace',
    );
    assert.equal(run.stderr.trim().split('\n').length, 1);
  });
});

/** Returned in place of a promise that never settled. */
const HUNG = Symbol('hung');

/** Returned in place of a promise that rejected with an UnanswerableError. */
const THREW = Symbol('threw');

/**
 * Resolve to HUNG when `promise` has not settled shortly, and to THREW when it
 * refused, so neither a hung nor a failed question can take the run with it.
 *
 * A plain await would be worse than no test at all here: the suite would stop
 * dead on the first hung prompt, and `withStdin` would never reach its restore,
 * leaving every test after it running against a stdin that is not stdin.
 *
 * The timer is deliberately not unref'd. A hung prompt leaves nothing else
 * keeping the loop alive — that is the defect, a run that exits 0 with the
 * question still on screen — so an unref'd timer would let the process exit
 * before the test could fail.
 */
function within(promise, ms = 2000) {
  let timer;
  const expiry = new Promise((resolve) => {
    timer = setTimeout(() => resolve(HUNG), ms);
  });
  return Promise.race([
    Promise.resolve(promise).catch((err) => {
      if (err instanceof UnanswerableError) return THREW;
      throw err;
    }),
    expiry,
  ]).finally(() => clearTimeout(timer));
}

/** The rejection itself, for the tests that read the message. */
function caught(promise) {
  return promise.then(
    (value) => value,
    (err) => err,
  );
}

/**
 * Run a function with stdin replaced by a readable stream of `input`, so the
 * readline prompt resolves without a terminal. An empty `input` is a stream
 * that ends without ever producing a line — what `< /dev/null`, a CI runner or
 * a piped command with nothing left to say hands a prompt.
 */
async function withStdin(input, fn) {
  const { Readable } = require('stream');
  const fake = Readable.from(input ? [input] : []);
  return asStdin(fake, () => fn());
}

/**
 * Run a function with stdin replaced by a stream that stays open, handing it
 * the writer. What `withStdin` cannot show: a question answered while the run
 * is still going, rather than one answered by the last line before EOF.
 */
async function withOpenStdin(fn) {
  const { PassThrough } = require('stream');
  const fake = new PassThrough();
  try {
    return await asStdin(fake, () => fn(fake));
  } finally {
    fake.end();
  }
}

async function asStdin(fake, fn) {
  const original = Object.getOwnPropertyDescriptor(process, 'stdin');
  fake.isTTY = false;
  Object.defineProperty(process, 'stdin', {
    value: fake,
    configurable: true,
  });
  try {
    return await fn();
  } finally {
    Object.defineProperty(process, 'stdin', original);
  }
}
