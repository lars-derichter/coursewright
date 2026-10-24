const fs = require('fs');
const path = require('path');
const readline = require('readline');
const log = require('./logger');
const { PROJECT_ROOT } = require('./project-root');
const { RefusalError } = require('../lib/errors');

const COURSE_DIR = path.join(PROJECT_ROOT, 'course');

/**
 * Resolved by `ask` in place of an answer when the input stream ends without
 * giving one: `< /dev/null`, a CI step, a VS Code task with no terminal, or a
 * pipe that ran out halfway through the questions.
 */
const EOF = Symbol('input stream ended');

/**
 * What each command tells a run that cannot answer it — the command's own name,
 * and the flags that supply the answers instead. Keyed by the interface so that
 * `prompt` can reach it without every question having to carry it.
 */
const hints = new WeakMap();

/**
 * Thrown by `prompt` when a question reaches the end of the input stream
 * instead of an answer. `cli/index.js` catches it, prints the message and sets
 * a non-zero exit code; nothing else should catch it, because reporting success
 * for a run that never got its answers is the defect it exists to stop.
 *
 * A `RefusalError` because that is what it is — a run this command cannot serve,
 * stopped on purpose, with one line saying what to do instead. The class is what
 * gets it printed as that line rather than under a stack trace, and it is shared
 * with every other deliberate stop; see `lib/errors.js`. It keeps a name of its
 * own only because its own tests catch it by type.
 */
class UnanswerableError extends RefusalError {
  constructor(message) {
    super(message);
    this.name = 'UnanswerableError';
  }
}

/**
 * Ask `question` and resolve the answer, or `EOF` when the input stream ends
 * without one.
 *
 * The `'close'` hook is the load-bearing half. `rl.question`'s callback never
 * fires once stdin reaches EOF, so waiting only for it leaves the promise
 * unsettled: the run stops mid-question with the event loop drained, every line
 * after the await goes unrun, and the process exits 0 as though it had done what
 * it was asked. `'close'` does fire on EOF, and on an answered run it fires
 * after the answer, so the first of the two to happen is the one that settles
 * this. The listener comes off again on an answer, so a command asking a dozen
 * questions on one interface does not accumulate a dozen listeners.
 *
 * An interface that closed *before* the question was asked cannot emit
 * `'close'` a second time — readline throws `ERR_USE_AFTER_CLOSE` from
 * `question` instead. That is the same ended stream by another route, so it
 * resolves the same way rather than escaping as a stack trace.
 *
 * It is deliberately not an `isTTY` check, and must not be tidied into one:
 * `printf '1\n' | npx course new-item` has no terminal either, and piping the
 * answers in is a legitimate way to script this. What separates EOF from a real
 * answer is what arrived, not what is attached.
 */
function ask(rl, question, defaultValue) {
  const suffix = defaultValue ? ` (${defaultValue})` : '';
  return new Promise((resolve) => {
    const onClose = () => resolve(EOF);
    rl.once('close', onClose);
    try {
      rl.question(`${question}${suffix}: `, (answer) => {
        rl.removeListener('close', onClose);
        resolve(answer.trim() || defaultValue || '');
      });
    } catch {
      rl.removeListener('close', onClose);
      resolve(EOF);
    }
  });
}

/**
 * The one line a run with no answers to give is left with. It names the command
 * rather than the question alone, because the run that hits this is a script or
 * a task whose output is read later, out of context.
 */
function unanswerableMessage(question, hint) {
  const { command, flags } = hint || {};
  const tag = command ? `[${command}] ` : '';
  const terminal = command
    ? `Run \`npx course ${command}\` in a terminal`
    : 'Run this in a terminal';
  const scripted = flags ? `, or pass ${flags} to answer from flags.` : '.';
  return (
    `${tag}Error: "${question}" got no answer — the input stream ended ` +
    `before one arrived. ${terminal}${scripted}`
  );
}

/**
 * Prompt the user for input with an optional default value.
 *
 * Throws `UnanswerableError` rather than returning when the input stream ends
 * first, and throwing is the point twice over. A scripted run has to stop with
 * a non-zero exit instead of reporting a success it never had; and several
 * callers ask inside a `while (true)` that re-asks until the answer parses,
 * which an empty string would turn from one hang into an endless loop printing
 * its own complaint. An exception leaves the loop and the command together.
 *
 * A default value is no protection: it fires on an empty *line*, and EOF is the
 * absence of a line rather than an empty one.
 *
 * `confirm` in `backup-warning.js` deliberately does not use this — cancelling
 * is the safe answer to a destructive question, so it reads `ask` directly.
 */
async function prompt(rl, question, defaultValue) {
  const answer = await ask(rl, question, defaultValue);
  if (answer !== EOF) return answer;
  throw new UnanswerableError(unanswerableMessage(question, hints.get(rl)));
}

/**
 * Read existing module folders and return sorted array of { prefix, folderName }.
 */
function getExistingModules() {
  const entries = fs.readdirSync(COURSE_DIR, { withFileTypes: true });
  const modules = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const match = entry.name.match(/^(\d+)/);
    if (match) {
      modules.push({ prefix: parseInt(match[1], 10), folderName: entry.name });
    }
  }

  modules.sort((a, b) => a.prefix - b.prefix);
  return modules;
}

/** A folder's numeric prefix as a number, or null for a folder without one. */
function folderPrefix(folderName) {
  const match = folderName.match(/^(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Resolve `-m` values to module folder names.
 *
 * Each selector is split on commas, and each piece is a full folder name
 * (`03-css-basics`), a number (`03` or `3`) matching the folder with that
 * prefix, or a range (`03-05`) matching every folder whose prefix lies in it.
 * The exact name is tried first, so a folder literally called `03-05` still
 * resolves to itself. A range skips a missing number quietly; one that matches
 * nothing at all is an error, as is an unknown name or number. A number two
 * folders share is an error too, naming both, since nothing says which was
 * meant. A range takes both, because it asks for every folder in it.
 *
 * It takes plain folder names rather than scanned modules, so a caller can
 * pass folders that exist only in the sync state. Pure: no filesystem, no
 * logging, so a failure is a thrown Error for the caller to report its own way.
 *
 * @param {string|string[]} selectors - The raw `-m` values.
 * @param {string[]} folderNames - Every module folder to choose from. Their order
 *   breaks ties between folders with the same prefix.
 * @param {object} [options]
 * @param {boolean} [options.single] - Refuse a selection of more than one module.
 * @returns {string[]} The matching folder names, in prefix order, each once.
 * @throws {Error} On an unknown token, an empty range, a backwards range, an
 *   ambiguous number, or (with `single`) more than one match.
 */
function resolveModuleSelectors(selectors, folderNames, { single } = {}) {
  const tokens = []
    .concat(selectors || [])
    .flatMap((s) => String(s).split(','))
    .map((t) => t.trim())
    .filter(Boolean);
  if (tokens.length === 0) throw new Error('No module given.');

  const withPrefix = (match) =>
    folderNames.filter((f) => {
      const n = folderPrefix(f);
      return n !== null && match(n);
    });

  const picked = new Set();
  for (const token of tokens) {
    if (folderNames.includes(token)) {
      picked.add(token);
      continue;
    }
    const number = token.match(/^(\d+)$/);
    if (number) {
      const n = parseInt(number[1], 10);
      const matches = withPrefix((p) => p === n);
      if (matches.length === 0) throw new Error(`Module not found: ${token}`);
      if (matches.length > 1) {
        throw new Error(
          `Module number ${token} is ambiguous, more than one folder starts ` +
            `with it: ${matches.join(', ')}. Give the full folder name.`,
        );
      }
      picked.add(matches[0]);
      continue;
    }
    const range = token.match(/^(\d+)-(\d+)$/);
    if (range) {
      const from = parseInt(range[1], 10);
      const to = parseInt(range[2], 10);
      if (from > to) {
        throw new Error(
          `Module range ${token} runs backwards: write ${range[2]}-${range[1]}.`,
        );
      }
      const matches = withPrefix((p) => p >= from && p <= to);
      if (matches.length === 0) {
        throw new Error(`No module in range ${token}.`);
      }
      for (const m of matches) picked.add(m);
      continue;
    }
    // `-m` is variadic, so a path typed after it lands here as a selector.
    if (token.includes('/') || /\.md$/i.test(token)) {
      throw new Error(
        `Not a module: ${token}. -m takes modules only, and reads every ` +
          'argument after it as one.',
      );
    }
    throw new Error(`Module not found: ${token}`);
  }

  // Course order, whatever order they were typed in. A folder without a prefix
  // can only be picked by its full name, and sorts after the numbered ones.
  const rank = (f) => folderPrefix(f) ?? Infinity;
  const result = folderNames
    .filter((f) => picked.has(f))
    .sort((a, b) => rank(a) - rank(b));

  if (single && result.length > 1) {
    throw new Error(
      `This command takes one module, but ${tokens.join(',')} selects ` +
        `${result.length}: ${result.join(', ')}.`,
    );
  }
  return result;
}

/**
 * Pad a number to two digits: 1 -> "01", 12 -> "12".
 */
function pad(n) {
  return String(n).padStart(2, '0');
}

/**
 * Rename a module folder to use a new numeric prefix and update its _category_.json.
 * Returns { from, to } describing the rename, or null if no change was needed.
 */
function renameModule(folderName, newPrefix) {
  const newFolderName = folderName.replace(/^\d+/, pad(newPrefix));
  if (newFolderName === folderName) return null;

  const oldFolder = path.join(COURSE_DIR, folderName);
  const newFolder = path.join(COURSE_DIR, newFolderName);

  fs.renameSync(oldFolder, newFolder);

  // Update _category_.json if it exists
  const categoryFile = path.join(newFolder, '_category_.json');
  if (fs.existsSync(categoryFile)) {
    const category = safeReadJSON(categoryFile);
    category.position = newPrefix;
    fs.writeFileSync(
      categoryFile,
      JSON.stringify(category, null, 2) + '\n',
      'utf8',
    );
  }

  return { from: folderName, to: newFolderName };
}

/**
 * Create a readline interface.
 *
 * `hint` names the command and the flags that skip its questions, for the error
 * a run that cannot answer them gets. It belongs here, once per command, rather
 * than at each question: a command that grows a thirteenth question should not
 * be able to grow one that fails less helpfully than the other twelve.
 *
 * @param {{command: string, flags?: string}} [hint]
 */
function createRL(hint) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  if (hint) hints.set(rl, hint);
  return rl;
}

/**
 * How long a generated slug may get.
 *
 * A Canvas title is not a filename and nobody promised it would be short: a
 * text header reading "put an overview of every evaluation that counts towards
 * the final mark here, with the date and the percentage" is a real one, and
 * uncapped it became a folder name of nearly 200 characters. Two of those
 * nested under `course/` carried a repository past Windows' 260-character
 * `MAX_PATH`, and that is not a cosmetic problem: `git clone` fails outright,
 * so the course could not be checked out on Windows at all.
 *
 * 60 is the budget, and it is spent like this. A worst-case item sits three
 * segments deep — module, text-header subfolder, file — each carrying a
 * two-digit prefix and a hyphen, so 63 apiece; with `course/` and `.md` that is
 * 209. A GitHub runner then puts `D:\a\<repo>\<repo>\` in front of it, which
 * for a repository name of 20 characters is another 47. Tight, but inside 260,
 * and the failure it replaces was total.
 */
const MAX_SLUG_LENGTH = 60;

/**
 * Cut a slug to `MAX_SLUG_LENGTH`, on a word boundary where there is one.
 *
 * The cut lands on the last hyphen at or before the limit, so what survives is
 * whole words and still reads as the title it came from. A first word already
 * longer than the limit offers no boundary and is cut through: the point here
 * is the length, not the prettiness.
 *
 * Truncation can leave two siblings sharing a slug. Their paths still differ,
 * because every generated name carries the two-digit position in front of it,
 * and the one case where that stops being true — a renumber sliding one onto
 * the other's path — is already settled by `dropRowsRenumberedOver` in
 * `cli/sync-renames.js`.
 */
function truncateSlug(slug) {
  if (slug.length <= MAX_SLUG_LENGTH) return slug;
  const cut = slug.slice(0, MAX_SLUG_LENGTH);
  const boundary = cut.lastIndexOf('-');
  return (boundary > 0 ? cut.slice(0, boundary) : cut).replace(/-+$/, '');
}

/**
 * Convert a name to a folder slug: lowercase, hyphenated.
 * "My New Module" -> "my-new-module"
 */
function toSlug(name) {
  return truncateSlug(
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, ''),
  );
}

/**
 * Safely read and parse a JSON file. Returns the parsed object, or
 * a fallback value if the file is missing or contains invalid JSON.
 *
 * The unparseable-file warning goes through the logger rather than straight to
 * console: `lib/sync/local-write.js` reads `_category_.json` through here, so
 * this fires mid-pull and has to obey `--quiet` like the rest of a sync run.
 *
 * @param {string} filePath - Path to the JSON file.
 * @param {*} [fallback={}] - Value to return on failure.
 * @returns {*} Parsed JSON or the fallback value.
 */
function safeReadJSON(filePath, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') {
      log.warn(
        `[warn] Failed to parse ${path.basename(filePath)}: ${err.message}`,
      );
    }
    return fallback;
  }
}

/**
 * Print the list of existing modules.
 */
function printModules(modules) {
  if (modules.length === 0) return;
  console.log('Existing modules:');
  for (const m of modules) {
    console.log(`  ${pad(m.prefix)} - ${m.folderName}`);
  }
  console.log();
}

module.exports = {
  COURSE_DIR,
  EOF,
  UnanswerableError,
  ask,
  prompt,
  getExistingModules,
  resolveModuleSelectors,
  pad,
  MAX_SLUG_LENGTH,
  truncateSlug,
  toSlug,
  renameModule,
  createRL,
  printModules,
  safeReadJSON,
};
