const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const { scanCourse, isInternal } = require('../convert/course-scanner');
const { listModules, listModuleItems } = require('../canvas/modules');
const { listPages, getPage } = require('../canvas/pages');
const { listAssignments } = require('../canvas/assignments');
const { listDiscussions } = require('../canvas/discussions');
const { get } = require('../canvas/client');
const { loadCourseConfig } = require('../config/course-config');
const { allItems, toPosixPath } = require('./state');
const {
  REFERENCE_TYPES,
  canvasFingerprint,
  canvasTimestamp,
  hashBinaryFile,
  hashText,
  legacyFileFingerprint,
  needsContentFetch,
} = require('./fingerprint');
const { parseFrontmatter } = require('../convert/frontmatter');
const { extractFileReferences } = require('../convert/link-resolver');
const { toFileName, toFolderName } = require('../../cli/naming');

/**
 * Turn the world into the three plain-data inputs `lib/sync/plan.js` takes.
 *
 * Every file read and every Canvas request a sync makes happens here, and that
 * split is the whole reason the planner can be a pure function: the expensive,
 * unmockable half is one module with two entry points, and the decision half
 * has no idea either side exists. It also means the request budget of a run is
 * decided in one place rather than emerging from a call graph — which is what
 * went wrong before, when push fetched a page body per item and pull fetched
 * every module twice.
 *
 * The two halves:
 *
 * - `gatherLocal` scans `course/` and fingerprints what it finds.
 * - `gatherCanvas` reads the course's modules and items and fingerprints those,
 *   fetching only what a fingerprint genuinely needs — see `needsContentFetch`
 *   in `lib/sync/fingerprint.js` and the page pre-filter below.
 *
 * `gitDirtyPaths` is the third: one `git status` for the run, so the planner
 * can be told which local files hold work that exists nowhere else.
 */

/** Canvas's module item types, in this project's vocabulary. */
const CANVAS_TYPES = {
  Page: 'page',
  Assignment: 'assignment',
  Discussion: 'discussion',
  Quiz: 'quiz',
  SubHeader: 'sub_header',
  ExternalUrl: 'external_url',
  ExternalTool: 'external_tool',
  File: 'file',
};

// ---------------------------------------------------------------------------
// The git guard
// ---------------------------------------------------------------------------

/**
 * How much stdout one git call may produce before Node refuses to read it.
 *
 * `execFileSync` caps this at 1 MB unless told otherwise, and the cap is a
 * throw rather than a truncation, so it lands in the catch below and the run
 * degrades to "everything is dirty" — safe, and useless: nothing local is
 * written for the rest of the run and the reason given is `spawnSync git
 * ENOBUFS`.
 *
 * One `--porcelain -z` entry costs its path plus four bytes, two status
 * characters and a space and the NUL, and this repository's `node_modules`
 * averages 63 bytes an entry across its 41,747 files. So the default is
 * exceeded by 2.5 MB the first time a checkout stops ignoring an `npm install`
 * — a lost `.gitignore` line, a course tree unpacked inside another
 * repository, `--untracked-files=all` doing exactly what it is asked. That is
 * an ordinary accident, not a pathological tree, and it should not be what
 * decides whether a pull may write.
 *
 * A million paths at that size is the ceiling set here instead. It is finite
 * on purpose: past some size the honest answer really is that this tree cannot
 * be checked file by file, and degrading to the blanket guard beats building a
 * string big enough to take the process down with it.
 */
const GIT_MAX_BUFFER = 1_000_000 * 64;

/** Run one git command and hand back its stdout. Throws when git does. */
function runGit(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: GIT_MAX_BUFFER,
  });
}

/** Every directory on the way to a path, so a folder inherits its files' state. */
function ancestorsOf(itemPath) {
  const parts = itemPath.split('/');
  const out = [];
  for (let i = 1; i < parts.length; i++) out.push(parts.slice(0, i).join('/'));
  return out;
}

/**
 * The course-relative paths git holds uncommitted work for, in one call.
 *
 * Git is the undo for this whole system: a sync that writes the Canvas version
 * over a local file destroys the only copy of whatever was in it, unless git
 * has a copy. So every write into the working tree is gated on this, and the
 * planner refuses one for a file that is listed here.
 *
 * **Untracked counts as dirty**, and it is the case that matters most: a file
 * git has never seen has no copy anywhere, so overwriting it is worse than
 * overwriting a modified one, not better.
 *
 * **Outside a repository, or when git cannot be run, everything is dirty.**
 * Refusing to overwrite is the only safe reading of "I cannot tell", and the
 * caller says so once rather than per file — a sync in a directory that is not
 * a git checkout still reconciles Canvas, it just never writes locally.
 *
 * One `git status` for the whole run. Shelling out per file would be both
 * slower than the sync itself and wrong: the answer has to describe one instant.
 *
 * @param {object} [options]
 * @param {string} options.courseDir - Absolute path of `course/`.
 * @param {string} [options.cwd]     - Where git runs; the project root.
 * @param {Function} [options.run]   - Injection point for tests: `(args, cwd)`.
 * @returns {{available: boolean, paths: Set<string>, files: Set<string>,
 *   reason: string|null}} `paths` holds every dirty path relative to
 *   `courseDir`, POSIX, plus every directory that contains one — so a subfolder
 *   that became a text header can be asked the same question as a file.
 *   `files` holds the same answer without the ancestors: exactly what git
 *   named, and therefore the only one of the two that can be counted. It is
 *   kept rather than derived back out of `paths` by taking the leaves, because
 *   that derivation is only correct for what `--untracked-files=all` happens to
 *   emit today — a porcelain entry that is itself a directory would read as an
 *   ancestor and vanish from the count.
 */
function gitDirtyPaths({ courseDir, cwd = null, run = runGit } = {}) {
  const where = cwd || path.dirname(courseDir);
  const unavailable = (reason) => ({
    available: false,
    paths: new Set(),
    files: new Set(),
    reason,
  });

  let root;
  try {
    root = String(run(['rev-parse', '--show-toplevel'], where)).trim();
  } catch (err) {
    return unavailable(
      `git could not be run in ${where} (${firstLine(err.message)})`,
    );
  }
  if (!root) return unavailable(`${where} is not inside a git repository`);

  let output;
  try {
    output = String(
      run(['status', '--porcelain', '-z', '--untracked-files=all'], where),
    );
  } catch (err) {
    // Node spells an overrun buffer `spawnSync git ENOBUFS`, which reads as
    // git having broken rather than as the tree being too big to list. The
    // answer is the same either way — nothing here can be proved safe to
    // overwrite — but only one of the two tells the reader what to go and
    // look at.
    return unavailable(
      err.code === 'ENOBUFS'
        ? `git status listed more than ${GIT_MAX_BUFFER / 1_000_000} MB of ` +
            `paths in ${where}, which is more than this run can read at once`
        : `git status failed (${firstLine(err.message)})`,
    );
  }

  // Porcelain paths are relative to the repository root, whatever git was run
  // from; the course lives somewhere under it.
  const prefix = toPosixPath(path.relative(root, courseDir));
  const paths = new Set();
  const files = new Set();
  const add = (repoPath) => {
    let relative;
    if (prefix === '') relative = repoPath;
    else if (repoPath.startsWith(`${prefix}/`))
      relative = repoPath.slice(prefix.length + 1);
    else return;
    if (!relative) return;
    paths.add(relative);
    files.add(relative);
    for (const ancestor of ancestorsOf(relative)) paths.add(ancestor);
  };

  const entries = String(output)
    .split('\0')
    .filter((entry) => entry.length > 0);
  for (let i = 0; i < entries.length; i++) {
    const status = entries[i].slice(0, 2);
    add(entries[i].slice(3));
    // A rename or a copy names two paths, the destination first. Both sides
    // are uncommitted work, so both are protected.
    if (status[0] === 'R' || status[0] === 'C') {
      i += 1;
      if (entries[i]) add(entries[i]);
    }
  }

  return { available: true, paths, files, reason: null };
}

/** The first line of an error message, which is the part worth quoting. */
function firstLine(message) {
  return String(message || '')
    .split('\n')[0]
    .trim();
}

// ---------------------------------------------------------------------------
// The local side
// ---------------------------------------------------------------------------

/**
 * The `local_hash` of a markdown item, and of the binary behind it when it is a
 * `file` wrapper.
 *
 * A wrapper is a stub: `canvas_type: file` plus a `file_ref` naming a binary,
 * usually in the module's `_files/`. What a push sends Canvas is that binary
 * and never the stub (`writeFileContent` in `lib/sync/apply.js`), so a
 * fingerprint over the stub alone answers a question nobody asked. Replace last
 * year's PDF with this year's and the wrapper is byte-identical: the item reads
 * as unchanged, the run reports nothing, and students go on downloading last
 * year's.
 *
 * **The two halves are hashed apart and only then together**, because they are
 * not the same kind of thing. `hashText` strips a BOM and normalises line
 * endings, which is right for a file an author types and destructive for a PDF
 * — rewriting an 0x0d inside one produces a fingerprint no file on disk has.
 * `hashBinaryFile` takes the bytes exactly as they sit. Combining the two
 * digests keeps each half under the rule that fits it, which is the whole
 * reason `lib/sync/fingerprint.js` keeps those two functions separate.
 *
 * **No path reaches the hash, only content.** Rename detection pairs a vanished
 * path with a new one by `local_hash` (`lib/sync/rename-detect.js`), so a
 * wrapper renumbered in place — or carried into another module along with its
 * `_files/` — has to hash exactly as it did before, or a re-key reads as a
 * delete plus a create.
 *
 * Every other markdown item hashes as it always has, `file_ref` written on a
 * type that is not `file` included. The gate is narrow on purpose: widening it
 * would move the fingerprint of items this defect never touched, and every one
 * of them would read as changed on the next run.
 *
 * @param {string} text - The item's contents, which the caller already holds.
 * @param {string} absolutePath - Where the item sits, so `file_ref` resolves
 *   against its own directory the way `writeFileContent` resolves it.
 * @returns {string} sha256 hex.
 * @throws {Error} When `file_ref` names a binary that cannot be read. Both
 *   callers catch it and neither fails the run: `gatherLocal` records no hash
 *   and warns, which reads as "unchanged locally", and `localHashOf` in
 *   `lib/sync/apply.js` leaves the previous row alone. Whether the reference is
 *   honourable at all is `npx course validate`'s question, and it already
 *   errors on a missing `file_ref` and on one that names nothing.
 */
function fileItemHash(text, absolutePath) {
  let data = {};
  try {
    data = parseFrontmatter(text).data || {};
  } catch {
    // Frontmatter that will not parse is the scanner's to warn about and
    // validate's to fail on. Here it means only that there is no `file_ref` to
    // follow, and the text is still a perfectly good fingerprint of the text.
  }
  if (data.canvas_type !== 'file' || !data.file_ref) return hashText(text);

  const binary = path.resolve(
    path.dirname(absolutePath),
    String(data.file_ref),
  );
  let binaryHash;
  try {
    binaryHash = hashBinaryFile(binary);
  } catch (err) {
    // Rethrown rather than swallowed, and worded so the caller's own "could not
    // read <item>" line does not blame the wrapper, which read perfectly well.
    throw new Error(
      `its file_ref names ${data.file_ref}, which could not be read ` +
        `(${firstLine(err.message)}). \`npx course validate\` names the file ` +
        'items pointing at nothing.',
      { cause: err },
    );
  }
  return hashText(`file_item\n${hashText(text)}\n${binaryHash}`);
}

/**
 * The `local_hash` of one item path: text for markdown, raw bytes for anything
 * else.
 *
 * A non-markdown item is a binary the author dropped into a module, and text
 * hashing would run its bytes through line-ending normalisation — which
 * rewrites 0x0d inside a PNG and yields a fingerprint for a file that does not
 * exist. Choosing by extension keeps the two apart, and it is the same rule the
 * executor applies after a write, so the two always agree.
 *
 * Markdown goes through `fileItemHash`, which is that same rule one level
 * further in: a wrapper is text that stands for bytes, so it is fingerprinted
 * as both.
 *
 * @param {string} absolutePath
 * @param {string} itemPath - Repo-relative, POSIX; only its extension is read.
 * @returns {string} sha256 hex.
 */
function localFileHash(absolutePath, itemPath) {
  if (!itemPath.endsWith('.md')) return hashBinaryFile(absolutePath);
  return fileItemHash(fs.readFileSync(absolutePath, 'utf8'), absolutePath);
}

/**
 * The `local_hash` of a text header, which has no file to hash.
 *
 * A subfolder becomes a Canvas text header, and the only things this tool
 * manages about one are its title and its indent — exactly what
 * `canvasFingerprint` hashes for a `sub_header`. So the local fingerprint is
 * built from the same two values. Without it a header would read as "never
 * changed locally" and a relabelled subfolder would never reach Canvas.
 *
 * It is deliberately not the Canvas payload's hash: the two are compared
 * against their own stored baselines and never against each other, so nothing
 * requires them to be equal, and building it separately keeps that true.
 *
 * @param {{title: string, indent: number}} header
 * @returns {string} sha256 hex.
 */
function subHeaderHash({ title, indent = 0 } = {}) {
  return hashText(`sub_header\n${title == null ? '' : title}\n${indent}`);
}

/** The mtime of a path in milliseconds, or null when it cannot be read. */
function mtimeOf(absolutePath) {
  try {
    return fs.statSync(absolutePath).mtimeMs;
  } catch {
    return null;
  }
}

/**
 * A module's items in Canvas order: each text header followed by the items
 * indented under it, exactly as `flattenItems` arranges them for a push.
 */
function flattenScannedItems(items) {
  const flat = [];
  for (const entry of items || []) {
    if (entry.type === 'subheader') {
      flat.push({ header: true, entry });
      for (const child of entry.items || [])
        flat.push({ header: false, entry: child });
    } else {
      flat.push({ header: false, entry });
    }
  }
  return flat;
}

/**
 * The name a file wears while `reorderLocalModule` is moving it.
 *
 * A reorder routinely swaps two files into each other's slots, so each one is
 * parked under a temporary name before any of them lands. The original basename
 * is part of that name on purpose: a process killed outright between the two
 * halves leaves the file parked, and the basename is the only thing that can
 * tell a later run what it was called. Within one directory the basenames of
 * the files being moved are distinct — they are existing paths in that
 * directory — so the temporary name is unambiguous.
 *
 * Defined here rather than in `lib/sync/apply.js` because the reader of the
 * name is `recoverOrderTemps` below, and the writer must not be the one that
 * decides what recovery is looking for.
 */
const ORDER_TEMP_PREFIX = '__cw_order_';

/** The directories under `course/` a parked file can be sitting in. */
function reorderableDirs(courseDir) {
  const dirs = [];
  const children = (dir) => {
    try {
      return fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !isInternal(entry.name))
        .map((entry) => path.join(dir, entry.name));
    } catch {
      return [];
    }
  };
  // Module folders, and the one level of subfolders this tool supports. Nothing
  // deeper can hold a parked file, because nothing deeper is reordered.
  for (const moduleDir of children(courseDir)) {
    dirs.push(moduleDir);
    for (const subDir of children(moduleDir)) dirs.push(subDir);
  }
  return dirs;
}

/**
 * Put back anything a killed reorder left parked, before the tree is scanned.
 *
 * `reorderLocalModule` unwinds its own parking when a rename throws, but a
 * process that never gets to run any unwind — SIGKILL, a closed laptop, a
 * crash — leaves files sitting under `__cw_order_*`. `scanCourse` skips every
 * `_`-prefixed name, so the next run would read those items as **locally
 * deleted**, and `push --prune-canvas` would offer to delete the Canvas objects
 * behind them. The failure does not stay local, which is why recovery runs
 * before the scan rather than inside the reorder: by the time a reorder runs,
 * the plan has already been built from a tree with the files missing.
 *
 * It runs in all three directions, push included. Push's invariant is that it
 * does not write the author's content; putting a file this tool moved seconds
 * ago back under the name it already had is not that, and leaving it parked is
 * what ends in deleted Canvas objects.
 *
 * **Nothing here deletes.** A parked file whose original name is occupied is
 * left exactly where it is and named in a warning: deleting it is how a
 * recoverable interruption turns into lost work.
 *
 * @param {string} courseDir - Absolute path of `course/`.
 * @returns {{warnings: string[], parked: number}} One warning line per file
 *   recovered and per file that could not be, and how many are still parked.
 *   The count is what tells `gatherLocal` its scan is missing an item: a file
 *   left under `__cw_order_*` is invisible to `scanCourse`, so whatever that
 *   item embedded is missing from the run's reference set too.
 */
function recoverOrderTemps(courseDir) {
  const warnings = [];
  let parked = 0;
  for (const dir of reorderableDirs(courseDir)) {
    let entries;
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.startsWith(ORDER_TEMP_PREFIX)) continue;
      const original = entry.slice(ORDER_TEMP_PREFIX.length);
      if (original === '') continue;
      const shown = toPosixPath(
        path.relative(courseDir, path.join(dir, entry)),
      );
      const target = toPosixPath(
        path.relative(courseDir, path.join(dir, original)),
      );
      if (fs.existsSync(path.join(dir, original))) {
        parked += 1;
        warnings.push(
          `${shown} is left over from an interrupted renumbering, and ` +
            `${target} is occupied, so it was not put back. Nothing was ` +
            'deleted: move or remove one of the two by hand.',
        );
        continue;
      }
      try {
        fs.renameSync(path.join(dir, entry), path.join(dir, original));
        warnings.push(
          `Recovered ${target} from ${shown}: an earlier run was interrupted ` +
            'while renumbering this module.',
        );
      } catch (err) {
        parked += 1;
        warnings.push(
          `${shown} is left over from an interrupted renumbering and could ` +
            `not be put back as ${target}: ${firstLine(err.message)}. Nothing ` +
            'was deleted: rename it by hand.',
        );
      }
    }
  }
  return { warnings, parked };
}

/**
 * Every binary the whole course embeds, what each one currently hashes to, and
 * whether that answer is whole.
 *
 * A `state.files` row is created by the path a markdown item points at, so the
 * only way to know a row is dead is to ask every markdown item in `course/`
 * what it points at. That question is asked here, and nowhere else, for one
 * reason: **this is the only place that reads the whole tree.** The executor
 * sees only the items a run actually wrote — an unchanged page never passes
 * through it at all — so a set built there declares every image in the course
 * unreferenced. Answering it here also means `-m` cannot narrow the set by
 * accident: the restriction is the planner's, applied to modules, and this
 * scans the tree whatever the run was scoped to.
 *
 * **It is a `Map` and not a `Set` because the same question has a second
 * answer.** The value is the binary's sha256, the thing `state.files[ref]`
 * records, so the planner can see that a file was edited in place — which no
 * item's own `local_hash` can, the page around the image being byte-identical.
 * Before that, an edited image reached Canvas only when its page happened to be
 * pushed for some other reason. One map serves both: the sweep asks whether a
 * path is in it, the push asks what it hashes to, and neither needs the
 * executor's partial view. A path is hashed once however many items embed it.
 *
 * **`complete` is the licence to act on the *set*, and it is default-deny.** It
 * is true only when every markdown item the scan found was read; a single
 * unreadable file, a `course/` that is not there, or an item still parked under
 * `__cw_order_*` and therefore invisible to the scan all make it false. Every
 * caller must treat a false — or an absent `embedded` altogether, which is what
 * a hand-built `local` in a test hands over — as "prove nothing, delete
 * nothing". Getting this wrong deletes live images out of a live course.
 *
 * **A binary that could not be hashed is a `null` value, and it does not touch
 * `complete`.** The two failures are not the same failure. `complete` answers
 * "did I see every reference in the tree", and a `![](…)` pointing at a file
 * that is not there is still a reference the tree makes — the row for it is not
 * an orphan, and folding that into `complete` would let one broken image
 * anywhere in `course/` switch the whole sweep off for good. What a missing
 * hash costs is one conclusion about one path: `null` means "conclude nothing
 * about this binary", which is exactly what `uploadEmbeddedFiles` does with it
 * too — it warns and moves on.
 *
 * `extractFileReferences` is deliberately the same extractor that created the
 * rows in the first place (`uploadEmbeddedFiles` in `lib/sync/apply.js`,
 * `downloadReferencedFiles` in `lib/sync/local-write.js`). A row can only exist
 * for a path this function can find, so the two stay symmetric: no rule about
 * what counts as a reference is written down twice.
 */
function createReferenceSet(complete) {
  return { refs: new Map(), complete };
}

/**
 * The current bytes of one embedded binary, or `null` when they cannot be read.
 *
 * `hashBinaryFile` and not `hashText`, on the rule the whole of
 * `lib/sync/fingerprint.js` is built around: a 0x0d inside a PNG is data, and
 * normalising it yields a fingerprint no uploaded file ever matches. It is the
 * same function `uploadEmbeddedFiles` hashes with, which is what lets the
 * planner's answer and the executor's be compared at all.
 *
 * The path is resolved the way the executor resolves it — `path.join` against
 * the run's own `courseDir` — so a run pointed at another tree hashes that
 * tree's files and not the working repo's.
 */
function embeddedBinaryHash(courseDir, ref) {
  try {
    return hashBinaryFile(path.join(courseDir, ref));
  } catch {
    return null;
  }
}

/**
 * Scan `course/` into the planner's `local` shape.
 *
 * A subfolder arrives as a `sub_header` item whose `itemPath` is the subfolder
 * itself — `01-introduction/theory` — because the planner keys every item by
 * path and a header is an item like any other. Give it no path and the module's
 * three ordering sequences stop lining up, which silently disables ordering
 * reconciliation for the whole module rather than failing.
 *
 * Positions are the 1-based slot in that flattened list, not the numeric
 * prefix: the prefixes restart inside a subfolder, and Canvas counts a module's
 * items straight through.
 *
 * @param {object} options
 * @param {string} options.courseDir - Absolute path of `course/`.
 * @param {{available: boolean, paths: Set<string>}} [options.gitDirty] -
 *   What `gitDirtyPaths` returned. Absent, or unavailable, marks every item and
 *   every module dirty, which refuses every local write.
 * @returns {{modules: object[], warnings: string[],
 *   embedded: {refs: Map<string, string|null>, complete: boolean}}} `embedded`
 *   is `createReferenceSet` above: every binary the tree embeds against its
 *   current hash, and whether the scan that found them saw all of it. Each item
 *   also carries `embeds`, the paths that item alone points at, or `null` when
 *   it could not be read. Each module carries `dirty` for the folder itself,
 *   which is the only thing that can speak for the files the scanner skips, and
 *   `categoryDirty` for its `_category_.json` alone, which is the only thing
 *   narrow enough to guard a write to that one file.
 */
function gatherLocal({ courseDir, gitDirty = null } = {}) {
  const warnings = [];
  const gitUnavailable = !gitDirty || gitDirty.available !== true;
  const dirtyPaths = (gitDirty && gitDirty.paths) || new Set();
  const isDirty = (itemPath) =>
    gitUnavailable ? true : dirtyPaths.has(itemPath);

  if (!fs.existsSync(courseDir)) {
    return {
      modules: [],
      warnings: [`${courseDir} does not exist.`],
      // No tree was read, so nothing is known about what it embeds — and an
      // empty set that claimed to be whole would read as "the course embeds
      // nothing", which is a licence to delete every file in it.
      embedded: createReferenceSet(false),
    };
  }

  // Before the scan, never after: a file still parked under `__cw_order_*` is
  // invisible to `scanCourse`, and an item missing from the scan is an item the
  // planner reads as locally deleted.
  const recovery = recoverOrderTemps(courseDir);
  warnings.push(...recovery.warnings);

  // A file still parked is an item the scan below will not see, so this run
  // cannot claim to know what the course embeds.
  const embedded = createReferenceSet(recovery.parked === 0);

  const modules = scanCourse(courseDir).map((mod) => {
    const items = [];
    flattenScannedItems(mod.items).forEach(({ header, entry }, index) => {
      const position = index + 1;

      if (header) {
        const itemPath = `${mod.folderName}/${entry.folderName}`;
        const absolute = path.join(courseDir, itemPath);
        // `_category_.json` is where a header's title actually lives, so its
        // mtime is the one that moves when the header is relabelled; the
        // directory's does not.
        const category = path.join(absolute, '_category_.json');
        items.push({
          itemPath,
          title: entry.title,
          canvasType: 'sub_header',
          indent: entry.indent || 0,
          position,
          localHash: subHeaderHash(entry),
          localMtimeMs: fs.existsSync(category)
            ? mtimeOf(category)
            : mtimeOf(absolute),
          dirty: isDirty(itemPath),
        });
        return;
      }

      const itemPath = toPosixPath(entry.relativePath);
      const absolute = path.join(courseDir, itemPath);
      let localHash = null;
      try {
        localHash = localFileHash(absolute, itemPath);
      } catch (err) {
        // An unreadable file reads as "unchanged locally", which leaves it
        // alone rather than pushing an empty item over the Canvas copy.
        warnings.push(`Could not read ${itemPath}: ${firstLine(err.message)}`);
      }

      // Read again rather than reusing whatever the hash read, because the two
      // do not fail together: a `file` wrapper whose `file_ref` names a missing
      // binary throws above while the wrapper itself reads perfectly, and its
      // own references still count. Only markdown embeds anything — a bare
      // binary dropped into a module is a reference, never a referrer.
      //
      // `embeds` stays null unless the read succeeded, and that silence is the
      // per-item half of `complete`: an item nobody could read is an item this
      // run knows nothing about, so the planner must conclude nothing about the
      // images behind it either.
      let embeds = null;
      if (itemPath.endsWith('.md')) {
        try {
          const raw = fs.readFileSync(absolute, 'utf8');
          embeds = extractFileReferences(raw, itemPath);
          for (const ref of embeds) {
            if (embedded.refs.has(ref)) continue;
            embedded.refs.set(ref, embeddedBinaryHash(courseDir, ref));
          }
        } catch {
          // No second warning: the hash above has already named this file, or
          // it appeared and vanished mid-scan. What the run owes itself is the
          // flag — one item it could not read is one item whose images must
          // never be read as unreferenced.
          embedded.complete = false;
        }
      }

      items.push({
        itemPath,
        title: entry.title,
        canvasType: entry.canvasType,
        indent: entry.indent || 0,
        position,
        localHash,
        localMtimeMs: mtimeOf(absolute),
        dirty: isDirty(itemPath),
        embeds,
      });
    });

    return {
      folder: mod.folderName,
      name: mod.moduleName,
      position: mod.position,
      // The whole folder, asked the same question as one file — and it is a
      // strictly wider answer than the items above give. `gitDirtyPaths` adds
      // every ancestor of a dirty path, so this is true for anything
      // uncommitted anywhere under the module, including everything the scanner
      // never looks at: `_files/` binaries, `_category_.json`, an untracked
      // draft. Deleting the folder takes all of it, so the delete has to be
      // asked about all of it. Without this the module-level guard in
      // `planModuleOrphan` could only speak for scanned items, and a module
      // whose one piece of uncommitted work was an untracked image was pruned
      // with the image inside it.
      dirty: isDirty(mod.folderName),
      // The one file `update-local-module` writes, asked about by name.
      //
      // The flag above cannot stand in for it and neither can any item. The
      // folder's is far too wide — `gitDirtyPaths` adds every ancestor, so it
      // is true for one uncommitted lesson anywhere under the module, and a
      // guard resting on it would refuse every metadata update for a module the
      // author is in the middle of working on. No item covers it either: the
      // scanner never returns `_category_.json` as an item, so nothing in the
      // list above has it as a path.
      //
      // Existence first, for the reason `wouldDestroyUnsavedWork` gives: a file
      // that is not there holds no work to lose, and without this a module with
      // no `_category_.json` at all would be refused its label wherever git
      // cannot answer — a refusal to overwrite nothing.
      categoryDirty:
        fs.existsSync(
          path.join(courseDir, mod.folderName, '_category_.json'),
        ) && isDirty(`${mod.folderName}/_category_.json`),
      items,
    };
  });

  return { modules, warnings, embedded };
}

// ---------------------------------------------------------------------------
// The Canvas side
// ---------------------------------------------------------------------------

/**
 * The base rows indexed by the identities a Canvas item can be recognised by,
 * so the page pre-filter can find what the last sync recorded about one.
 *
 * Only the page pre-filter reads this. Matching base rows to Canvas items for
 * real is the planner's job, and it does it over the whole course with a claim
 * discipline this deliberately does not copy: a wrong answer here costs one
 * unnecessary request, and a wrong answer there costs an item.
 */
function indexBaseRows(base) {
  const byKey = new Map();
  for (const { entry } of allItems(base || {})) {
    if (!entry) continue;
    if (entry.canvas_type === 'page' && entry.page_url != null) {
      byKey.set(`page-url:${entry.page_url}`, entry);
    }
    if (entry.canvas_type && entry.canvas_id != null) {
      byKey.set(`${entry.canvas_type}:${entry.canvas_id}`, entry);
    }
    if (entry.module_item_id != null) {
      byKey.set(`item:${entry.module_item_id}`, entry);
    }
  }
  return byKey;
}

/** Two timestamps naming the same instant, however they are spelled. */
function sameInstant(left, right) {
  if (left == null || right == null) return false;
  const a = Date.parse(left);
  const b = Date.parse(right);
  if (Number.isNaN(a) || Number.isNaN(b)) return String(left) === String(right);
  return a === b;
}

/**
 * The course-wide lists, each fetched at most once per run and only when
 * something actually needs it.
 *
 * Assignments and discussions return their body and every owned field from the
 * list endpoint, so one request fingerprints all of them however many items the
 * course holds. Pages do not return a body, so their list is fetched for
 * `updated_at` alone — the pre-filter that keeps `getPage` off the unchanged
 * ones.
 */
function createCourseLists(courseId, warnings) {
  const cache = new Map();

  const once = (name, load) => async () => {
    if (!cache.has(name)) cache.set(name, load());
    try {
      return await cache.get(name);
    } catch (err) {
      warnings.push(
        `Could not list ${name} for course ${courseId} (${firstLine(err.message)}); ` +
          'items of that type are reported as unchanged on Canvas.',
      );
      const empty = Promise.resolve(new Map());
      cache.set(name, empty);
      return empty;
    }
  };

  const byId = (rows) => {
    const map = new Map();
    for (const row of rows || []) {
      if (row && row.id != null) map.set(String(row.id), row);
    }
    return map;
  };

  return {
    assignments: once('assignments', async () =>
      byId(await listAssignments(courseId)),
    ),
    discussions: once('discussion topics', async () =>
      byId(await listDiscussions(courseId)),
    ),
    pages: once('pages', async () => {
      const map = new Map();
      for (const page of (await listPages(courseId)) || []) {
        if (page.url != null) map.set(`url:${page.url}`, page);
        if (page.page_id != null) map.set(`id:${page.page_id}`, page);
      }
      return map;
    }),
  };
}

/**
 * The Canvas file object behind a File item, fetched once per file id.
 *
 * Canvas returns no content hash for a stored file, so `modified_at` and `size`
 * are the whole fingerprint, and both live on the file rather than on the
 * module item.
 */
function createFileFetcher(warnings) {
  const cache = new Map();
  return async (fileId) => {
    const key = String(fileId);
    if (!cache.has(key)) {
      cache.set(
        key,
        get(`/api/v1/files/${fileId}`).catch((err) => {
          warnings.push(
            `Could not read Canvas file ${fileId} (${firstLine(err.message)}); ` +
              'it is reported as unchanged on Canvas.',
          );
          return null;
        }),
      );
    }
    return cache.get(key);
  };
}

/**
 * The local path a Canvas item would be written to, decided per module and in
 * Canvas order — the same numbering `pull` applies, so an item that arrives
 * through sync lands where pull would have put it.
 *
 * A text header consumes a module position and opens a subfolder; the items
 * indented under it are numbered inside that subfolder. Everything else is
 * numbered straight through.
 */
function planSuggestedPaths(folder, items, untitled) {
  const planned = [];
  let modulePosition = 0;
  let subPosition = 0;
  let subfolder = null;

  for (const item of items) {
    if (item.type === 'SubHeader') {
      modulePosition += 1;
      subPosition = 0;
      subfolder = toFolderName(item.title || untitled, modulePosition);
      planned.push({ item, suggestedPath: `${folder}/${subfolder}` });
      continue;
    }

    let position;
    let directory;
    if ((item.indent || 0) > 0 && subfolder) {
      subPosition += 1;
      position = subPosition;
      directory = `${folder}/${subfolder}`;
    } else {
      subfolder = null;
      modulePosition += 1;
      position = modulePosition;
      directory = folder;
    }
    planned.push({
      item,
      suggestedPath: `${directory}/${toFileName(item.title || untitled, position)}`,
    });
  }

  return planned;
}

/**
 * Fingerprint one Canvas module item, fetching only what the type needs.
 *
 * The page branch is the one that matters for the request budget. `GET /pages`
 * gives every page's `updated_at` for one request; a page whose `updated_at`
 * still matches what the last sync recorded cannot have changed, so its stored
 * `canvas_hash` is reused and no `getPage` goes out. On a course of fifty pages
 * with two edits, that is two requests instead of fifty.
 *
 * The reuse is guarded on the item's title as well, because the fingerprint
 * covers both halves of an item — the module item's title and indent, and the
 * content behind it — while `updated_at` only moves for the second. Renaming
 * the item in the module list leaves the page untouched, so the title is
 * compared against what the row recorded and a difference forces the fetch.
 * **Indent is the remaining hole**: no row records one, so an indent changed in
 * the Canvas module list on a page whose body and title did not move is missed
 * until that page changes for some other reason. The local side owns indent, so
 * the next push corrects it rather than losing it.
 */
async function fingerprintCanvasItem(
  courseId,
  item,
  { suggestedPath, canvasModuleId, baseRows, lists, fetchFile, content },
) {
  const canvasType = CANVAS_TYPES[item.type] || null;
  const common = {
    moduleItemId: item.id ?? null,
    rawType: item.type ?? null,
    title: item.title ?? null,
    indent: item.indent ?? 0,
    position: item.position ?? 0,
    suggestedPath,
    canvasModuleId,
  };

  // A type this version has never heard of is reported and skipped. It is never
  // hashed on the fields every type happens to share: a fingerprint blind to
  // whatever the type actually holds reads as unchanged after every edit.
  if (!canvasType) {
    return {
      ...common,
      canvasType: null,
      canvasId: null,
      pageUrl: null,
      canvasHash: null,
      canvasUpdatedAt: null,
      recognised: false,
    };
  }

  const record = (extra) => {
    content.set(String(item.id), {
      item,
      content: extra.contentObject ?? null,
    });
    return {
      ...common,
      canvasType,
      canvasId: extra.canvasId ?? null,
      pageUrl: extra.pageUrl ?? null,
      canvasHash: extra.canvasHash ?? null,
      canvasUpdatedAt: extra.canvasUpdatedAt ?? null,
      // Only a file item carries one; see `legacyFileFingerprint`.
      ...(extra.legacyCanvasHash != null
        ? { legacyCanvasHash: extra.legacyCanvasHash }
        : {}),
      recognised: true,
    };
  };

  if (REFERENCE_TYPES.has(canvasType)) {
    // Nothing behind the item to fetch, and nothing behind it to hash: the
    // module item is the whole fingerprint. `listModuleItems` already returned
    // it, so a reference costs no request at all.
    return record({
      canvasId:
        canvasType === 'quiz'
          ? (item.content_id ?? null)
          : canvasType === 'sub_header'
            ? null
            : (item.id ?? null),
      canvasHash: canvasFingerprint({ item }, canvasType),
    });
  }

  if (canvasType === 'assignment' || canvasType === 'discussion') {
    const rows =
      canvasType === 'assignment'
        ? await lists.assignments()
        : await lists.discussions();
    const contentObject = rows.get(String(item.content_id));
    return record({
      canvasId: item.content_id ?? null,
      contentObject,
      canvasHash: contentObject
        ? canvasFingerprint({ item, content: contentObject }, canvasType)
        : null,
      canvasUpdatedAt: canvasTimestamp(contentObject, canvasType),
    });
  }

  if (canvasType === 'file') {
    const contentObject = await fetchFile(item.content_id);
    return record({
      canvasId: item.content_id ?? null,
      contentObject,
      canvasHash: contentObject
        ? canvasFingerprint({ item, content: contentObject }, 'file')
        : null,
      // `modified_at`, the clock the fingerprint reads: a publish click moves
      // the file's `updated_at` and must not make Canvas look newer in a real
      // conflict. See `canvasTimestamp`.
      canvasUpdatedAt: canvasTimestamp(contentObject, 'file'),
      // The 1.5.2 migration bridge: what 1.5.1 would have recorded for this
      // file, so a row written then is not read as a change on Canvas.
      legacyCanvasHash: contentObject
        ? legacyFileFingerprint({ item, content: contentObject })
        : null,
    });
  }

  // Anything left is a type `CANVAS_FINGERPRINT_FIELDS` knows but no branch
  // above claimed, which can only happen if the two tables drift apart. Report
  // it as unfingerprintable rather than hash it on whatever is to hand: a hash
  // built from the wrong fields reads as unchanged after every edit.
  if (!needsContentFetch(canvasType)) {
    return record({ canvasId: item.content_id ?? null });
  }

  // Page, and the only type `needsContentFetch` answers true for: its body is
  // left out of the course-wide list, so a fingerprint costs a request unless
  // the pre-filter can prove the page has not moved.
  const pages = await lists.pages();
  const listed =
    (item.page_url != null && pages.get(`url:${item.page_url}`)) ||
    (item.content_id != null && pages.get(`id:${item.content_id}`)) ||
    null;
  const row =
    (item.page_url != null && baseRows.get(`page-url:${item.page_url}`)) ||
    (item.content_id != null && baseRows.get(`page:${item.content_id}`)) ||
    (item.id != null && baseRows.get(`item:${item.id}`)) ||
    null;

  const unchanged =
    row &&
    row.canvas_hash != null &&
    listed &&
    sameInstant(row.canvas_updated_at, listed.updated_at) &&
    row.title != null &&
    String(row.title) === String(item.title ?? '');

  if (unchanged) {
    return record({
      canvasId: listed.page_id ?? row.canvas_id ?? null,
      pageUrl: item.page_url ?? listed.url ?? null,
      canvasHash: row.canvas_hash,
      canvasUpdatedAt: row.canvas_updated_at,
    });
  }

  const page = await getPage(courseId, item.page_url ?? item.content_id);
  return record({
    canvasId: page.page_id ?? item.content_id ?? null,
    pageUrl: page.url ?? item.page_url ?? null,
    contentObject: page,
    canvasHash: canvasFingerprint({ item, content: page }, 'page'),
    canvasUpdatedAt: page.updated_at ?? (listed ? listed.updated_at : null),
  });
}

/**
 * Read the Canvas course into the planner's `canvas` shape.
 *
 * One `listModules`, then one `listModuleItems` per module, then only the
 * fetches a fingerprint cannot be built without. Every module is read, `-m` or
 * not: which local folder a Canvas module belongs to is the planner's decision,
 * and skipping a module on a guess about that would hand the planner an empty
 * module — indistinguishable from one whose items were all deleted in Canvas.
 *
 * @param {object} options
 * @param {string|number} options.courseId
 * @param {object} [options.base] - The sync state, read only by the page
 *   pre-filter, which needs the stored `canvas_updated_at` to compare against.
 * @returns {Promise<{modules: object[], content: Map, warnings: string[]}>}
 *   `content` maps a module item id to `{item, content}` — the raw module item
 *   and the object behind it, or null where none was fetched. The executor
 *   writes local files from it, so a pull-shaped write costs no second fetch.
 *   A module whose items could not be listed arrives with `unreadable` set to
 *   the failure message and no `items` at all, never as an empty module: empty
 *   is what deleted looks like, and the planner walls an unreadable module off
 *   rather than reconciling it.
 */
async function gatherCanvas({ courseId, base = null } = {}) {
  const warnings = [];
  const content = new Map();
  const baseRows = indexBaseRows(base);
  const lists = createCourseLists(courseId, warnings);
  const fetchFile = createFileFetcher(warnings);
  const untitled = loadCourseConfig().labels.pull.untitled;

  const rawModules = (await listModules(courseId)) || [];
  const modules = [];

  for (const mod of rawModules) {
    const position = mod.position || 0;
    const folder = toFolderName(mod.name || untitled, position);

    let rawItems;
    try {
      rawItems = (await listModuleItems(courseId, mod.id)) || [];
    } catch (err) {
      // A module whose items could not be read must not vanish from the run,
      // because vanishing is exactly what a module deleted on Canvas looks
      // like: dropping it here once let `--prune-local` offer to delete the
      // local folder of a module that was merely throttled. So the module is
      // carried through **flagged**, with no item list at all — `unreadable`
      // is the one field the planner checks, and it refuses to derive
      // anything from or about such a module (`planModule` in
      // `lib/sync/plan.js`). The warning below is a courtesy; the planner's
      // own skipped entry is the surfacing that reaches the report and the
      // exit code.
      warnings.push(
        `Could not list the items of Canvas module ${mod.id} ("${mod.name}") ` +
          `(${firstLine(err.message)}); this run cannot tell what it holds.`,
      );
      modules.push({
        canvasModuleId: mod.id,
        name: mod.name ?? null,
        position,
        suggestedFolder: folder,
        unreadable: firstLine(err.message),
      });
      continue;
    }

    const items = [];
    for (const { item, suggestedPath } of planSuggestedPaths(
      folder,
      rawItems,
      untitled,
    )) {
      items.push(
        await fingerprintCanvasItem(courseId, item, {
          suggestedPath,
          canvasModuleId: mod.id,
          baseRows,
          lists,
          fetchFile,
          content,
        }),
      );
    }

    modules.push({
      canvasModuleId: mod.id,
      name: mod.name ?? null,
      position,
      suggestedFolder: folder,
      items,
    });
  }

  return { modules, content, warnings };
}

module.exports = {
  CANVAS_TYPES,
  ORDER_TEMP_PREFIX,
  fileItemHash,
  gatherCanvas,
  gatherLocal,
  gitDirtyPaths,
  localFileHash,
  // Exported so the buffer it runs git under can be tested against git itself,
  // rather than only through the injected `run` every other test uses.
  runGit,
  subHeaderHash,
};
