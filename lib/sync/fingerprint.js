const crypto = require('crypto');
const fs = require('fs');

/**
 * Two fingerprints per synced item, and neither is ever compared to the other.
 *
 * `local_hash` records what the local file looked like at the last sync;
 * `canvas_hash` records what Canvas held at the same moment. Each side is then
 * compared only against its own stored baseline — `localChanged = hashNow !==
 * row.local_hash`, `canvasChanged = hashNow !== row.canvas_hash` — which is what
 * lets the planner tell "changed here" from "changed there" from "changed on
 * both sides", the distinction the old single global `last_sync` could not make.
 * The two hashes are computed from different things (a file's bytes on one side,
 * a canonical JSON of Canvas fields on the other), so comparing one to the other
 * is meaningless and always will be.
 *
 * Both answers are exact and neither reads an mtime, so they survive a `git
 * clone` — which rewrites every mtime it touches, and which is precisely what
 * made the old mtime-gated pull unreliable.
 *
 * Nothing here reaches the network: the caller hands in whatever the Canvas API
 * already gave it. The only I/O is reading a local file.
 */

/** sha256 in the hex form the sync state stores. */
function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/**
 * The only two differences allowed to pass without counting as an edit: a
 * leading UTF-8 BOM, which some editors add and drop on their own, and the line
 * ending, which a Windows checkout rewrites wholesale.
 *
 * Nothing else. Trailing whitespace and the final newline are deliberately left
 * alone: an author who added or removed a trailing newline edited their file,
 * and a hash that hid it would leave the two sides quietly out of step — the
 * file would read as unchanged and the edit would never reach Canvas.
 */
function normaliseText(text) {
  let out = text == null ? '' : String(text);
  if (out.charCodeAt(0) === 0xfeff) out = out.slice(1);
  return out.replace(/\r\n?/g, '\n');
}

/**
 * The hash `hashLocalFile` produces, over a string the caller already holds. It
 * is also what turns the canonical Canvas payload below into a `canvas_hash`:
 * one hash function, two baselines.
 *
 * The engine needs it after it writes a file: it has the exact bytes it just
 * wrote, and re-reading the file to fingerprint them would open a window for an
 * editor's autosave to land in between, leaving a row that describes a file the
 * engine never produced.
 *
 * A nullish input hashes as the empty string, matching how an absent body is
 * read everywhere else in this module.
 *
 * @param {string} text
 * @returns {string} sha256 hex of the normalised text.
 */
function hashText(text) {
  return sha256Hex(normaliseText(text));
}

/**
 * The `local_hash` of a **text** file: sha256 of its contents with line endings
 * normalised and a leading BOM stripped, nothing else touched.
 *
 * That is the rule for anything the author writes — every markdown item under
 * `course/`. Binaries in `_files/`, whose rows live in `state.files`, take
 * `hashBinaryFile` instead. The two are separate functions rather than one with
 * a flag because picking the wrong one is a silent-corruption bug rather than an
 * error: normalising a PNG rewrites bytes in the middle of it and yields a hash
 * for a file that does not exist.
 *
 * **The engine does not call this**, and has not since file wrappers grew a
 * fingerprint of their own. It reads the file once and hashes it through
 * `localFileHash` in `lib/sync/gather.js`, which picks between text and bytes by
 * extension and then hands markdown to `fileItemHash` — the same rule as here,
 * plus the wrapper case where a stub's `file_ref` binary is hashed alongside it.
 * What keeps this function is the test suite: a state fixture has to state the
 * `local_hash` of an ordinary markdown item it just wrote, and this is that
 * value in one call (`test/sync/fingerprint.test.js` and the command tests under
 * `test/cli/`). For a wrapper the two answers differ, and the fixture wants
 * `localFileHash`.
 *
 * @param {string} filePath
 * @returns {string} sha256 hex of the normalised contents.
 */
function hashLocalFile(filePath) {
  return hashText(fs.readFileSync(filePath, 'utf8'));
}

/**
 * The hash of a **binary** file: its raw bytes, exactly as they sit on disk,
 * with none of the text normalisation above.
 *
 * For the embedded assets in `_files/`. A 0x0d byte inside a PNG, a PDF or a zip
 * is data, not a line ending, and rewriting it would produce a fingerprint no
 * uploaded file ever matches.
 *
 * @param {string} filePath
 * @returns {string} sha256 hex of the raw bytes.
 */
function hashBinaryFile(filePath) {
  return sha256Hex(fs.readFileSync(filePath));
}

/**
 * The types with no object behind them: the module item *is* the thing, so its
 * identity is the module item id rather than a content id.
 *
 * Three of them point at something sync does not own — a quiz, a tool, a URL —
 * and sync never creates, updates or deletes the thing pointed at, only the
 * item that points there. `sub_header` is the odd one out: it points at nothing
 * at all. A text header is a title and an indent sitting in a module list, and
 * this project creates one for every subfolder inside a module folder. It
 * belongs here anyway, and for the same reason: Canvas gives it no
 * `content_id`, so `module_item_id` is the only thing a base row can find it by.
 *
 * It lives here because the same four types are what `CANVAS_FINGERPRINT_FIELDS`
 * below gives the common fields alone and what `needsContentFetch` answers `false`
 * for: the item is the whole fingerprint and no request can add to it. `gather`,
 * `plan` and `apply` all read it from here so the list is stated once.
 */
const REFERENCE_TYPES = new Set([
  'quiz',
  'sub_header',
  'external_url',
  'external_tool',
]);

/**
 * On every type, and first in every list: what the module item is called, and
 * how far it is indented under a text header.
 */
const COMMON_FIELDS = ['title', 'indent'];

/**
 * The fields that go into each type's Canvas fingerprint. `title` and `indent`
 * are common to every type and lead every list; the rest are per type.
 * `FIELD_SPECS` below says which of Canvas's two objects each field is read from
 * and how it is normalised.
 *
 * The scalars mirror `CANVAS_OWNED_KEYS` in `lib/convert/html-to-markdown.js`,
 * the existing authority on what this tool manages per type; the two have to
 * stay consistent, so they change together. Two deliberate differences: the body
 * (`body`, `description`, `message`) is hashed here and is not a frontmatter key
 * there, and `canvas_id` / `canvas_type` are listed there and must never appear
 * here. Those two are identity, not content — hashing identity would make an
 * item that was re-adopted onto another Canvas object read as "Canvas changed"
 * the instant it was matched, and pull the remote copy over a local file nobody
 * had touched. `canvas_id` is listed there only so that pull strips one written
 * into a file by hand; it is not a frontmatter key, and it lives in the sync
 * row this fingerprint is stored on.
 *
 * **Two titles are hashed, and the second is not a duplicate of the first.**
 * Canvas keeps a title on the module item and another on the object behind it,
 * and the two can diverge: relabelling the item in the module list moves one,
 * renaming the page or assignment itself moves the other. This tool's model is
 * that they are equal — push sends the same local `title` to the content
 * strategy and to `createModuleItem`, and pull reads the *content's* name back
 * into frontmatter — so both have to be watched. Hash only the item title and a
 * rename made in the Canvas page editor never registers as a remote change: the
 * local file disagrees with Canvas from that moment on, and nothing ever says
 * so. `content_title` is the object's own name under whatever key Canvas gives
 * it for that type, which is `CONTENT_TITLE_KEYS` below. The reference types
 * have no object behind them and so have no second title.
 *
 * **`position` is excluded on purpose, and of every exclusion here this is the
 * one that matters.** Ordering is reconciled separately, by a three-way
 * comparison of the base, local and Canvas sequences. Were `position` hashed,
 * moving a single item up a module would shift the position of every item below
 * it and mark all of them as changed on Canvas, and the next sync would pull the
 * whole module over the author's local copies. Before restoring the omission:
 * ordering is already reconciled, just not through the fingerprint.
 */
const CANVAS_FINGERPRINT_FIELDS = {
  page: [...COMMON_FIELDS, 'content_title', 'body'],
  assignment: [
    ...COMMON_FIELDS,
    'content_title',
    'description',
    'points_possible',
    'submission_types',
    'due_at',
    'unlock_at',
    'lock_at',
    'published',
  ],
  discussion: [
    ...COMMON_FIELDS,
    'content_title',
    'message',
    'discussion_type',
    'require_initial_post',
    'published',
    'delayed_post_at',
    'lock_at',
  ],
  // A quiz is a reference: sync owns the module item pointing at it and never
  // the quiz itself, so the common fields are the whole fingerprint.
  quiz: [...COMMON_FIELDS],
  // A text header is the module item and nothing else — Canvas gives it no
  // content object and no content id, so a title and an indent are not merely
  // all this tool manages, they are all there is. This project creates one for
  // every subfolder inside a module folder, so leaving it out of the table
  // makes an ordinary course read as full of types this version cannot
  // understand.
  sub_header: [...COMMON_FIELDS],
  external_url: [...COMMON_FIELDS, 'external_url', 'new_tab'],
  external_tool: [...COMMON_FIELDS, 'external_url', 'new_tab'],
  // Weaker than the rest by necessity, and `modified_at` rather than
  // `updated_at` on purpose: Canvas moves `updated_at` whenever it locks or
  // unlocks the file with its module. See `canvasFingerprint`.
  file: [...COMMON_FIELDS, 'content_title', 'modified_at', 'size'],
};

/**
 * A value Canvas simply reports, with an absent key and a null key made the
 * same. Canvas omits some keys and returns others as null for the same "no
 * value", and the difference is an artefact of which endpoint answered.
 */
function normaliseScalar(value) {
  return value === undefined ? null : value;
}

/**
 * A body, with a missing one and an empty one made the same: an empty page and a
 * page Canvas returned no body for are the same page.
 *
 * The HTML itself is deliberately untouched — no whitespace collapsing, no
 * re-serialising. Canvas rewrites markup it is handed often enough to make
 * normalising look attractive, but the invariant that handles that lives
 * elsewhere: the engine records `canvas_hash` from the API *response* to every
 * write, so whatever Canvas did to the markup is already baked into the stored
 * baseline. Normalising here would buy nothing and would hide real remote edits.
 */
function normaliseBody(value) {
  return value == null ? '' : String(value);
}

/**
 * A timestamp re-emitted from the instant it names, so two spellings of one
 * moment — `2026-01-01T10:00:00Z` and `2026-01-01T10:00:00.000Z` — hash the
 * same. Canvas is consistent about this today; re-emitting costs nothing and
 * closes a whole class of phantom change if it ever stops being.
 *
 * A value that will not parse is kept verbatim rather than thrown on. A
 * fingerprint is not a validator, and refusing to hash an item over one odd date
 * would take down a sync that has nothing else wrong with it.
 */
function normaliseDate(value) {
  if (value == null) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

/**
 * A real boolean, with `null` and an absent key both left as `null`.
 *
 * "Not set" and "set to false" are different states and the planner has to tell
 * them apart, so a missing value must not collapse into `false`. The string
 * check comes first because Canvas has returned these as strings and
 * `Boolean('false')` is `true` — which would read an unpublished item as
 * published.
 */
function normaliseBoolean(value) {
  if (value == null) return null;
  if (value === 'false' || value === '0') return false;
  return Boolean(value);
}

/**
 * An array Canvas treats as a set, sorted so the order it happened to arrive in
 * cannot register as a change. The copy is not incidental: the caller's array is
 * usually part of the live API response, and sorting in place would reorder data
 * the caller goes on to use.
 */
function normaliseSet(value) {
  if (value === undefined) return null;
  return Array.isArray(value) ? [...value].sort() : value;
}

/**
 * An indent, with an absent one read as 0 — which is what Canvas means by
 * omitting it. Anything that will not read as a finite number is kept verbatim,
 * on the same reasoning as an unparseable date.
 */
function normaliseIndent(value) {
  if (value == null) return 0;
  const number = Number(value);
  return Number.isFinite(number) ? number : value;
}

/**
 * What the object behind a module item calls its own name. Canvas never settled
 * on one word for it, so the key has to be looked up per type — which is why
 * `content_title` is the one field whose source key is not simply its own name.
 */
const CONTENT_TITLE_KEYS = {
  page: 'title',
  assignment: 'name',
  discussion: 'title',
  file: 'display_name',
};

/**
 * Where each field is read from, and how it is normalised.
 *
 * `item` is the module item (`GET /courses/:id/modules/:mid/items`), `content`
 * the object behind it. Canvas splits an item across the two, and which half
 * holds a field is not guessable: a file item's title lives on the module item,
 * its `modified_at` on the file.
 *
 * A field is read from the key of its own name unless the spec carries
 * `keyPerType`, which names the key to read for each type instead.
 */
const FIELD_SPECS = {
  title: { from: 'item', normalise: normaliseScalar },
  indent: { from: 'item', normalise: normaliseIndent },
  content_title: {
    from: 'content',
    keyPerType: CONTENT_TITLE_KEYS,
    // A scalar, not a body: an object Canvas returned no name for and one named
    // '' are not the same thing, so the missing one stays null.
    normalise: normaliseScalar,
  },
  external_url: { from: 'item', normalise: normaliseScalar },
  new_tab: { from: 'item', normalise: normaliseBoolean },
  body: { from: 'content', normalise: normaliseBody },
  description: { from: 'content', normalise: normaliseBody },
  message: { from: 'content', normalise: normaliseBody },
  points_possible: { from: 'content', normalise: normaliseScalar },
  submission_types: { from: 'content', normalise: normaliseSet },
  due_at: { from: 'content', normalise: normaliseDate },
  unlock_at: { from: 'content', normalise: normaliseDate },
  lock_at: { from: 'content', normalise: normaliseDate },
  delayed_post_at: { from: 'content', normalise: normaliseDate },
  published: { from: 'content', normalise: normaliseBoolean },
  discussion_type: { from: 'content', normalise: normaliseScalar },
  require_initial_post: { from: 'content', normalise: normaliseBoolean },
  modified_at: { from: 'content', normalise: normaliseDate },
  size: { from: 'content', normalise: normaliseScalar },
};

/**
 * Deterministic JSON: object keys sorted recursively, arrays kept in the order
 * given. Two payloads that differ only in the order their keys were assigned
 * serialise to the same string, which matters because a payload is assembled
 * from an API response whose key order is nobody's contract.
 *
 * Hand-written rather than pulled in: this repo has no test dependencies and a
 * deliberately small runtime set, and the whole requirement is a dozen lines.
 */
function canonicalJson(value) {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  const pairs = Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
  return `{${pairs.join(',')}}`;
}

/**
 * The canonical object `canvasFingerprint` hashes, before it is hashed.
 *
 * Exported alongside the hash because a hash tells you *that* something
 * differed and never *what*: a failing test compares payloads, and `status` can
 * show the author the field that moved.
 *
 * @param {object} sources
 * @param {object} sources.item - The Canvas **module item**, which carries
 *   `title`, `indent`, `external_url` and `new_tab`.
 * @param {object} [sources.content] - The object behind that item — the page,
 *   assignment, discussion or file, carrying its own name under a per-type key
 *   (`CONTENT_TITLE_KEYS`) along with its body and settings. Absent for the
 *   reference types, which have no object behind them.
 * @param {'page'|'assignment'|'discussion'|'quiz'|'sub_header'|'external_url'|'external_tool'|'file'} canvasType
 * @returns {object} Normalised, ready to serialise.
 * @throws {Error} On a type this version does not know.
 */
function canvasPayload(sources, canvasType) {
  if (!Object.hasOwn(CANVAS_FINGERPRINT_FIELDS, canvasType)) {
    throw new Error(
      `Cannot fingerprint a Canvas module item of type ` +
        `${JSON.stringify(canvasType)}: this version knows ` +
        `${Object.keys(CANVAS_FINGERPRINT_FIELDS).join(', ')}. An unrecognised ` +
        'type has to be reported and skipped, not hashed on its common fields ' +
        'and treated as understood — a fingerprint blind to whatever the type ' +
        'actually holds reads as "unchanged" after every edit made to it.',
    );
  }

  const from = {
    item: (sources && sources.item) || {},
    content: (sources && sources.content) || {},
  };

  const payload = {};
  for (const field of CANVAS_FINGERPRINT_FIELDS[canvasType]) {
    const spec = FIELD_SPECS[field];
    const sourceKey = spec.keyPerType ? spec.keyPerType[canvasType] : field;
    payload[field] = spec.normalise(from[spec.from][sourceKey]);
  }
  return payload;
}

/**
 * The `canvas_hash` of one Canvas item: sha256 of a canonical JSON of exactly
 * the fields this tool manages for that type.
 *
 * Only the owned fields, so that anything Canvas changes which this tool does
 * not manage never registers as a remote change. Canvas bumps an item's
 * `updated_at` for things this tool did not do — publishing the module it sits
 * in, for one. Under a bare `updated_at` check that reads as "Canvas changed",
 * so sync would pull, and a single publish click would silently reformat the
 * author's markdown back through Turndown. Hashing the owned fields alone makes
 * it a no-op.
 *
 * `file` is the weak one, and knowingly so: Canvas returns no content hash for a
 * stored file, so the fingerprint is `modified_at` plus `size`, and a
 * replacement that keeps the same size within the same second is invisible to
 * it. That is a real gap rather than a guarantee of the same strength as the
 * others.
 *
 * **`modified_at`, and never the file's `updated_at`**, which is the paragraph
 * above happening to a file. Canvas locks a file when the module it sits in, or
 * its own module item, is unpublished, and unlocks it on publish, and each lock
 * and unlock moves `updated_at`. Hashed, that made every file item in a module
 * read as changed on Canvas after one publish click, and the next pull or sync
 * downloaded every binary again. `modified_at` moves only when the file's
 * content is replaced: a same-name upload with `on_duplicate=overwrite` keeps
 * the file id and moves it, and the upload response already carries it, so the
 * baseline a push records holds the value every later read returns.
 *
 * @param {object} sources - `{ item, content }`; see `canvasPayload`.
 * @param {string} canvasType
 * @returns {string} sha256 hex.
 * @throws {Error} On a type this version does not know.
 */
function canvasFingerprint(sources, canvasType) {
  return hashText(canonicalJson(canvasPayload(sources, canvasType)));
}

/**
 * **Migration bridge, added in 1.5.2. Remove it in a major release, once every
 * course can be assumed to have synced on 1.5.2 or later.**
 *
 * The `canvas_hash` a `file` item was given up to 1.5.1, recomputed exactly:
 * `title`, `indent`, `content_title`, `updated_at` and `size`, normalised as
 * they were then. 1.5.2 swapped `updated_at` for `modified_at` (see
 * `canvasFingerprint`), which moves the stored hash of every file item in every
 * course. Without this, the first run after updating would read each one as
 * changed on Canvas, so a pull or a sync would download every binary again and
 * repoint any wrapper whose `file_ref` is not where a pull puts the file, a
 * push would report every one as left alone, and a file item deleted locally
 * would land under "Needs a decision" instead of being prunable.
 *
 * So `gatherCanvas` computes this beside the real fingerprint for a file item,
 * and `planKnownItem` in `lib/sync/plan.js` reads a row that still matches it
 * as unchanged on Canvas and plans a `refresh-base-hash` to record the new
 * formula. Nothing else may call it: it describes no Canvas object as this
 * version understands one, only what the previous version recorded.
 *
 * It cannot help a row whose file Canvas has locked or unlocked since that
 * row was recorded, because that moved `updated_at`, which is the defect
 * 1.5.2 fixes rather than a hazard of the upgrade. Such an item reads as
 * changed on Canvas once more, and is then recorded under the new formula.
 *
 * Spelled out field by field rather than through `FIELD_SPECS`, so that
 * `updated_at` never returns to the table every live fingerprint reads.
 *
 * @param {object} sources - `{ item, content }`, as `canvasPayload` takes them
 *   for a `file`.
 * @returns {string} sha256 hex.
 */
function legacyFileFingerprint(sources) {
  const item = (sources && sources.item) || {};
  const content = (sources && sources.content) || {};
  return hashText(
    canonicalJson({
      title: normaliseScalar(item.title),
      indent: normaliseIndent(item.indent),
      content_title: normaliseScalar(content.display_name),
      updated_at: normaliseDate(content.updated_at),
      size: normaliseScalar(content.size),
    }),
  );
}

/**
 * The Canvas timestamp an object is timed by: what the `newest` conflict
 * tiebreak compares against the local mtime, and what a row records as
 * `canvas_updated_at`.
 *
 * `updated_at` for every type but `file`, which is timed by `modified_at` for
 * the reason `canvasFingerprint` gives. The tiebreak has to read the clock the
 * fingerprint reads. A file whose module was published after a real conflict
 * began would otherwise look newer than it is, and a binary replaced here would
 * lose to the older one Canvas still holds. A file Canvas returned no
 * `modified_at` for falls back to `updated_at`, which times it as before rather
 * than not at all.
 *
 * A page has to keep `updated_at` whatever else changes here: the page
 * pre-filter in `lib/sync/gather.js` compares the stored `canvas_updated_at`
 * against the page list's `updated_at`, so the row has to hold that field.
 *
 * @param {object|null} content - The object behind the module item, as Canvas
 *   returned it.
 * @param {string} canvasType
 * @returns {string|null}
 */
function canvasTimestamp(content, canvasType) {
  if (!content) return null;
  if (canvasType === 'file' && content.modified_at) return content.modified_at;
  return content.updated_at || null;
}

/**
 * Whether fingerprinting this type costs a second request per item.
 *
 * True for `page` alone. The fetch loop reads it from here rather than
 * hardcoding it, so the price of a type is stated once:
 *
 * - **assignment** — `GET /courses/:id/assignments` returns `description` along
 *   with every owned field, so the list hashes for free.
 * - **discussion** — `GET /courses/:id/discussion_topics` returns `message` and
 *   the settings. Free as well.
 * - **page** — `GET /courses/:id/pages` omits `body`, so every candidate costs a
 *   `getPage`. Narrowing the candidate set — with `updated_at` as a pre-filter,
 *   or `include[]=body` where the instance honours it — is the caller's
 *   business, not this module's.
 * - **file** — the module item plus the file object from the list; no body to
 *   go and get.
 * - **quiz / sub_header / external_url / external_tool** — the module item is
 *   the whole thing, with no object behind it to fetch at all.
 *
 * An unknown type answers `false` rather than throwing: this is a question about
 * cost, and the engine reports and skips an unrecognised item long before it
 * would fetch anything for it. `canvasFingerprint` is the one that refuses.
 *
 * @param {string} canvasType
 * @returns {boolean}
 */
function needsContentFetch(canvasType) {
  return canvasType === 'page';
}

module.exports = {
  CANVAS_FINGERPRINT_FIELDS,
  REFERENCE_TYPES,
  canvasFingerprint,
  canvasPayload,
  canvasTimestamp,
  hashBinaryFile,
  hashLocalFile,
  hashText,
  // The 1.5.2 migration bridge; see its JSDoc before using it anywhere new.
  legacyFileFingerprint,
  needsContentFetch,
};
