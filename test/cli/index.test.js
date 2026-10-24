const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { COMMAND_SYNC_STATE_POLICY } = require('../../cli/sync-state-guard');

const CLI_DIR = path.join(__dirname, '..', '..', 'cli');
const INDEX = path.join(CLI_DIR, 'index.js');
const EXTENSION = path.join(
  __dirname,
  '..',
  '..',
  '.vscode',
  'extensions',
  'course-manager',
  'extension.js',
);

/**
 * The command table, read as source rather than by requiring it.
 *
 * `cli/index.js` calls `program.parse` at the bottom of the file, so requiring
 * it in a test would run whatever command the test runner's own argv looks
 * like. Everything worth checking here is visible in the text.
 */
const source = fs.readFileSync(INDEX, 'utf8');
const extensionSource = fs.readFileSync(EXTENSION, 'utf8');

/** Every `.command('x')`, down to the bare name: `search <keyword>` is `search`. */
function registeredCommands() {
  return [...source.matchAll(/\.command\('([^']+)'\)/g)].map(
    (match) => match[1].split(' ')[0],
  );
}

/** Every `require('./x')` the command table resolves at load time. */
function requiredModules() {
  return [...source.matchAll(/require\('\.\/([^']+)'\)/g)].map(
    (match) => match[1],
  );
}

/**
 * Every CLI command the VS Code extension invokes, from both shapes it uses:
 * the `npx course <cmd>` strings it runs in a terminal, and the argv arrays it
 * hands to `runCli`. It does not claim to catch an argv array built somewhere
 * other than its own literal.
 */
function commandsTheExtensionCalls() {
  const names = new Set();
  for (const match of extensionSource.matchAll(/npx course ([a-z][\w-]*)/g)) {
    names.add(match[1]);
  }
  for (const match of extensionSource.matchAll(/runCli\(\[\s*'([^']+)'/g)) {
    names.add(match[1]);
  }
  for (const match of extensionSource.matchAll(
    /const args = \[\s*'([^']+)'/g,
  )) {
    names.add(match[1]);
  }
  return [...names];
}

describe('the CLI command table', () => {
  it('registers every command against a module that exists', () => {
    // A command whose module was deleted is not a lint error, it is a crash on
    // the next `npx course anything`: the requires run when the table is built,
    // before commander has looked at argv.
    const missing = requiredModules().filter(
      (name) => !fs.existsSync(path.join(CLI_DIR, `${name}.js`)),
    );
    assert.deepEqual(missing, []);
  });

  it('registers each command name once', () => {
    const names = registeredCommands();
    assert.deepEqual([...new Set(names)], names);
  });

  it('says of every command whether the sync state has to match', () => {
    // The one thing that keeps `COMMAND_SYNC_STATE_POLICY` from rotting into a
    // list somebody forgot. A command missing from it is guarded anyway, so
    // ignoring this failure costs a spurious refusal rather than a silent hole
    // — but the classification is a decision, and this is where it gets made.
    // A name left in the table after its command went away is the other half:
    // it reads as a promise the CLI no longer keeps.
    const registered = registeredCommands().sort();
    const classified = Object.keys(COMMAND_SYNC_STATE_POLICY).sort();
    assert.deepEqual(classified, registered);
  });
});

describe('-m on the four sync commands', () => {
  it('takes several modules on each, push included', () => {
    // Push took one folder name, for no reason but the reference table saying
    // so; the command itself always read a list.
    for (const name of ['sync', 'push', 'pull', 'status']) {
      const block = source.split(`.command('${name}')`)[1].split('.action(')[0];
      assert.match(block, /'-m, --module <module\.\.\.>'/, name);
    }
  });
});

describe('the VS Code extension against the CLI', () => {
  it('calls no command the CLI does not register', () => {
    // A palette entry pointing at a command that no longer exists is a runtime
    // error for the author, and nothing in the extension's own tests would see
    // it: they check extension.js against package.json, and both can agree on
    // a command that went away.
    const registered = new Set(registeredCommands());
    const unknown = commandsTheExtensionCalls().filter(
      (name) => !registered.has(name),
    );
    assert.deepEqual(unknown, []);
  });
});
