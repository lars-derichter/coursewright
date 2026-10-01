const { toPosixPath } = require('./state');
const { CANVAS_FINGERPRINT_FIELDS, REFERENCE_TYPES } = require('./fingerprint');
const { detectRenames } = require('./rename-detect');

/**
 * The whole sync decision, as one pure function.
 *
 * Every hard question in this system is the same classification problem: given
 * what was true at the last sync, what is true in the working tree, and what is
 * true on Canvas, what should happen? It used to be answered in fragments
 * scattered through `cli/push.js` and `cli/pull.js`, tangled with the HTTP calls
 * that fetched the answer — which is why push once simply overwrote Canvas and
 * pull gated on file mtime. Neither was testable, so neither was ever tested, so
 * neither was right.
 *
 * Here the decision is one function of three plain-data inputs. No `fs`, no
 * `fetch`, no clock, no randomness: the caller gathers hashes, mtimes,
 * fingerprints and a per-file "does git hold uncommitted changes for this",
 * hands them in, and gets back a description of what should happen. It never
 * decides *how* — that is `lib/sync/apply.js` — and it never asks the author
 * anything.
 *
 * ## How `'ask'` stays pure
 *
 * The planner never prompts. When `policy.conflict === 'ask'` and an item
 * genuinely conflicts, the item lands in `pending.conflicts` and produces no
 * action. The command prompts the author and then **calls `plan()` again** with
 * the same three inputs and `policy.resolved.conflicts = { '01-intro/01-a.md':
 * 'local' }`. Same for ordering, keyed by module folder, and for a probable
 * rename, keyed by the path it came from.
 *
 * Re-planning is free — nothing has been fetched again — and it is what keeps
 * the whole thing a pure function of its inputs rather than a coroutine that
 * blocks on a terminal. It also means the second pass sees the *same* course it
 * decided about, so an answer cannot be applied to a state that has moved on.
 * A `resolved` answer wins over the policy for that item, whatever the policy
 * is.
 *
 * ## What comes back
 *
 * `actions` in execution order, plus one section per row of the report the
 * plan calls for, so the reporter (`buildReport` in `cli/sync.js`) is a renderer
 * over this object and nothing more. Every section is present and possibly
 * empty.
 *
 * `status` is not a separate code path: it is `plan()` with
 * `write: {canvas: false, local: false}`, which leaves `actions` empty and
 * every report section fully populated. What the policy forbids is never
 * emitted as an action but is always recorded in `withheld`, so a push can say
 * "Canvas changed here and I left it alone" instead of losing the fact.
 */

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/**
 * Which side each action writes to, which is the only thing `policy.write`
 * needs to know to suppress it.
 *
 * `'base'` is the sync state itself: a re-key or a dropped row changes no
 * content on either side, so it is allowed whenever the run writes anything at
 * all, and suppressed under `status`, which writes nothing. That includes
 * `refresh-base-hash`, which `push` and `pull` must carry out as surely as
 * `sync` does: it writes neither side, only the row.
 */
const ACTION_SIDES = {
  'create-canvas-module': 'canvas',
  'update-canvas-module': 'canvas',
  'delete-canvas-module': 'canvas',
  'create-canvas-item': 'canvas',
  'update-canvas-item': 'canvas',
  'move-canvas-item': 'canvas',
  'delete-canvas-item': 'canvas',
  'delete-canvas-file': 'canvas',
  'reorder-canvas-module': 'canvas',
  'create-local-module': 'local',
  'update-local-module': 'local',
  'delete-local-module': 'local',
  'create-local-item': 'local',
  'update-local-item': 'local',
  'delete-local-item': 'local',
  'reorder-local-module': 'local',
  'rekey-base': 'base',
  'link-base-module': 'base',
  'drop-base-row': 'base',
  'drop-base-module': 'base',
  'refresh-base-hash': 'base',
};

/**
 * The execution order, as ranks. Actions are sorted by rank and nothing else,
 * and the sort is stable, so within a rank they run in the order the planner
 * found them — modules in local order, items in module order.
 *
 * The rule, and it is the reason the list is ordered at all:
 *
 * - **Re-keys first.** The state has to name the paths the rest of the run
 *   talks about before the run starts.
 * - **A module's link with the modules.** Everything below it addresses Canvas
 *   by a module id, and a link is where a module the run adopted gets one.
 * - **Creates before reorders.** A reorder that names an item Canvas does not
 *   hold yet is meaningless, and Canvas would silently drop it.
 * - **Modules before the items inside them.** An item cannot be created in a
 *   module that does not exist.
 * - **Deletes last, items before modules.** A failed delete then cannot strand
 *   a create that was going to replace it, and deleting a module first would
 *   make every item delete inside it fail with a 404.
 *
 * `refresh-base-hash` runs last of all, after any write that re-records the
 * same row and any delete that removes it. Its executor changes the row only
 * while it still holds the hash the plan read, so a row a write has just
 * recorded, or a module delete has just taken with it, is left as that left it.
 *
 * `delete-canvas-file` shares the item deletes' rank rather than taking one of
 * its own. It has no ordering relationship with them — it names a Canvas file
 * id and reaches no module — but it must come after every write, because the
 * executor asks the state what still points at the file it is about to delete
 * and this run's own uploads have to be recorded by then. The sweep that emits
 * it runs after every module, and the sort is stable, so that is where they
 * land.
 */
const ACTION_RANK = {
  'rekey-base': 0,
  'create-canvas-module': 1,
  'create-local-module': 1,
  'link-base-module': 1,
  'update-canvas-module': 2,
  'update-local-module': 2,
  'create-canvas-item': 3,
  'create-local-item': 3,
  'update-canvas-item': 4,
  'update-local-item': 4,
  'move-canvas-item': 5,
  'reorder-canvas-module': 6,
  'reorder-local-module': 6,
  'delete-canvas-item': 7,
  'delete-canvas-file': 7,
  'delete-local-item': 7,
  'delete-canvas-module': 8,
  'delete-local-module': 8,
  'drop-base-row': 9,
  'drop-base-module': 9,
  'refresh-base-hash': 9,
};

const CONFLICT_POLICIES = new Set(['newest', 'local', 'canvas', 'ask']);
const ORDER_POLICIES = new Set(['local', 'canvas', 'ask', 'skip']);
const ADOPT_POLICIES = new Set(['local', 'canvas']);
const RESOLUTIONS = new Set(['local', 'canvas', 'skip']);

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

/** The module folder an item path belongs to: everything before the first slash. */
function folderOf(itemPath) {
  const slash = itemPath.indexOf('/');
  return slash === -1 ? '' : itemPath.slice(0, slash);
}

/** A module name as a pairing compares it: trimmed and case-folded. */
function comparableName(name) {
  return name == null ? '' : String(name).trim().toLowerCase();
}

/** Two path sequences, equal element for element. */
function sameSequence(left, right) {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

// ---------------------------------------------------------------------------
// Input normalisation
// ---------------------------------------------------------------------------

/**
 * The policy, with every default filled in and every unknown value refused.
 *
 * A misspelled policy has to be an error rather than a fallback: `--conflict
 * newst` silently becoming "skip everything" would look like a clean run that
 * reconciled nothing.
 *
 * `adopt` is a flag of its own rather than something read off `write`, and that
 * is deliberate. It looks derivable — adoption is safe exactly when one side is
 * pinned, which is what `push` and `pull` set `write` to — but `status`
 * previews `sync` with both write flags off, so `write.canvas && write.local`
 * would read as "pinned" there and quietly take the collision refusal out of
 * the one command whose whole job is to show it.
 *
 * `order` defaults to `'skip'` rather than `'ask'`, because asking has to be
 * opt-in. `'ask'` parks a contested order in `pending.order` for the caller to
 * put to the author, and a caller that never collects it leaves the author
 * reading "awaiting an answer" about a question nothing will ever pose. Only
 * `sync` asks, and it says so; `push`, `pull` and `status` take the default and
 * report the module as left alone.
 */
function normalisePolicy(policy = {}) {
  const write = policy.write || {};
  const resolved = policy.resolved || {};
  const conflict = policy.conflict || 'newest';
  const order = policy.order || 'skip';
  const adopt = policy.adopt ?? null;

  if (!CONFLICT_POLICIES.has(conflict)) {
    throw new Error(
      `Unknown conflict policy ${JSON.stringify(conflict)}; ` +
        `expected one of ${[...CONFLICT_POLICIES].join(', ')}.`,
    );
  }
  if (!ORDER_POLICIES.has(order)) {
    throw new Error(
      `Unknown order policy ${JSON.stringify(order)}; ` +
        `expected one of ${[...ORDER_POLICIES].join(', ')}.`,
    );
  }
  if (adopt !== null && !ADOPT_POLICIES.has(adopt)) {
    throw new Error(
      `Unknown adopt policy ${JSON.stringify(adopt)}; ` +
        `expected one of ${[...ADOPT_POLICIES].join(', ')}, or null to ` +
        'adopt nothing.',
    );
  }
  for (const [key, answer] of Object.entries(resolved.conflicts || {})) {
    if (!RESOLUTIONS.has(answer)) {
      throw new Error(
        `Unknown conflict answer ${JSON.stringify(answer)} for ${key}; ` +
          `expected one of ${[...RESOLUTIONS].join(', ')}.`,
      );
    }
  }
  for (const [key, answer] of Object.entries(resolved.order || {})) {
    if (!RESOLUTIONS.has(answer)) {
      throw new Error(
        `Unknown order answer ${JSON.stringify(answer)} for ${key}; ` +
          `expected one of ${[...RESOLUTIONS].join(', ')}.`,
      );
    }
  }

  return {
    write: { canvas: write.canvas !== false, local: write.local !== false },
    conflict,
    order,
    adopt,
    pruneCanvas: policy.pruneCanvas === true,
    pruneLocal: policy.pruneLocal === true,
    modules:
      Array.isArray(policy.modules) && policy.modules.length > 0
        ? new Set(policy.modules)
        : null,
    resolved: {
      conflicts: resolved.conflicts || {},
      order: resolved.order || {},
      renames: resolved.renames || {},
    },
  };
}

/** The base state, flattened into the two shapes the planner reads it in. */
function normaliseBase(base) {
  const modules = new Map();
  const rows = new Map();

  for (const [folder, entry] of Object.entries((base && base.modules) || {})) {
    if (!entry) continue;
    const order = (entry.item_order || []).map(toPosixPath);
    modules.set(folder, {
      folder,
      canvasModuleId: entry.canvas_module_id ?? null,
      name: entry.name ?? null,
      position: entry.position ?? null,
      order,
    });
    const items = entry.items || {};
    const seen = new Set();
    const push = (itemPath) => {
      const key = toPosixPath(itemPath);
      if (seen.has(key)) return;
      seen.add(key);
      rows.set(key, { itemPath: key, baseFolder: folder, row: items[key] });
    };
    // Ordered rows first, then any row the base order forgot, so the planner
    // reads a hand-edited state in a defined order too.
    for (const itemPath of order) {
      if (items[itemPath]) push(itemPath);
    }
    for (const itemPath of Object.keys(items)) push(itemPath);
  }

  return { modules, rows };
}

/** One item as the working tree holds it, with every field defaulted. */
function normaliseLocalItem(item, folder) {
  return {
    itemPath: toPosixPath(item.itemPath),
    folder,
    title: item.title ?? null,
    canvasType: item.canvasType ?? null,
    indent: item.indent ?? 0,
    position: item.position ?? 0,
    localHash: item.localHash ?? null,
    localMtimeMs: item.localMtimeMs ?? null,
    dirty: item.dirty === true,
    // The paths this one item embeds, and `null` for "the gather could not read
    // it, so nothing is known" — which is also what every caller written before
    // `hasEmbeddedBinaryChanged` hands over.
    embeds: Array.isArray(item.embeds) ? item.embeds : null,
  };
}

function normaliseLocal(local) {
  return ((local && local.modules) || []).map((module) => {
    const folder = module.folder;
    const items = (module.items || [])
      .map((item) => normaliseLocalItem(item, folder))
      .sort((a, b) => a.position - b.position);
    return {
      folder,
      name: module.name ?? null,
      position: module.position ?? 0,
      dirty: module.dirty === true,
      // Its `_category_.json` alone, which `dirty` above cannot stand in for:
      // that one is true for anything uncommitted anywhere under the folder,
      // and this guards a write to one file.
      categoryDirty: module.categoryDirty === true,
      items,
      byPath: new Map(items.map((item) => [item.itemPath, item])),
    };
  });
}

/**
 * One Canvas module item, normalised into the planner's own record so that
 * nothing here ever mutates the caller's data.
 *
 * `recognised` defaults to "is this a type `lib/sync/fingerprint.js` knows",
 * rather than to `true`. A caller that forgets the flag then gets the cautious
 * answer instead of one that fabricates a local file for a module item type
 * this version has never heard of.
 *
 * A text header (`sub_header`) is a recognised type like any other, and arrives
 * with a path like any other: its `suggestedPath` and the `itemPath` of its
 * base row are the subfolder that produced it, `01-introduction/theory`. The
 * planner needs nothing else about it — the caller owns that mapping.
 */
function normaliseCanvasItem(item, module) {
  const canvasType = item.canvasType ?? null;
  const recognised =
    item.recognised === undefined
      ? canvasType != null &&
        Object.hasOwn(CANVAS_FINGERPRINT_FIELDS, canvasType)
      : item.recognised === true;

  return {
    moduleItemId: item.moduleItemId ?? null,
    canvasType,
    rawType: item.rawType ?? null,
    canvasId: item.canvasId ?? null,
    pageUrl: item.pageUrl ?? null,
    title: item.title ?? null,
    indent: item.indent ?? 0,
    position: item.position ?? 0,
    canvasHash: item.canvasHash ?? null,
    canvasUpdatedAt: item.canvasUpdatedAt ?? null,
    // A file item only, and only for `isLegacyFileHash`.
    legacyCanvasHash: item.legacyCanvasHash ?? null,
    suggestedPath: item.suggestedPath ? toPosixPath(item.suggestedPath) : null,
    recognised,
    canvasModuleId: module.canvasModuleId ?? null,
  };
}

function normaliseCanvas(canvas) {
  return ((canvas && canvas.modules) || []).map((module) => {
    const record = {
      canvasModuleId: module.canvasModuleId ?? null,
      name: module.name ?? null,
      position: module.position ?? 0,
      suggestedFolder: module.suggestedFolder ?? null,
      // The failure message `gatherCanvas` recorded when Canvas would not list
      // this module's items, or null for a module that was read whole. It is
      // the one licence the wall in `planModule` checks.
      unreadable: module.unreadable ?? null,
      items: [],
    };
    // The flag wins over any item list handed in beside it. `gatherCanvas`
    // never produces both, but this is a pure function over caller-built data,
    // and items behind an unreadable module would leak past the wall through
    // the course-wide matching and rename detection, which run before any
    // module context exists to be walled.
    if (record.unreadable == null) {
      record.items = (module.items || [])
        .map((item) => normaliseCanvasItem(item, record))
        .sort((a, b) => a.position - b.position);
    }
    return record;
  });
}

// ---------------------------------------------------------------------------
// Matching base rows to Canvas items
// ---------------------------------------------------------------------------

/**
 * The identities one Canvas item answers to.
 *
 * A content item is found by its own id; a reference has no object behind it,
 * so the module item id is its whole identity. A page also answers to its URL,
 * because that is the one content id a Canvas author can change from the web
 * interface, and losing the row over it would duplicate the page.
 */
function canvasItemKeys(item) {
  const keys = [];
  if (item.moduleItemId != null) keys.push(`item:${item.moduleItemId}`);
  if (item.canvasId != null && item.canvasType) {
    keys.push(`${item.canvasType}:${item.canvasId}`);
  }
  if (item.canvasType === 'page' && item.pageUrl) {
    keys.push(`page-url:${item.pageUrl}`);
  }
  return keys;
}

/** The identities a base row looks its Canvas item up by, best first. */
function baseRowKeys(row) {
  const keys = [];
  const type = row.canvas_type;
  if (REFERENCE_TYPES.has(type)) {
    if (row.module_item_id != null) keys.push(`item:${row.module_item_id}`);
    if (row.canvas_id != null && type) keys.push(`${type}:${row.canvas_id}`);
    return keys;
  }
  if (row.canvas_id != null && type) keys.push(`${type}:${row.canvas_id}`);
  if (type === 'page' && row.page_url) keys.push(`page-url:${row.page_url}`);
  if (row.module_item_id != null) keys.push(`item:${row.module_item_id}`);
  return keys;
}

/**
 * Match every base row to the Canvas item it names, across the whole course
 * rather than within its module.
 *
 * Course-wide on purpose: an item dragged into another module in Canvas is
 * still the same object, and matching per module would read it as deleted here
 * and created there — which under `--prune-canvas` deletes the author's work
 * and creates a duplicate of it in one run.
 */
function matchBaseToCanvas(baseRows, canvasItems) {
  const byKey = new Map();
  for (const item of canvasItems) {
    for (const key of canvasItemKeys(item)) {
      if (!byKey.has(key)) byKey.set(key, item);
    }
  }

  const canvasOf = new Map();
  const basePathOf = new Map();
  const claimed = new Set();

  for (const entry of baseRows.values()) {
    if (!entry.row) continue;
    for (const key of baseRowKeys(entry.row)) {
      const candidate = byKey.get(key);
      if (!candidate || claimed.has(candidate)) continue;
      claimed.add(candidate);
      canvasOf.set(entry.itemPath, candidate);
      basePathOf.set(candidate, entry.itemPath);
      break;
    }
  }

  return { canvasOf, basePathOf, claimed };
}

// ---------------------------------------------------------------------------
// Module contexts
// ---------------------------------------------------------------------------

/**
 * Pair the modules neither side has a base row for, by name.
 *
 * Without a base row nothing links a local folder to a Canvas module, and the
 * honest default is to treat each as new. But after `reset-sync-state` against
 * a course that already holds a copy, *every* module looks new on both sides,
 * and "create both" duplicates the course. The name is the one signal left, so
 * it is used — and only when it is unambiguous on both sides, because a name
 * shared by two modules says nothing about which is which.
 *
 * A pairing is not an adoption on its own. When both sides of a paired module
 * hold items, the run refuses (see `collision`); when one side is empty, the
 * pairing is what stops a second copy of the module being created beside the
 * one that is already there.
 */
function pairUnbasedModules(unbasedLocal, unclaimedCanvas) {
  const bucket = (entries, nameOf) => {
    const map = new Map();
    for (const entry of entries) {
      const key = comparableName(nameOf(entry));
      if (key === '') continue;
      const list = map.get(key);
      if (list) list.push(entry);
      else map.set(key, [entry]);
    }
    return map;
  };

  const localByName = bucket(unbasedLocal, (m) => m.name || m.folder);
  const canvasByName = bucket(unclaimedCanvas, (m) => m.name);

  const pairs = new Map();
  for (const [name, locals] of localByName) {
    if (locals.length !== 1) continue;
    const remotes = canvasByName.get(name);
    if (!remotes || remotes.length !== 1) continue;
    pairs.set(locals[0].folder, remotes[0]);
  }
  return pairs;
}

/**
 * One module seen from all three sides at once, which is the unit everything
 * below reasons about.
 */
function buildModuleContexts(base, localModules, canvasModules) {
  const canvasById = new Map();
  for (const module of canvasModules) {
    if (module.canvasModuleId != null) {
      canvasById.set(String(module.canvasModuleId), module);
    }
  }

  const claimedCanvas = new Set();
  const canvasForFolder = new Map();
  for (const [folder, entry] of base.modules) {
    if (entry.canvasModuleId == null) continue;
    const module = canvasById.get(String(entry.canvasModuleId));
    if (module && !claimedCanvas.has(module)) {
      claimedCanvas.add(module);
      canvasForFolder.set(folder, module);
    }
  }

  const localByFolder = new Map(localModules.map((m) => [m.folder, m]));
  const unbasedLocal = localModules.filter((m) => !base.modules.has(m.folder));
  const unclaimedCanvas = canvasModules.filter((m) => !claimedCanvas.has(m));
  for (const [folder, module] of pairUnbasedModules(
    unbasedLocal,
    unclaimedCanvas,
  )) {
    claimedCanvas.add(module);
    canvasForFolder.set(folder, module);
  }

  const contexts = [];
  const seen = new Set();
  const add = (folder, canvasModule) => {
    contexts.push({
      folder,
      baseModule: folder != null ? base.modules.get(folder) || null : null,
      localModule: folder != null ? localByFolder.get(folder) || null : null,
      canvasModule: canvasModule || null,
      canvasModuleId: canvasModule ? canvasModule.canvasModuleId : null,
      baseRows: [],
      baseOrder: [],
      collided: false,
      remoteChanges: false,
      localChanges: false,
      localDirty: false,
      coveredOrphans: [],
    });
    if (folder != null) seen.add(folder);
  };

  // Local order first: it is the author's own view of their course, and the
  // report reads better for following it.
  for (const module of localModules) {
    if (seen.has(module.folder)) continue;
    add(module.folder, canvasForFolder.get(module.folder));
  }
  for (const folder of base.modules.keys()) {
    if (seen.has(folder)) continue;
    add(folder, canvasForFolder.get(folder));
  }
  for (const module of canvasModules) {
    if (claimedCanvas.has(module)) continue;
    const suggested = module.suggestedFolder;
    add(suggested && !seen.has(suggested) ? suggested : null, module);
  }

  return contexts;
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

function emptyReport() {
  return {
    actions: [],
    conflicts: [],
    skipped: [],
    adopted: [],
    orphans: { canvas: [], local: [] },
    decisions: [],
    unrecognised: [],
    ordering: [],
    pending: { conflicts: [], order: [], renames: [] },
    collision: null,
    withheld: [],
  };
}

/**
 * Emit an action, unless the policy forbids writing to that side — in which
 * case the fact is recorded in `withheld` rather than lost.
 *
 * @returns {boolean} Whether the action was emitted, so the caller can mark its
 *   report entry as applied or not.
 */
function emit(ctx, action) {
  const side = ACTION_SIDES[action.type];
  const allowed =
    side === 'base'
      ? ctx.policy.write.canvas || ctx.policy.write.local
      : ctx.policy.write[side];

  if (!allowed) {
    ctx.report.withheld.push({ ...action, side, reason: 'write-policy' });
    return false;
  }
  ctx.report.actions.push(action);
  return true;
}

// ---------------------------------------------------------------------------
// Conflict resolution
// ---------------------------------------------------------------------------

/**
 * Who wins when both sides of one item changed.
 *
 * `'newest'` compares the local file's mtime against Canvas's `updated_at`, or
 * against the Canvas file's `modified_at` for a `file` item (`canvasTimestamp`
 * in `lib/sync/fingerprint.js` says why). A missing or unparseable timestamp
 * means **local wins**: Canvas has not proved it is newer, and of the two
 * possible mistakes, pushing over a remote edit is the one git can undo. A tie
 * goes to local for the same reason.
 *
 * `untimedReason` is for a caller whose Canvas side was never timed at all, as
 * opposed to one whose timestamp Canvas failed to supply. The outcome is the
 * same local win; the explanation is not, and a caller with nothing to compare
 * must not tell the author their Canvas course returned bad data.
 *
 * @param {string} [untimedReason] Replaces the missing-`updated_at` reason, for
 *   a conflict whose Canvas side carries no timestamp to compare — the module
 *   name in `planModuleMetadata`, and the four types in `UNTIMED_ITEM_REASONS`.
 * @returns {{winner: 'local'|'canvas'|null, reason: string, pending: boolean, skipped: boolean}}
 */
function resolveConflict(
  ctx,
  key,
  localMtimeMs,
  canvasUpdatedAt,
  untimedReason,
) {
  const answer = ctx.policy.resolved.conflicts[key];
  if (answer === 'local' || answer === 'canvas') {
    return {
      winner: answer,
      reason: 'answered',
      pending: false,
      skipped: false,
    };
  }
  if (answer === 'skip') {
    return { winner: null, reason: 'answered', pending: false, skipped: true };
  }

  if (ctx.policy.conflict === 'local' || ctx.policy.conflict === 'canvas') {
    return {
      winner: ctx.policy.conflict,
      reason: `policy ${ctx.policy.conflict}`,
      pending: false,
      skipped: false,
    };
  }
  if (ctx.policy.conflict === 'ask') {
    return {
      winner: null,
      reason: 'awaiting an answer',
      pending: true,
      skipped: false,
    };
  }

  const canvasMs = canvasUpdatedAt == null ? NaN : Date.parse(canvasUpdatedAt);
  if (Number.isNaN(canvasMs)) {
    return {
      winner: 'local',
      reason:
        untimedReason ??
        'newest: Canvas gave no usable timestamp, so it cannot prove it is newer',
      pending: false,
      skipped: false,
    };
  }
  if (localMtimeMs == null) {
    return {
      winner: 'canvas',
      reason: 'newest: the local file gave no usable mtime',
      pending: false,
      skipped: false,
    };
  }
  if (canvasMs > localMtimeMs) {
    return {
      winner: 'canvas',
      reason: 'newest: Canvas',
      pending: false,
      skipped: false,
    };
  }
  return {
    winner: 'local',
    reason: 'newest: local',
    pending: false,
    skipped: false,
  };
}

/**
 * Why `newest` could not time an item of this type, for the types whose module
 * item is the whole of what syncs.
 *
 * `gather` records no `canvasUpdatedAt` for any of them — its `REFERENCE_TYPES`
 * branch returns the module item and asks Canvas nothing further — so every one
 * of them lands in `resolveConflict`'s untimed branch and would otherwise be
 * told "Canvas gave no usable timestamp". That sentence says Canvas failed to
 * supply something it holds, and it is false for all four. It stays exactly
 * right for `page`, `assignment`, `discussion` and `file`, where Canvas really
 * did return an `updated_at` (a `modified_at`, for a file) this run could not
 * read, and those types find nothing here on purpose.
 *
 * One fact underneath all four: **Canvas keeps no timestamp on a module item**,
 * and a module item is the whole of what these four types sync. Nothing here
 * describes a fetch that was skipped, and no wording may suggest one — an author
 * sent looking for a flag that would settle the conflict is as badly served as
 * one sent looking for a Canvas fault.
 *
 * Two shapes all the same, because *what* is untimed differs and the sentence
 * has to name it:
 *
 * - **The item is the thing.** A text header points at nothing at all and an
 *   external URL points out of Canvas, so the item is the whole object and it
 *   is the object that carries no timestamp. Structural, the way a module name
 *   is in `planModuleMetadata` — with one difference that keeps the wording
 *   apart from that one's: an item has a real local mtime (`_category_.json`
 *   for a header, the file for a link), so the absence is on the Canvas side
 *   alone and "on either side" would be untrue here.
 * - **The item is a place, and the place is what is untimed.** A quiz and an
 *   LTI tool are pointed at rather than held, so what syncs is the module item
 *   pointing there and the reason names that rather than the thing pointed at.
 *   Fetching the thing pointed at would settle nothing, and two separate facts
 *   say so. A Classic Quiz object carries no `updated_at` or `created_at` at
 *   all, so "never reads a quiz's timestamp" would invent one. A
 *   `ContextExternalTool` does carry both, but they time the *installation* —
 *   frequently account-level and shared across every course using it — while
 *   every field in this conflict is read off the module item:
 *   `CANVAS_FINGERPRINT_FIELDS.external_tool` is `title`, `indent`,
 *   `external_url` and `new_tab`, and `FIELD_SPECS` marks all four
 *   `from: 'item'` (`lib/sync/fingerprint.js`).
 *
 * Keyed by `canvas_type`. `REFERENCE_TYPES` in `lib/sync/fingerprint.js` is the
 * authority on which types belong here, and the test suite walks that set so a
 * fifth one cannot arrive without a sentence of its own.
 *
 * A `Map` rather than an object literal, because the key is read straight off a
 * base row and `.canvas-sync.json` is a committed file an author can edit by
 * hand: a `canvas_type` of `constructor` looks up an inherited function on a
 * plain object, and this value goes into a line of the report.
 */
const UNTIMED_ITEM_REASONS = new Map([
  [
    'sub_header',
    'newest: Canvas keeps no timestamp on a text header, so it cannot prove ' +
      'it is newer',
  ],
  [
    'external_url',
    'newest: Canvas keeps no timestamp on an external URL, so it cannot ' +
      'prove it is newer',
  ],
  [
    'quiz',
    'newest: a quiz syncs as its place in the module, and Canvas keeps no ' +
      'timestamp on that, so it cannot prove it is newer',
  ],
  [
    'external_tool',
    'newest: an LTI tool syncs as its place in the module, and Canvas keeps ' +
      'no timestamp on that, so it cannot prove it is newer',
  ],
]);

/**
 * Whether this run would really carry out an action of this type, which is the
 * question every refusal below has to ask before it records one.
 *
 * A skip means "this run wanted to do something and would not": it carries a
 * remedy, and it fails the run. Under a pinned direction `emit` suppresses
 * every write to the other side regardless, so a skip recorded for one of those
 * tells the author to repair a write the command was never going to make, and
 * fails the run over it. Those belong in `withheld`, which is where `emit` puts
 * them once the refusal declines to intervene.
 *
 * Named once rather than repeated, because repeating it is how it went missing:
 * the rule arrived with `guardDirty`, and the two other refusals that name a
 * concrete action — the type-changed one below and the module-level twin of
 * `guardDirty` in `planModuleOrphan` — each went without it. A refusal whose
 * `action` is null is a different thing and must not use this: nothing was
 * going to be emitted on either side, so there is nothing for `withheld` to
 * receive and the skip is the only place the fact can live.
 */
function writeLands(ctx, actionType) {
  const side = ACTION_SIDES[actionType];
  return !side || ctx.policy.write[side] === true;
}

/**
 * Whether this run writes to neither side, which is `status` and nothing else.
 *
 * The companion to `writeLands`, and deliberately narrow. `writeLands` answers
 * "would this run really do it", which is the right question for a refusal that
 * protects a write. It is the wrong one for a refusal that describes the Canvas
 * course rather than this run's writes: `status` makes no writes at all, so
 * `writeLands` is false for every one of them, and a run whose only output is a
 * report would then have to leave the fact out of the report. Preview or not, a
 * `sync` over this course refuses — and saying so is the whole of what `status`
 * is for.
 *
 * Not a general licence to record every skip under `status`. `guardDirty` and
 * the module-level twin of it stay gated on `writeLands`, because "committing
 * this file would let the write through" is a claim about a write, and `status`
 * makes none.
 */
function writesNothing(ctx) {
  return ctx.policy.write.canvas !== true && ctx.policy.write.local !== true;
}

/**
 * The refusal that protects a local file whose current contents exist nowhere
 * else.
 *
 * Git is the undo for this whole system, so a write onto a file with
 * uncommitted changes destroys the only copy of them. It applies to every write
 * into the working tree, including one the author's own conflict answer asked
 * for, and never to a write to Canvas — Canvas is not where the undo lives.
 *
 * **A write the policy already forbids is not guarded, it is withheld** — see
 * `writeLands`.
 */
function guardDirty(ctx, localItem, action, what) {
  if (!localItem || !localItem.dirty) return false;
  if (!writeLands(ctx, action.type)) return false;
  ctx.report.skipped.push({
    kind: 'item',
    reason: 'git-dirty',
    moduleFolder: localItem.folder,
    itemPath: localItem.itemPath,
    action: action.type,
    remedy:
      `${localItem.itemPath} has uncommitted changes; ${what} would be the ` +
      'only copy of them gone. Commit or stash the file, then run sync again.',
  });
  return true;
}

/**
 * The same refusal for the one file `update-local-module` writes.
 *
 * That action rewrites `<folder>/_category_.json` and nothing else, so it is
 * that file the question has to be about — not the folder. The module-level
 * flag beside it is deliberately not used here: `gitDirtyPaths` adds every
 * ancestor of a dirty path, so a folder reads dirty for one uncommitted lesson
 * anywhere under it, and a guard resting on that would refuse to relabel any
 * module the author happens to be working in. The narrow flag is `gatherLocal`'s
 * `categoryDirty`, which asks about the file by name.
 *
 * `writeLands` for the reason it exists: under `push` the action is withheld
 * rather than emitted, so a skip here would tell the author to repair a write
 * the command was never going to make, and fail the run over it.
 */
function guardCategoryDirty(ctx, folder, localModule, actionType) {
  if (!localModule || !localModule.categoryDirty) return false;
  if (!writeLands(ctx, actionType)) return false;
  ctx.report.skipped.push({
    kind: 'module',
    reason: 'git-dirty',
    moduleFolder: folder,
    action: actionType,
    remedy:
      `${folder}/_category_.json has uncommitted changes, and the Canvas name ` +
      'is written into it; that would be the only copy of them gone. Commit ' +
      'or stash the file, then run again.',
  });
  return true;
}

/**
 * Which refusal, if any, was recorded while a conflict's winning write was
 * being planned.
 *
 * A conflict entry's `applied: false` has two unrelated causes behind it, and
 * the report has to tell them apart. Either the policy pinned the direction and
 * `emit` withheld the write — in which case "run `npx course sync` to settle
 * it" is exactly right, because sync writes to both sides — or a guard refused
 * it, in which case that advice is the one thing that cannot help: sync meets
 * the same guard and refuses again. The guard has already written the real
 * remedy into `skipped`, so the conflict line's job is to point at it rather
 * than contradict it two lines further down the same section.
 *
 * Read off the skip list rather than threaded back through the planners,
 * because every refusal on that path already records one and returns:
 * `guardDirty`, `guardCategoryDirty`, and the type-changed refusal inside
 * `planCanvasUpdate`. A fourth gets this without being told.
 *
 * @param {object} ctx
 * @param {number} mark - `ctx.report.skipped.length` before the write was
 *   planned.
 * @returns {string|null} The `reason` of the refusal, or null if there was none.
 */
function refusalSince(ctx, mark) {
  const recorded = ctx.report.skipped.slice(mark);
  return recorded.length > 0 ? recorded[recorded.length - 1].reason : null;
}

// ---------------------------------------------------------------------------
// Item planning
// ---------------------------------------------------------------------------

/**
 * Whether a side moved since the last sync, with every unknown resolved the
 * same way: **towards local being the truth.**
 *
 * A base row with no `local_hash` reads as changed locally, so the item is
 * pushed and the fingerprint recorded — which is what makes a row repaired by
 * hand, to adopt an existing Canvas object, do something. A base row with no
 * `canvas_hash`, or a Canvas item whose fingerprint could not be computed,
 * reads as *unchanged* remotely, because an unknown must never be grounds for
 * overwriting a local file. Both unknowns therefore point the same way: towards
 * the side git can undo.
 */
function hasLocalChanged(row, localItem) {
  if (!localItem || localItem.localHash == null) return false;
  if (row.local_hash == null) return true;
  return localItem.localHash !== row.local_hash;
}

function hasCanvasChanged(row, canvasItem) {
  if (!canvasItem || canvasItem.canvasHash == null) return false;
  if (row.canvas_hash == null) return false;
  return canvasItem.canvasHash !== row.canvas_hash;
}

/**
 * **Migration bridge, added in 1.5.2, and it goes with `legacyFileFingerprint`
 * in `lib/sync/fingerprint.js`.** Whether a file item's row was recorded under
 * the 1.5.1 formula and Canvas still holds exactly what it described.
 *
 * Such a row differs from the live `canvasHash` only because the formula
 * changed, so `hasCanvasChanged` answers true about a file nobody touched. The
 * caller reads it as unchanged instead and has `planHashRefresh` record the new
 * hash. A row recorded on 1.5.2 or later never matches, because the two
 * formulas hash different payloads.
 */
function isLegacyFileHash(row, canvasItem) {
  return (
    row.canvas_type === 'file' &&
    canvasItem != null &&
    canvasItem.canvasType === 'file' &&
    canvasItem.canvasHash != null &&
    canvasItem.legacyCanvasHash != null &&
    row.canvas_hash != null &&
    row.canvas_hash === canvasItem.legacyCanvasHash
  );
}

/**
 * Record a file item's fingerprint under the 1.5.2 formula, in place of the
 * 1.5.1 one `isLegacyFileHash` recognised, and touch nothing else.
 *
 * Bookkeeping on the `base` side, so `emit` lets it through under `sync`,
 * `push` and `pull` alike and withholds it only under `status`, and the report
 * never counts it: nothing changed on either side, and a run that said "1 row
 * refreshed" for every file item would read as one that did something.
 *
 * `legacyHash` is what the row held when this run read it. The executor writes
 * only while the row still holds it, so an upload or a pull that records the
 * row later in the same run, or a module delete that removes it, wins.
 */
function planHashRefresh(ctx, mc, itemPath, row, canvasItem) {
  emit(ctx, {
    type: 'refresh-base-hash',
    folder: mc.folder,
    itemPath,
    legacyHash: row.canvas_hash,
    canvasHash: canvasItem.canvasHash,
    canvasUpdatedAt: canvasItem.canvasUpdatedAt,
  });
}

/**
 * Whether the item's title moved on the local side, which no hash can answer.
 *
 * A title comes from frontmatter `title:` or, failing that, from the filename
 * (`displayTitle` in `lib/convert/course-scanner.js`). Only the first of those
 * is inside `local_hash`. Renaming a file whose title is derived from its name
 * therefore moves the title and not the fingerprint, and the three shapes that
 * take that route are a bare binary, a `file` wrapper, and a markdown item
 * carrying no `title:`. Creating the Canvas object for an item writes one
 * (`writeTitleIfAbsent` in `lib/sync/apply.js`), and so does adopting an
 * existing one (`writeAdoptedTitle`, from the update handler), so the third
 * shape is an item neither has reached yet — or one whose frontmatter that
 * write had to leave alone.
 *
 * **Putting the title into `local_hash` instead is not the fix, and would break
 * the case it is meant to serve.** Rename detection pairs a vanished path with
 * a new one by that hash (`lib/sync/rename-detect.js`), so a hash that moved for
 * a rename alone turns every re-key into a delete plus a create — and it would
 * move the fingerprint of every item in every existing state file besides.
 *
 * The comparison is against the base row rather than against the live Canvas
 * title, for the reason every other comparison here is: the question is "did my
 * side move since the last sync", and the row is the only thing that records
 * where it was. A Canvas-side rename needs no help from this — `title` is in
 * `CANVAS_FINGERPRINT_FIELDS` for every type, so it already reads as a remote
 * change.
 *
 * **A row that records no title concludes nothing.** Reading that silence as
 * "the title changed" would plan an update for every item in the course on the
 * first run after an upgrade, and for the three authored types that update
 * rewrites the Canvas object. The row gains a title the next time anything else
 * about the item is written, and the question is asked again then.
 */
function hasTitleChanged(row, localItem) {
  if (!localItem || localItem.title == null) return false;
  if (row.title == null) return false;
  return String(localItem.title) !== String(row.title);
}

/**
 * Whether the item's indent moved on the local side, which no hash covers
 * either.
 *
 * An indent is not authored, it is read off the item's own path: a file sitting
 * directly in a module folder is indent 0, a file inside a subfolder of one is
 * indent 1, and that is the whole rule (`scanSubfolderItems` in
 * `lib/convert/course-scanner.js`). So dragging `01-intro/03-notes.md` into
 * `01-intro/theory/` without renaming it moves the indent and nothing else. The
 * bytes are the same, so `local_hash` does not move; the basename is the same,
 * so the derived title does not move and `hasTitleChanged` above does not fire.
 * The re-key lands, the text header for the subfolder is created, and the page
 * keeps indent 0 — sitting beside the header it now belongs under instead of
 * beneath it.
 *
 * A move that also crossed modules is a different action and already had one:
 * `move-canvas-item` is emitted above and sends the new indent itself. This is
 * the same-module case, which nothing reached.
 *
 * **The comparison is against the base row, and reading the base indent off the
 * live Canvas item instead does not work.** It looks as though it should:
 * `indent` is in `COMMON_FIELDS` of the Canvas fingerprint, so within this
 * branch `!canvasChanged` ought to prove `canvasItem.indent` is the indent the
 * last sync left there. It proves neither half of that.
 *
 * - `hasCanvasChanged` answers false for a row holding no `canvas_hash` at all,
 *   so "Canvas is where I left it" and "nothing recorded where I left it" are
 *   one answer there — the distinction this whole file is built on collapses.
 * - Worse, on the commonest type the answer is true by construction. A page
 *   whose `updated_at` and title still match its row is never fetched again:
 *   `fingerprintCanvasItem` copies `row.canvas_hash` onto the live item
 *   verbatim (`lib/sync/gather.js`), while the `indent` beside it is read live
 *   off the module item every time. `canvasItem.canvasHash === row.canvas_hash`
 *   is then guaranteed and says nothing whatever about the indent it was
 *   supposed to vouch for. That file names this gap in so many words.
 *
 * **A row that records no indent concludes nothing**, for the reason the title
 * gives above: a state file written before this holds none, and reading that
 * silence as "the indent moved" would plan an update for every item in every
 * course on the first run after an upgrade. The row gains one the next time
 * anything about the item is written, and the question is asked again then.
 *
 * The local side cannot be silent in the same way and is not guarded for it:
 * `normaliseLocalItem` reads an absent indent as 0, which is exactly what an
 * item at the top of its module has.
 */
function hasIndentChanged(row, localItem) {
  if (!localItem || row.indent == null) return false;
  return Number(localItem.indent ?? 0) !== Number(row.indent);
}

/**
 * The three types whose Canvas object has a body, and so the only three that
 * can embed a binary at all. A quiz, a text header and the two link types are
 * module items pointing at something; there is no markdown of theirs to render
 * and no upload to make. A `file` wrapper is markdown, but push sends the
 * binary its `file_ref` names and never the stub, so an image written into that
 * stub reaches nothing — and planning an update for one would be a decision the
 * executor cannot carry out, which is the invariant `lib/sync/fingerprint.js`
 * opens with: the item would report as changed on every run for ever.
 */
const EMBEDDING_TYPES = new Set(['page', 'assignment', 'discussion']);

/**
 * Whether a binary this item embeds was edited in place, which the item's own
 * hash cannot answer either.
 *
 * Open `_files/diagram.png`, redraw it, save, and the page around it is byte
 * for byte what it was: `local_hash` does not move, nothing is planned, and
 * Canvas goes on serving the old image. The upload itself was never the
 * problem — `uploadEmbeddedFiles` in `lib/sync/apply.js` compares the same two
 * hashes this does and re-uploads on a difference — but it runs inside
 * `writeContent`, which runs only when an `update-canvas-item` was planned
 * already. So a redrawn image went up when its page happened to be pushed for
 * some other reason, and never on its own. This is what plans that push.
 *
 * **The binary's hash must not join the page's `local_hash`**, which is what
 * `fileItemHash` does for a `file` wrapper and is right there and wrong here. A
 * wrapper *is* its binary — the stub is addressing, and the bytes are the whole
 * of what Canvas is sent. A page is not: its body is content in its own right,
 * the image is one thing inside it, and folding the two together would make an
 * image edit indistinguishable from a body edit. Canvas editing the body while
 * the author redraws the image would then read as both sides changing and put
 * the conflict machinery in front of an author who has nothing to choose
 * between. It would also move the fingerprint of every page in every state file
 * in existence, so the first run after the upgrade would rewrite the whole
 * course. The comparison belongs here, where it can be answered without moving
 * anything.
 *
 * **Three silences, and each one means "conclude nothing".**
 *
 * - **No hash map** — a gather that could not prove the tree whole, a `local`
 *   that predates this, or a hand-built one in a test. `plan` resolves all
 *   three to null before anything here runs.
 * - **`embeds` absent on the item** — the gather could not read that item, so
 *   what it points at is unknown. This is `complete`'s per-item half, and it is
 *   the precise form of it: the flag is about the tree, this is about the one
 *   item whose answer is actually being used.
 * - **A `null` hash, or a `state.files` row with no `sha256`** — the binary
 *   could not be read, or the state never recorded what it was. Neither is
 *   evidence that anything moved, and `uploadEmbeddedFiles` skips both too, so
 *   claiming a change here would plan a push the run cannot honour.
 *
 * A row missing altogether is the same silence, deliberately. It means the
 * binary was never uploaded under that path — a reference the author added
 * before the file existed, or an upload that failed — and repairing that is a
 * different question from "did this image change", asked and answered by the
 * push this item will get the next time anything else about it moves.
 */
function hasEmbeddedBinaryChanged(ctx, row, localItem) {
  if (!EMBEDDING_TYPES.has(row.canvas_type)) return false;
  if (!ctx.embeddedHashes || !localItem || !Array.isArray(localItem.embeds)) {
    return false;
  }
  for (const ref of localItem.embeds) {
    const now = ctx.embeddedHashes.get(ref);
    if (now == null) continue;
    const recorded = ctx.baseFiles[ref];
    if (!recorded || recorded.sha256 == null) continue;
    if (recorded.sha256 !== now) return true;
  }
  return false;
}

/** The 1-based slot an item sits in within its module's local order. */
function localPositions(localModule) {
  const positions = new Map();
  if (!localModule) return positions;
  localModule.items.forEach((item, index) => {
    positions.set(item.itemPath, index + 1);
  });
  return positions;
}

/**
 * Push the local file's content up to the Canvas object it is already tied to.
 *
 * `contentUnchanged` is a statement of fact rather than an instruction: the
 * planner proved `local_hash` did not move, so whatever this item would send is
 * byte for byte what Canvas was sent last time. Only the executor's `file`
 * branch acts on it, and only because that one branch is expensive and
 * destructive — Canvas keys an upload on the filename, so re-uploading a
 * renamed binary comes back with a *new* file id, and the cleanup then deletes
 * the file every student's existing link points at. The three authored types
 * are left to write their content as they always have: their title lives on the
 * object as well as on the module item (`content_title` in
 * `lib/sync/fingerprint.js`), and a module-item PUT alone would leave a page
 * called one thing in the module list and another on the page itself — which
 * the next pull would then read back over the author's file.
 */
function planCanvasUpdate(
  ctx,
  mc,
  itemPath,
  row,
  localItem,
  canvasItem,
  { contentUnchanged = false } = {},
) {
  const action = {
    type: 'update-canvas-item',
    folder: mc.folder,
    canvasModuleId: mc.canvasModuleId,
    itemPath,
    title: localItem.title,
    canvasType: row.canvas_type,
    canvasId: row.canvas_id ?? null,
    pageUrl: row.page_url ?? null,
    moduleItemId: canvasItem
      ? canvasItem.moduleItemId
      : (row.module_item_id ?? null),
    indent: localItem.indent,
    localHash: localItem.localHash,
    ...(contentUnchanged ? { contentUnchanged: true } : {}),
  };

  // The author changed `canvas_type` in frontmatter. Pushing a page's body into
  // an assignment is not an update, it is a different object — so this stops
  // and says so rather than writing content into the wrong shape.
  //
  // Only where the update is a write this run makes: under `pull` it is
  // withheld whatever the frontmatter says, and the refusal would then be
  // telling the author to repair a Canvas write pull does not make. Same rule
  // as `guardDirty`, and `emit` below records the fact in `withheld` instead.
  if (
    localItem.canvasType &&
    localItem.canvasType !== row.canvas_type &&
    writeLands(ctx, action.type)
  ) {
    ctx.report.skipped.push({
      kind: 'item',
      reason: 'type-changed',
      moduleFolder: mc.folder,
      itemPath,
      action: action.type,
      remedy:
        `${itemPath} is a ${row.canvas_type} on Canvas but its frontmatter now ` +
        `says ${localItem.canvasType}. Changing the type means a new Canvas ` +
        'object: delete the item and add it again, or put the original type back.',
    });
    return false;
  }

  return emit(ctx, action);
}

/** Bring the local file in line with what Canvas holds. */
function planLocalUpdate(ctx, mc, itemPath, row, localItem, canvasItem) {
  const action = {
    type: 'update-local-item',
    folder: mc.folder,
    canvasModuleId: mc.canvasModuleId,
    itemPath,
    title: canvasItem.title,
    canvasType: canvasItem.canvasType,
    canvasId: canvasItem.canvasId,
    pageUrl: canvasItem.pageUrl,
    moduleItemId: canvasItem.moduleItemId,
    indent: canvasItem.indent,
    canvasHash: canvasItem.canvasHash,
    canvasUpdatedAt: canvasItem.canvasUpdatedAt,
  };
  if (
    guardDirty(ctx, localItem, action, 'writing the Canvas version over it')
  ) {
    return false;
  }
  return emit(ctx, action);
}

/**
 * The one item this whole module exists for: base row, local file and Canvas
 * item, and what should happen to them.
 */
function planKnownItem(ctx, mc, entry, localItem, canvasItem, positions) {
  const { itemPath, row } = entry;

  // yes / gone / gone — converged. Both sides did the same thing, so there is
  // nothing to do and nothing worth telling the author; only the row is stale.
  if (!localItem && !canvasItem) {
    emit(ctx, { type: 'drop-base-row', folder: mc.folder, itemPath });
    return;
  }

  const localChanged = hasLocalChanged(row, localItem);
  // The 1.5.2 migration bridge. A file item's row recorded under the 1.5.1
  // formula that still describes Canvas is unchanged there, and every branch
  // below that keeps the row has `planHashRefresh` record it anew.
  const legacyHash = isLegacyFileHash(row, canvasItem);
  const canvasChanged = !legacyHash && hasCanvasChanged(row, canvasItem);

  if (localItem && canvasItem) {
    // First, because every branch of this one keeps the row, and several
    // return early. A write later in the run that records the row itself wins
    // over it; see `planHashRefresh`.
    if (legacyHash) planHashRefresh(ctx, mc, itemPath, row, canvasItem);

    if (canvasItem.canvasModuleId !== mc.canvasModuleId) {
      // The local path decides which module an item belongs to, because that
      // path is the key of its row. A Canvas-side move is therefore reported
      // and undone rather than followed; under `pull` the write is withheld and
      // named, so nothing reverts silently.
      emit(ctx, {
        type: 'move-canvas-item',
        itemPath,
        fromFolder: entry.baseFolder,
        toFolder: mc.folder,
        fromCanvasModuleId: canvasItem.canvasModuleId,
        toCanvasModuleId: mc.canvasModuleId,
        moduleItemId: canvasItem.moduleItemId,
        canvasType: row.canvas_type,
        canvasId: row.canvas_id ?? null,
        title: localItem.title,
        indent: localItem.indent,
        position: positions.get(itemPath) ?? null,
      });
    }

    if (!localChanged && !canvasChanged) {
      // Neither side's content moved — and this is the one branch the three
      // local changes no fingerprint covers can hide in. Every other branch
      // below already plans a write that carries all three with it, so this is
      // the whole of the hole. One update settles any of them: the title and
      // the indent both ride on the module item, and the push re-uploads
      // whatever the body embeds.
      if (
        hasTitleChanged(row, localItem) ||
        hasIndentChanged(row, localItem) ||
        hasEmbeddedBinaryChanged(ctx, row, localItem)
      ) {
        planCanvasUpdate(ctx, mc, itemPath, row, localItem, canvasItem, {
          contentUnchanged: true,
        });
        mc.localChanges = true;
      }
      return;
    }
    if (localChanged && !canvasChanged) {
      planCanvasUpdate(ctx, mc, itemPath, row, localItem, canvasItem);
      mc.localChanges = true;
      return;
    }
    if (!localChanged && canvasChanged) {
      planLocalUpdate(ctx, mc, itemPath, row, localItem, canvasItem);
      mc.remoteChanges = true;
      return;
    }

    mc.localChanges = true;
    mc.remoteChanges = true;
    // The row's type, not the local file's: the row is what says which Canvas
    // object this item is, and the frontmatter disagreeing with it is a refusal
    // one branch further on rather than a different conflict. `undefined` for
    // the four content types, which is what leaves `resolveConflict`'s own
    // wording in place — and that wording is right for exactly those four.
    const outcome = resolveConflict(
      ctx,
      itemPath,
      localItem.localMtimeMs,
      canvasItem.canvasUpdatedAt,
      UNTIMED_ITEM_REASONS.get(row.canvas_type),
    );
    if (outcome.pending) {
      ctx.report.pending.conflicts.push({
        kind: 'item',
        moduleFolder: mc.folder,
        itemPath,
        title: localItem.title ?? canvasItem.title,
        canvasType: row.canvas_type,
        localMtimeMs: localItem.localMtimeMs,
        canvasUpdatedAt: canvasItem.canvasUpdatedAt,
      });
      return;
    }
    if (outcome.skipped) {
      ctx.report.skipped.push({
        kind: 'item',
        reason: 'conflict-unresolved',
        moduleFolder: mc.folder,
        itemPath,
        action: null,
        remedy:
          `Both sides of ${itemPath} changed and no winner was chosen. Run ` +
          'again with --conflict local or --conflict canvas, or bring one side ' +
          'back in line by hand.',
      });
      return;
    }

    const mark = ctx.report.skipped.length;
    const applied =
      outcome.winner === 'local'
        ? planCanvasUpdate(ctx, mc, itemPath, row, localItem, canvasItem)
        : planLocalUpdate(ctx, mc, itemPath, row, localItem, canvasItem);
    ctx.report.conflicts.push({
      kind: 'item',
      moduleFolder: mc.folder,
      itemPath,
      title: localItem.title ?? canvasItem.title,
      canvasType: row.canvas_type,
      winner: outcome.winner,
      reason: outcome.reason,
      localMtimeMs: localItem.localMtimeMs,
      canvasUpdatedAt: canvasItem.canvasUpdatedAt,
      applied,
      refusal: refusalSince(ctx, mark),
    });
    return;
  }

  if (!localItem && canvasItem) {
    if (canvasChanged) {
      // yes / gone / changed — either choice loses something, so neither is made.
      mc.remoteChanges = true;
      ctx.report.decisions.push({
        kind: 'local-deleted-canvas-changed',
        moduleFolder: mc.folder,
        itemPath,
        title: canvasItem.title,
        canvasType: canvasItem.canvasType,
        canvasId: canvasItem.canvasId,
        moduleItemId: canvasItem.moduleItemId,
        summary:
          `${itemPath} was deleted here, and the Canvas copy has changed since ` +
          'the last sync. Deleting it would discard that work; restoring the ' +
          'file would discard the deletion.',
      });
      return;
    }

    // yes / gone / unchanged — an orphan, and orphans are never deleted without
    // being asked for.
    const orphan = {
      kind: 'item',
      moduleFolder: mc.folder,
      itemPath,
      title: canvasItem.title ?? row.title ?? null,
      canvasType: canvasItem.canvasType,
      canvasId: canvasItem.canvasId,
      moduleItemId: canvasItem.moduleItemId,
      canvasModuleId: canvasItem.canvasModuleId,
      pruned: false,
      coveredByModule: mc.moduleOrphanedOnCanvas === true,
    };
    ctx.report.orphans.canvas.push(orphan);
    if (orphan.coveredByModule) mc.coveredOrphans.push(orphan);
    if (ctx.policy.pruneCanvas && !orphan.coveredByModule) {
      orphan.pruned = emit(ctx, {
        type: 'delete-canvas-item',
        folder: mc.folder,
        canvasModuleId: canvasItem.canvasModuleId,
        itemPath,
        moduleItemId: canvasItem.moduleItemId,
        canvasType: canvasItem.canvasType,
        canvasId: canvasItem.canvasId,
        title: canvasItem.title,
      });
    }
    // Not for a row this run deletes. One covered by its module is refreshed
    // all the same, because whether the module goes is decided after this,
    // and the executor leaves a row the module delete has removed alone.
    if (legacyHash && !orphan.pruned) {
      planHashRefresh(ctx, mc, itemPath, row, canvasItem);
    }
    return;
  }

  // localItem && !canvasItem
  if (localChanged) {
    // yes / changed / gone — the mirror image, and just as asymmetric.
    mc.localChanges = true;
    ctx.report.decisions.push({
      kind: 'local-changed-canvas-deleted',
      moduleFolder: mc.folder,
      itemPath,
      title: localItem.title,
      canvasType: row.canvas_type,
      summary:
        `${itemPath} changed here, and the Canvas copy is gone. Recreating it ` +
        'on Canvas or deleting the file are both losses; which one is yours. ' +
        'Recreating means taking its row out of the sync state and pushing, ' +
        'once you have checked it is gone and not just outside a module ' +
        '(docs/frontmatter.md).',
    });
    return;
  }

  const orphan = {
    kind: 'item',
    moduleFolder: mc.folder,
    itemPath,
    title: localItem.title ?? row.title ?? null,
    canvasType: row.canvas_type,
    pruned: false,
    coveredByModule: mc.moduleOrphanedLocally === true,
  };
  ctx.report.orphans.local.push(orphan);
  if (orphan.coveredByModule) mc.coveredOrphans.push(orphan);
  if (ctx.policy.pruneLocal && !orphan.coveredByModule) {
    const action = {
      type: 'delete-local-item',
      folder: mc.folder,
      itemPath,
      canvasType: row.canvas_type,
    };
    if (!guardDirty(ctx, localItem, action, 'deleting the file')) {
      orphan.pruned = emit(ctx, action);
    }
  }
}

// ---------------------------------------------------------------------------
// Adoption
// ---------------------------------------------------------------------------

/**
 * The key a pair is matched on: the type, and the title with case and padding
 * taken out of it. Null for anything that cannot identify an object — an
 * untitled item, or one whose type is unknown.
 *
 * Not `suggestedPath`, which is the obvious candidate and the wrong one: it is
 * built from the title *and* the Canvas position, so the same item sitting
 * third on Canvas and first here gives `03-welcome.md` against `01-welcome.md`
 * and never matches. The numeric prefix is ordering, and ordering is
 * reconciled by `planOrdering`, on its own evidence.
 *
 * **The separator is a NUL deliberately — do not tidy it to a colon.** The key
 * is only ever compared, never parsed back, so the single property it needs is
 * that two different pairs cannot build the same string. Any printable
 * separator puts that at the mercy of the type vocabulary, because a title may
 * hold any printable character: with a space, `page` + `a b` and `page a` + `b`
 * are one key. NUL is the one byte a Canvas title cannot carry. It is written
 * `\0` rather than as the byte itself because a literal NUL makes the whole
 * file read as binary to `grep` and `file`, which then go quiet instead of
 * failing — the file simply stops being searchable and nobody learns why.
 */
function adoptionKey(canvasType, title) {
  const name = comparableName(title);
  return name === '' || !canvasType ? null : `${canvasType}\0${name}`;
}

/**
 * Bind one local file to one Canvas object that is already there, instead of
 * creating a second copy of each.
 *
 * There is no base row, so nothing can prove the two agree and there is no
 * conflict to resolve: the pinned side is written unconditionally, which is
 * what `policy.adopt` names. The other side's identity is what the pair is
 * for — `canvasId`, `pageUrl` and `moduleItemId` come from Canvas whichever
 * direction is pinned, because they are the thing being claimed.
 *
 * **`adopted` is what tells the executor this update is not an ordinary one**,
 * on the pattern `contentUnchanged` set: a statement of fact about how the
 * action was reached, not an instruction. `planCanvasUpdate` emits the same
 * type, and nothing else in the two actions tells them apart. It buys one
 * thing — `writeTitleIfAbsent` in `lib/sync/apply.js`, which puts a `title:`
 * into a markdown item that declares none so that its name on Canvas stops
 * depending on its filename. Until now that ran on the create handler alone, so
 * an item this tool adopted rather than created took its name from its filename
 * indefinitely, and `renumber` — which renames files by the dozen — then
 * silently renamed it on Canvas. That is the whole coupling the write exists to
 * break, and creating an object and claiming one are the same moment for it.
 *
 * The flag is deliberately narrower than "any update": writing a title into a
 * file on every ordinary push would be sync editing the author's tree unasked,
 * which is a different and worse thing than the one it fixes. Only the pinned
 * direction that writes to Canvas carries it. Pull needs none — an
 * `update-local-item` writes the whole frontmatter, `title:` included.
 */
function adoptPair(ctx, mc, localItem, canvasItem) {
  const action =
    ctx.policy.adopt === 'local'
      ? {
          type: 'update-canvas-item',
          folder: mc.folder,
          canvasModuleId: mc.canvasModuleId,
          itemPath: localItem.itemPath,
          title: localItem.title,
          canvasType: canvasItem.canvasType,
          canvasId: canvasItem.canvasId,
          pageUrl: canvasItem.pageUrl,
          moduleItemId: canvasItem.moduleItemId,
          indent: localItem.indent,
          localHash: localItem.localHash,
          adopted: true,
        }
      : {
          type: 'update-local-item',
          folder: mc.folder,
          canvasModuleId: mc.canvasModuleId,
          itemPath: localItem.itemPath,
          title: canvasItem.title,
          canvasType: canvasItem.canvasType,
          canvasId: canvasItem.canvasId,
          pageUrl: canvasItem.pageUrl,
          moduleItemId: canvasItem.moduleItemId,
          indent: canvasItem.indent,
          canvasHash: canvasItem.canvasHash,
          canvasUpdatedAt: canvasItem.canvasUpdatedAt,
        };

  // Registered before the write is even attempted, and whether or not it goes
  // ahead: these two sets are what `planNewItems` reads, and a pair left out of
  // them is created on both sides — the duplication adoption exists to stop.
  ctx.claimedCanvas.add(canvasItem);
  ctx.adoptedLocal.add(localItem.itemPath);

  // A pair is a link between a path and a Canvas item, which is exactly what a
  // matched base row is, and everything downstream reads links through these
  // two maps. `planOrdering` needs the Canvas sequence in local paths to
  // compare it with anything, and a reorder needs the module item id of every
  // slot it names.
  ctx.canvasOf.set(localItem.itemPath, canvasItem);
  ctx.basePathOf.set(canvasItem, localItem.itemPath);

  const entry = {
    moduleFolder: mc.folder,
    itemPath: localItem.itemPath,
    title: action.title,
    canvasType: canvasItem.canvasType,
    canvasId: canvasItem.canvasId,
    moduleItemId: canvasItem.moduleItemId,
    direction: ctx.policy.adopt,
    applied: false,
  };
  ctx.report.adopted.push(entry);

  if (
    action.type === 'update-local-item' &&
    guardDirty(ctx, localItem, action, 'writing the Canvas version over it')
  ) {
    return;
  }
  entry.applied = emit(ctx, action);
}

/**
 * Pair the items neither side has a base row for, by type and title, so that
 * an object already sitting in Canvas is claimed rather than duplicated.
 *
 * **Only when the direction is pinned.** With both sides writable nothing can
 * say which of the two copies is the newer, and there is no base row to ask;
 * `sync` therefore still refuses the whole module (see `detectCollisions`).
 * With `push` or `pull` there is an answer, and it is the pinned side.
 *
 * Types have to match exactly. A local page does not adopt a Canvas assignment
 * of the same name: that is not an adoption but a conversion, and this tool
 * cannot do one. Every type is eligible otherwise, `sub_header` and the three
 * reference types included — adopting a quiz by title is the general form of
 * the one-type trick `push` already does.
 *
 * **Ambiguity is never guessed at.** A title carried by two items on either
 * side says nothing about which claims which, so nothing is adopted for it and
 * the author is told; both sides fall through to the create path, exactly as
 * they did before this step existed.
 */
function planAdoptions(ctx, mc) {
  if (!ctx.policy.adopt) return;
  if (!mc.localModule || !mc.canvasModule) return;

  const bucket = (items) => {
    const map = new Map();
    for (const item of items) {
      const key = adoptionKey(item.canvasType, item.title);
      if (key === null) continue;
      const list = map.get(key);
      if (list) list.push(item);
      else map.set(key, [item]);
    }
    return map;
  };

  const here = bucket(
    mc.localModule.items.filter(
      (item) =>
        !ctx.baseRows.has(item.itemPath) &&
        // A path the author has not yet confirmed as a rename is held out of
        // the truth table entirely, and binding it to a Canvas object would be
        // deciding the very question that is being asked.
        !ctx.pendingRenameTargets.has(item.itemPath),
    ),
  );
  const there = bucket(
    mc.canvasModule.items.filter(
      (item) => item.recognised && !ctx.claimedCanvas.has(item),
    ),
  );

  for (const [key, locals] of here) {
    const remotes = there.get(key);
    if (!remotes) continue;
    if (locals.length === 1 && remotes.length === 1) {
      adoptPair(ctx, mc, locals[0], remotes[0]);
      continue;
    }
    ctx.report.decisions.push({
      kind: 'ambiguous-adoption',
      moduleFolder: mc.folder,
      title: locals[0].title,
      canvasType: locals[0].canvasType,
      localCandidates: locals.length,
      canvasCandidates: remotes.length,
      summary:
        `${mc.folder} holds ${locals.length} local and ${remotes.length} ` +
        `Canvas ${locals[0].canvasType} item(s) titled ` +
        `"${locals[0].title}", and nothing says which claims which. None of ` +
        'them was adopted. Give one of them a different title, or link them ' +
        'by hand in the sync state, then run again.',
    });
  }
}

// ---------------------------------------------------------------------------
// New items
// ---------------------------------------------------------------------------

/** Everything the sync state has never seen, on either side. */
function planNewItems(ctx, mc, positions) {
  if (mc.localModule) {
    for (const item of mc.localModule.items) {
      if (ctx.baseRows.has(item.itemPath)) continue;
      if (ctx.adoptedLocal.has(item.itemPath)) continue;
      if (ctx.pendingRenameTargets.has(item.itemPath)) continue;
      emit(ctx, {
        type: 'create-canvas-item',
        folder: mc.folder,
        canvasModuleId: mc.canvasModuleId,
        itemPath: item.itemPath,
        title: item.title,
        canvasType: item.canvasType,
        indent: item.indent,
        position: positions.get(item.itemPath) ?? null,
      });
    }
  }

  if (!mc.canvasModule) return;
  for (const item of mc.canvasModule.items) {
    if (!item.recognised) continue;
    if (ctx.claimedCanvas.has(item)) continue;
    emit(ctx, {
      type: 'create-local-item',
      folder: mc.folder,
      itemPath: item.suggestedPath,
      canvasModuleId: item.canvasModuleId,
      moduleItemId: item.moduleItemId,
      canvasType: item.canvasType,
      rawType: item.rawType,
      canvasId: item.canvasId,
      pageUrl: item.pageUrl,
      title: item.title,
      indent: item.indent,
      position: item.position,
      canvasHash: item.canvasHash,
      canvasUpdatedAt: item.canvasUpdatedAt,
    });
  }
}

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

/**
 * Make the losing side's order match the winner's.
 *
 * Shared by the two branches below, because "the local order wins" has to mean
 * the same thing whether a base row or an adoption is what linked the sides.
 */
function emitReorder(ctx, mc, winner, localSeq, canvasSeq) {
  if (winner === 'local') {
    // The full local sequence, not the restricted one: an item created this run
    // has a slot in the module too, and the executor needs to be told which.
    return emit(ctx, {
      type: 'reorder-canvas-module',
      folder: mc.folder,
      canvasModuleId: mc.canvasModuleId,
      order: mc.localModule.items.map((item, index) => ({
        itemPath: item.itemPath,
        moduleItemId: ctx.canvasOf.get(item.itemPath)?.moduleItemId ?? null,
        position: index + 1,
      })),
    });
  }

  // Canvas won: the desired local sequence is the Canvas one, with any path
  // Canvas does not hold kept at the end rather than dropped.
  const localSet = new Set(localSeq);
  const canvasSet = new Set(canvasSeq);
  const ordered = canvasSeq.filter((p) => localSet.has(p));
  const trailing = localSeq.filter((p) => !canvasSet.has(p));
  return emit(ctx, {
    type: 'reorder-local-module',
    folder: mc.folder,
    canvasModuleId: mc.canvasModuleId,
    order: [...ordered, ...trailing].map((itemPath, index) => ({
      itemPath,
      position: index + 1,
    })),
  });
}

/**
 * The order of a module whose two sides the base cannot compare.
 *
 * Called wherever the three-way comparison declines to decide, and it decides
 * only for a run that pinned a direction — the same rule, and the same reason,
 * as adoption itself: with no record of what the order was, nothing but the pin
 * can say which of two real orders is the right one.
 *
 * **Leaving it alone is not the neutral choice it looks like.** The run records
 * a base as it goes, and that base takes the order the rows were written in,
 * which is the local one. A Canvas still holding a different order then reads,
 * on the very next run, as though *Canvas* had been reordered and the local
 * files should be renumbered to match — a one-sided change, so nothing prompts
 * and nothing warns. Nobody reordered anything. Only an adoption can produce
 * that state, because before one, items reach Canvas in local order by
 * construction; so deciding here is this step's own mess to clean up.
 *
 * A no-op unless the two sides genuinely disagree, which is what keeps it from
 * emitting a reorder on every module of every pinned run.
 */
function planAdoptedOrdering(ctx, mc, localSeq, canvasSeq) {
  if (!ctx.policy.adopt) return;

  const localSet = new Set(localSeq);
  const canvasSet = new Set(canvasSeq);
  const restrictedLocal = localSeq.filter((p) => canvasSet.has(p));
  const restrictedCanvas = canvasSeq.filter((p) => localSet.has(p));

  // One linked item cannot sit in the wrong order relative to nothing, and two
  // that already agree need no write.
  if (restrictedCanvas.length < 2) return;
  if (sameSequence(restrictedLocal, restrictedCanvas)) return;

  const entry = {
    folder: mc.folder,
    winner: ctx.policy.adopt,
    skipped: false,
    reason:
      'adopted: no recorded order to compare against, so the side this run ' +
      'pins decided',
    base: null,
    local: restrictedLocal,
    canvas: restrictedCanvas,
    applied: false,
  };
  ctx.report.ordering.push(entry);
  entry.applied = emitReorder(ctx, mc, ctx.policy.adopt, localSeq, canvasSeq);
}

/**
 * Reconcile the order of a module's items, the one contested thing `newest` is
 * never offered for: the `--order` flag takes `local`, `canvas` or `ask`, and
 * nothing else. Carrying no timestamp is not what sets an order apart — a
 * module name carries none either, and still goes through the conflict policy,
 * where `newest` falls to local with a reason saying why it could not compare.
 * An order never reaches that policy at all. It has a policy of its own, and a
 * question of its own to park.
 *
 * Three sequences of paths — base, local, Canvas — **restricted to the paths
 * all three hold** before anything is compared. An item added or removed is a
 * membership change, and comparing unrestricted sequences would read every one
 * of them as a reorder of everything below it.
 *
 * Where that restriction leaves too little to compare, `planAdoptedOrdering`
 * takes over for a run that pinned a direction. It is reached from all three
 * of the points below that decide nothing, because an adopted pair is linked
 * without ever having been in the base, and so is invisible to every one of
 * these comparisons.
 */
function planOrdering(ctx, mc, unrecognised) {
  if (!mc.localModule || !mc.canvasModule) return;
  // A module with no base row at all still has two real orders once a pinned
  // run has adopted its way through it.
  if (!mc.baseModule && !ctx.policy.adopt) return;

  if (unrecognised.length > 0) {
    // An item this version cannot understand must not be shuffled. Its module
    // gets content and membership reconciled and nothing else.
    ctx.report.ordering.push({
      folder: mc.folder,
      winner: null,
      skipped: true,
      reason:
        `${mc.folder} holds ${unrecognised.length} module item(s) of a type ` +
        'this version does not understand, so its order was left exactly as ' +
        'it is on both sides.',
      unrecognised: unrecognised.map((item) => item.rawType ?? item.canvasType),
    });
    return;
  }

  const localSeq = mc.localModule.items.map((item) => item.itemPath);
  const canvasSeq = mc.canvasModule.items
    .map((item) => ctx.basePathOf.get(item))
    .filter((itemPath) => itemPath != null);
  const baseSeq = mc.baseOrder;

  const localSet = new Set(localSeq);
  const canvasSet = new Set(canvasSeq);
  const common = new Set(
    baseSeq.filter((p) => localSet.has(p) && canvasSet.has(p)),
  );
  if (common.size < 2) {
    planAdoptedOrdering(ctx, mc, localSeq, canvasSeq);
    return;
  }

  const restrictedBase = baseSeq.filter((p) => common.has(p));
  const restrictedLocal = localSeq.filter((p) => common.has(p));
  const restrictedCanvas = canvasSeq.filter((p) => common.has(p));

  const localMoved = !sameSequence(restrictedBase, restrictedLocal);
  const canvasMoved = !sameSequence(restrictedBase, restrictedCanvas);

  if (!localMoved && !canvasMoved) {
    planAdoptedOrdering(ctx, mc, localSeq, canvasSeq);
    return;
  }
  if (localMoved && canvasMoved) {
    if (sameSequence(restrictedLocal, restrictedCanvas)) {
      planAdoptedOrdering(ctx, mc, localSeq, canvasSeq);
      return;
    }
  }

  let winner;
  let reason;
  if (!canvasMoved) {
    winner = 'local';
    reason = 'only this side reordered';
  } else if (!localMoved) {
    winner = 'canvas';
    reason = 'only this side reordered';
  } else {
    const answer = ctx.policy.resolved.order[mc.folder];
    if (answer === 'local' || answer === 'canvas') {
      winner = answer;
      reason = 'answered';
    } else if (answer === 'skip') {
      ctx.report.ordering.push({
        folder: mc.folder,
        winner: null,
        skipped: true,
        reason: 'both sides reordered and neither was chosen',
        base: restrictedBase,
        local: restrictedLocal,
        canvas: restrictedCanvas,
      });
      return;
    } else if (ctx.policy.order === 'ask') {
      ctx.report.ordering.push({
        folder: mc.folder,
        winner: null,
        skipped: true,
        reason: 'both sides reordered; awaiting an answer',
        base: restrictedBase,
        local: restrictedLocal,
        canvas: restrictedCanvas,
      });
      ctx.report.pending.order.push({
        folder: mc.folder,
        base: restrictedBase,
        local: restrictedLocal,
        canvas: restrictedCanvas,
      });
      return;
    } else if (ctx.policy.order === 'skip') {
      // Nothing pending, because nothing will ask: a question filed under a
      // command that never collects it is a question the author never sees.
      // The line names the command that does ask instead, which is the only
      // thing they can act on.
      ctx.report.ordering.push({
        folder: mc.folder,
        winner: null,
        skipped: true,
        reason:
          'both sides reordered, and this command never asks which wins; ' +
          '`npx course sync` is the one that does',
        base: restrictedBase,
        local: restrictedLocal,
        canvas: restrictedCanvas,
      });
      return;
    } else {
      winner = ctx.policy.order;
      reason = `policy ${ctx.policy.order}`;
    }
  }

  const entry = {
    folder: mc.folder,
    winner,
    skipped: false,
    reason,
    base: restrictedBase,
    local: restrictedLocal,
    canvas: restrictedCanvas,
    applied: false,
  };
  ctx.report.ordering.push(entry);
  entry.applied = emitReorder(ctx, mc, winner, localSeq, canvasSeq);
}

// ---------------------------------------------------------------------------
// Module planning
// ---------------------------------------------------------------------------

/**
 * The module's own name and slot.
 *
 * Positions are reconciled in one direction only, and deliberately: a local
 * position is the folder's numeric prefix, a Canvas position is a 1-based index
 * within the course, and the two count in different spaces. Comparing them
 * would make every course whose folders are numbered 10, 20, 30 report a
 * permanent phantom change. So the Canvas side is watched for a name change,
 * and the local side for either.
 */
function planModuleMetadata(ctx, mc) {
  const { baseModule, localModule, canvasModule } = mc;

  if (!baseModule) {
    if (localModule && !canvasModule) {
      emit(ctx, {
        type: 'create-canvas-module',
        folder: mc.folder,
        name: localModule.name,
        position: localModule.position,
      });
      return;
    }
    if (!localModule && canvasModule) {
      emit(ctx, {
        type: 'create-local-module',
        folder: mc.folder,
        canvasModuleId: canvasModule.canvasModuleId,
        name: canvasModule.name,
        position: canvasModule.position,
      });
      return;
    }
    if (!localModule || !canvasModule) return;

    // Paired by name with nothing in the state to link them. Writing that link
    // down is a **state** operation, not a Canvas write, and no policy switches
    // it off: that this folder and this Canvas module are the same module is
    // true the moment the pair exists, whoever paired them and whichever side
    // the run writes to. Bookkeeping, not a decision.
    //
    // Nothing else records it. `recordRow` calls `ensureModule(state, folder,
    // {})` on its way past, so the module row does get created — with no
    // `canvas_module_id` in it. `buildModuleContexts` then pairs on that id and
    // falls back to matching by name only for a folder the base does not hold
    // at all, so on the next run the folder pairs with nothing: the module
    // reads as gone from Canvas, every item in it as a local orphan, a
    // `create-local-module` appears for a module that is already there, and
    // `--prune-local` would offer to delete the folder. That happens under
    // plain `sync` as readily as under an adopting run — a pair with items on
    // one side only never trips the collision guard — which is why this is not
    // gated on `policy.adopt`.
    //
    // Emitting it as an `update-canvas-module` would fix `push` and leave
    // `pull` broken in exactly the same way, because `emit` withholds a
    // Canvas-side action under a Canvas-pinned run.
    emit(ctx, {
      type: 'link-base-module',
      folder: mc.folder,
      canvasModuleId: canvasModule.canvasModuleId,
      // The local name and the local slot, because that is the frame the base
      // is compared in: a Canvas position counts within the course and a local
      // one is the folder's numeric prefix. A Canvas-pinned run that wants the
      // Canvas name gets it on the next pass, as an ordinary one-sided change.
      name: localModule.name,
      position: localModule.position,
    });

    // The module is adopted rather than duplicated, and the local name is what
    // it takes.
    //
    // **This cannot currently fire, and the branch is kept deliberately.**
    // `pairUnbasedModules` buckets both sides through `comparableName`, so a
    // pair only exists when the two names already compare equal — which is
    // exactly when this condition is false. The one way in is a local module
    // whose `name` is null, because that bucket falls back to the folder name,
    // and `gatherLocal` always sets one. Widen the pairing and this is what
    // stops a renamed module being silently adopted under its old Canvas name,
    // so it stays.
    if (
      comparableName(localModule.name) !== comparableName(canvasModule.name)
    ) {
      emit(ctx, {
        type: 'update-canvas-module',
        folder: mc.folder,
        canvasModuleId: canvasModule.canvasModuleId,
        name: localModule.name,
        position: localModule.position,
      });
    }
    return;
  }

  if (!localModule || !canvasModule) return;

  const localChanged =
    localModule.name !== baseModule.name ||
    localModule.position !== baseModule.position;
  const canvasChanged =
    comparableName(canvasModule.name) !== comparableName(baseModule.name);

  if (!localChanged && !canvasChanged) return;

  const toCanvas = () =>
    emit(ctx, {
      type: 'update-canvas-module',
      folder: mc.folder,
      canvasModuleId: canvasModule.canvasModuleId,
      name: localModule.name,
      position: localModule.position,
    });
  // Only the label in `_category_.json` moves: the folder name is the key of
  // every row in the state, so renaming it here would re-key the whole module
  // behind the author's back.
  const toLocal = () => {
    // A write into the working tree like any other, and it was the one local
    // write with no git guard in front of it: an uncommitted `_category_.json`
    // was overwritten with the Canvas label and the run said nothing. Worse
    // under a conflict, where the entry below would then call it resolved and
    // tell the author the losing version was in git.
    if (
      guardCategoryDirty(ctx, mc.folder, localModule, 'update-local-module')
    ) {
      return false;
    }
    return emit(ctx, {
      type: 'update-local-module',
      folder: mc.folder,
      canvasModuleId: canvasModule.canvasModuleId,
      name: canvasModule.name,
      // The local slot, not the state's and not Canvas's. `_category_.json`
      // holds the Docusaurus sidebar position, which locally is the folder's
      // numeric prefix — `scanCourse` reads it back out of the prefix and
      // `renameModule` writes the prefix into the file. The state's copy is a
      // record of a previous run, and this action fires precisely when the
      // local side may have moved since; a row with no `position` at all made
      // the executor fall back to `0` and renumber the module to the top.
      position: localModule.position,
    });
  };

  if (localChanged && !canvasChanged) {
    toCanvas();
    return;
  }
  if (!localChanged && canvasChanged) {
    toLocal();
    return;
  }

  // Nulls on purpose, and not a gap in what was gathered: a module name is
  // timestamped nowhere. Canvas's module object carries no `updated_at` and the
  // local label lives in `_category_.json`, whose mtime moves for anything else
  // in that file too. So `newest` has nothing to compare here, and the local
  // fallback it lands on is the designed answer rather than a data failure —
  // which is what the reason has to say, or the report blames Canvas for a
  // timestamp it was never asked for.
  const outcome = resolveConflict(
    ctx,
    mc.folder,
    null,
    null,
    'newest: a module name carries no timestamp on either side, so neither ' +
      'can prove it is newer',
  );
  if (outcome.pending) {
    ctx.report.pending.conflicts.push({
      kind: 'module',
      moduleFolder: mc.folder,
      localName: localModule.name,
      canvasName: canvasModule.name,
    });
    return;
  }
  if (outcome.skipped) {
    ctx.report.skipped.push({
      kind: 'module',
      reason: 'conflict-unresolved',
      moduleFolder: mc.folder,
      action: null,
      remedy:
        `${mc.folder} was renamed on both sides and no winner was chosen. Run ` +
        'again with --conflict local or --conflict canvas.',
    });
    return;
  }
  const mark = ctx.report.skipped.length;
  const applied = outcome.winner === 'local' ? toCanvas() : toLocal();
  ctx.report.conflicts.push({
    kind: 'module',
    moduleFolder: mc.folder,
    winner: outcome.winner,
    reason: outcome.reason,
    localName: localModule.name,
    canvasName: canvasModule.name,
    applied,
    refusal: refusalSince(ctx, mark),
  });
}

/** A module that is in the state but gone from one side. */
function planModuleOrphan(ctx, mc) {
  const { baseModule, localModule, canvasModule } = mc;
  if (!baseModule) return;

  if (!localModule && !canvasModule) {
    emit(ctx, { type: 'drop-base-module', folder: mc.folder });
    return;
  }

  if (!localModule && canvasModule) {
    const orphan = {
      kind: 'module',
      moduleFolder: mc.folder,
      title: canvasModule.name,
      canvasModuleId: canvasModule.canvasModuleId,
      itemCount: canvasModule.items.length,
      pruned: false,
    };
    ctx.report.orphans.canvas.push(orphan);
    if (!ctx.policy.pruneCanvas) return;
    if (mc.remoteChanges) {
      // Deleting the module would take the changed items with it, and those are
      // exactly the ones the author still has to decide about.
      orphan.reason =
        'left alone: this module still holds Canvas-side changes that need a ' +
        'decision first';
      return;
    }
    orphan.pruned = emit(ctx, {
      type: 'delete-canvas-module',
      folder: mc.folder,
      canvasModuleId: canvasModule.canvasModuleId,
      name: canvasModule.name,
    });
    // Deleting the module takes its items with it, which is why they got no
    // delete of their own.
    for (const covered of mc.coveredOrphans) covered.pruned = orphan.pruned;
    return;
  }

  if (localModule && !canvasModule) {
    const orphan = {
      kind: 'module',
      moduleFolder: mc.folder,
      title: localModule.name,
      itemCount: localModule.items.length,
      pruned: false,
    };
    ctx.report.orphans.local.push(orphan);
    if (!ctx.policy.pruneLocal) return;
    if (mc.localChanges) {
      orphan.reason =
        'left alone: this folder still holds local changes that need a ' +
        'decision first';
      return;
    }
    // The module-level `guardDirty`: one folder standing in for every file
    // under it, and withheld rather than skipped on a run that does not write
    // locally, for the reason `writeLands` gives.
    if (mc.localDirty && writeLands(ctx, 'delete-local-module')) {
      ctx.report.skipped.push({
        kind: 'module',
        reason: 'git-dirty',
        moduleFolder: mc.folder,
        action: 'delete-local-module',
        remedy:
          `${mc.folder} holds files with uncommitted changes; deleting the ` +
          'folder would be the only copy of them gone. Commit or stash them, ' +
          'then run sync again.',
      });
      return;
    }
    orphan.pruned = emit(ctx, {
      type: 'delete-local-module',
      folder: mc.folder,
      canvasModuleId: baseModule.canvasModuleId,
    });
    for (const covered of mc.coveredOrphans) covered.pruned = orphan.pruned;
  }
}

function planModule(ctx, mc) {
  // A module whose items Canvas would not list is a wall: the planner derives
  // nothing from it and decides nothing about it. Every branch below reads
  // "no Canvas item" as "deleted on Canvas" somewhere — the orphan rows, the
  // prune candidates, the local-deleted decisions, the creates a push would
  // make for items that exist but were invisible this run — and each of those
  // is a wrong answer here, because nothing was deleted: nothing was *seen*.
  // So the module's base rows, its local folder and everything in it are all
  // parked, local edits included; refusing loudly beats guessing about a side
  // this run could not read. One skipped entry says so, unconditionally —
  // it names no action on either side, so there is nothing for `withheld` to
  // receive (`writeLands`), and `status` has to report it too: a `sync` over
  // this course refuses the module whoever asks.
  if (mc.canvasModule && mc.canvasModule.unreadable != null) {
    const name = mc.canvasModule.name ?? mc.canvasModuleId;
    ctx.report.skipped.push({
      kind: 'module',
      reason: 'canvas-unreadable',
      moduleFolder:
        mc.folder ?? mc.canvasModule.suggestedFolder ?? String(name),
      canvasModuleId: mc.canvasModuleId,
      action: null,
      remedy:
        `Canvas would not list what module "${name}" holds ` +
        `(${mc.canvasModule.unreadable}), and a module this run cannot read ` +
        'must never read as one that was emptied or deleted. Nothing about ' +
        'it was decided, on either side. Run again once Canvas answers.',
    });
    return;
  }

  const unrecognised = mc.canvasModule
    ? mc.canvasModule.items.filter((item) => !item.recognised)
    : [];
  for (const item of unrecognised) {
    ctx.report.unrecognised.push({
      moduleFolder: mc.folder,
      canvasModuleId: mc.canvasModuleId,
      moduleItemId: item.moduleItemId,
      rawType: item.rawType,
      canvasType: item.canvasType,
      title: item.title,
    });
  }

  // A collided module is refused outright: nothing about it is decided until
  // the author picks a direction.
  if (mc.collided) return;

  // And so is a Canvas module with no folder to land in.
  //
  // `buildModuleContexts` gives an unclaimed Canvas module the folder its name
  // and position derive to, unless another module has taken that name already —
  // in which case the context carries `folder: null`, because there is no
  // second name to guess. Everything below then planned against that null:
  // `create-local-module` reached `path.join(courseDir, null)` and threw a
  // `TypeError` the run reported as an internal error, and the
  // `create-local-item` ranked behind it kept its *real* `suggestedPath` and
  // ran — writing the second module's pages into the first module's folder and
  // filing their rows under a state key of the literal string `"null"`. So it
  // was never only a bad message: the run wrote content into the wrong module
  // and left the state describing a folder that does not exist.
  //
  // `writeLands` for the reason every other refusal here uses it: under `push`
  // no local write is emitted at all, so nothing can throw and nothing can
  // land in the wrong place, and a skip there would fail the run over a
  // Canvas-side name clash the command was never going to act on.
  //
  // **`writesNothing` is why `status` is not `push` here.** Every other
  // refusal in this file is about a write: whether *this run's* write would
  // destroy something. This one is about the Canvas course — two modules
  // deriving one folder name is true of the course whoever asks, and it is not
  // a state a sync works through, because sync refuses it and goes on
  // refusing it until somebody renames a module in Canvas. `status` exists to
  // say what a `sync` would do, and it is the only command that answers *only*
  // by reporting: with both write flags off, everything it can say lives in
  // the report, so a refusal it does not record is a refusal it does not
  // mention. It ran silent on this and exited 0 while `sync --dry-run` — the
  // other preview of the same run, over the same course — exited 1.
  if (mc.folder === null && mc.canvasModule) {
    const wanted = mc.canvasModule.suggestedFolder;
    if (writeLands(ctx, 'create-local-module') || writesNothing(ctx)) {
      ctx.report.skipped.push({
        kind: 'module',
        reason: 'folder-taken',
        moduleFolder: wanted,
        canvasModuleId: mc.canvasModuleId,
        action: 'create-local-module',
        remedy:
          `Canvas module "${mc.canvasModule.name ?? mc.canvasModuleId}" would ` +
          `be pulled into ${wanted ? `${wanted}/` : 'a folder'}, and another ` +
          "module already has that folder — a module's folder name is its " +
          'name and its position, so two modules that agree on both derive ' +
          'the same one. Rename or renumber one of them in Canvas, then run ' +
          'again.',
      });
    }
    return;
  }

  mc.moduleOrphanedOnCanvas = Boolean(
    mc.baseModule && !mc.localModule && mc.canvasModule,
  );
  mc.moduleOrphanedLocally = Boolean(
    mc.baseModule && mc.localModule && !mc.canvasModule,
  );
  // The folder's own answer first, because it is the only one that covers what
  // `delete-local-module` actually removes. That delete is recursive, while the
  // items below are only what `scanCourse` returns — and the scanner never
  // descends into a `_`-prefixed folder, so no item can ever stand for a
  // `_files/` binary or a `_category_.json`. A module whose one piece of
  // uncommitted work was an untracked image therefore planned its own deletion
  // with nothing skipped, and took the image with it. `gitDirtyPaths` adds
  // every ancestor of a dirty path, so the folder flag catches all of it.
  //
  // The per-item scan stays, and is not redundant: `plan` is a pure function of
  // the three sides, and a caller that describes a dirty item without setting
  // the flag on its module must still be guarded.
  mc.localDirty = Boolean(
    mc.localModule &&
    (mc.localModule.dirty || mc.localModule.items.some((item) => item.dirty)),
  );

  planModuleMetadata(ctx, mc);

  const positions = localPositions(mc.localModule);
  for (const entry of mc.baseRows) {
    if (ctx.pendingRenameSources.has(entry.itemPath)) continue;
    planKnownItem(
      ctx,
      mc,
      entry,
      mc.localModule ? mc.localModule.byPath.get(entry.itemPath) || null : null,
      ctx.canvasOf.get(entry.itemPath) || null,
      positions,
    );
  }
  planAdoptions(ctx, mc);
  planNewItems(ctx, mc, positions);
  planModuleOrphan(ctx, mc);
  planOrdering(ctx, mc, unrecognised);
}

// ---------------------------------------------------------------------------
// Embedded files nothing points at any more
// ---------------------------------------------------------------------------

/** The last segment of a path the state keys by, which is always POSIX. */
function basenameOf(refPath) {
  return refPath.slice(refPath.lastIndexOf('/') + 1);
}

/**
 * The binaries in `state.files` that no markdown in the course embeds any more.
 *
 * A row under `state.files` is created by a path an item points at: push
 * uploads what `extractFileReferences` finds and files the Canvas id under that
 * path, pull downloads what a Canvas body names and does the same. Nothing has
 * ever taken one away. Rename `_files/logo.png` to `_files/brand.png` and fix
 * the `![](…)`, and the run uploads the same bytes a second time under the new
 * path: Canvas keeps two copies, the old one live in the course Files area with
 * nothing pointing at it, and the state keeps a row for a path that no longer
 * exists. This is the sweep that notices.
 *
 * **It is a whole-course question, and the fence around it is the point.** "No
 * item references this file" is only true if every markdown item in `course/`
 * was read, and getting that wrong deletes live images out of a live course. So
 * two things are checked before a single row is looked at:
 *
 * - **A tree the gather could not read whole.** `local.embedded.complete`
 *   answers that, and it is default-deny: absent — which is what a hand-built
 *   `local` hands over — reads as "not proven" exactly like false. This is the
 *   fence that is load-bearing today.
 * - **`-m` scoping**, which is a fence for a different reason. Every call site
 *   hands `gatherLocal` the whole `course/` tree whatever `-m` says, so the set
 *   really is complete on a scoped run too — the restriction is applied here,
 *   in the planner, and nowhere else. It still sweeps nothing, on the same
 *   ground the rest of this file confines a scoped run: `-m` is the author
 *   saying which modules this run may touch, and a Canvas file belonging to a
 *   module they did not name is not this run's to delete. That it also survives
 *   somebody scoping the gather by module later — an obvious optimisation, and
 *   one that would turn every file an unscanned module embeds into an orphan —
 *   is the second reason to keep it.
 *
 * **The row outlives the Canvas file it names, and never the other way round.**
 * Dropping the row is cheap and safe on its own — it is dead local bookkeeping
 * — but it is also the last thing in this repo that knows the orphaned Canvas
 * file exists. Drop it on a run that does not delete the file and the file is
 * stranded for good: unreachable to this sweep, which reads `state.files`, and
 * unreachable to `--prune-canvas`, which only ever considered items. That is
 * the same reason `deleteModule` in `lib/sync/state.js` leaves these rows alone
 * when a module goes. So the row goes only with the delete that empties it, and
 * the executor drops it there.
 */
function planEmbeddedFileOrphans(ctx, base, local) {
  const rows = (base && base.files) || {};
  const embedded = local && local.embedded;

  if (ctx.policy.modules !== null) return;
  if (!embedded || embedded.complete !== true) return;

  for (const [refPath, row] of Object.entries(rows)) {
    if (!row) continue;
    const ref = toPosixPath(refPath);
    // A row keyed under a folder fenced off behind an unreadable module is
    // left alone with the rest of that module. The sweep's own question is
    // answered from the local tree, but its conclusion is about the Canvas
    // file — and with the module's local folder gone and its Canvas side
    // unlisted, "nothing embeds this any more" is exactly the guess the wall
    // exists to refuse: the unlisted pages may be what embeds it.
    if (ctx.unreadableFolders.has(folderOf(ref))) continue;
    if (embedded.refs.has(ref)) continue;

    const orphan = {
      kind: 'file',
      itemPath: ref,
      title: basenameOf(ref),
      canvasType: 'file',
      canvasFileId: row.canvas_file_id ?? null,
      pruned: false,
    };
    ctx.report.orphans.canvas.push(orphan);
    if (!ctx.policy.pruneCanvas) continue;

    orphan.pruned = emit(ctx, {
      type: 'delete-canvas-file',
      itemPath: ref,
      canvasFileId: row.canvas_file_id ?? null,
      title: orphan.title,
    });
  }
}

// ---------------------------------------------------------------------------
// Renames and the collision guard
// ---------------------------------------------------------------------------

/**
 * Fold the detected renames into the base index, so that everything downstream
 * classifies the item against the path it actually sits at now.
 *
 * An exact rename is applied here and reported as a `rekey-base` action; the
 * item is then classified normally, against its new path. A probable one is
 * held: both the old path and the new one are taken out of the truth table
 * until the author answers, because letting them through would report a delete
 * of the Canvas object and a create of a second copy of the same content — the
 * exact duplication rename detection exists to prevent.
 */
function applyRenames(ctx, base, localItems, canvasItems) {
  const inScope = (itemPath) => ctx.included(folderOf(itemPath));
  const { renames } = detectRenames({
    base: [...base.rows.values()].filter((entry) => inScope(entry.itemPath)),
    local: localItems.filter((item) => inScope(item.itemPath)),
    canvas: canvasItems,
  });

  const rekeys = new Map();
  for (const rename of renames) {
    // A rename touching a folder fenced off behind an unreadable module is
    // parked whole, without even asking. Following it would put the row where
    // the wall in `planModule` cannot see one end of it: re-keyed *out*, the
    // row lands in a readable context whose Canvas match is missing — the
    // module's items were never listed — and reads as "deleted on Canvas",
    // which under `--prune-local` deletes the file that was just moved.
    // Refusing the pair instead would create the new path as a second Canvas
    // copy of an object that exists, just invisibly. Parking both ends does
    // neither: the sets below take the source out of the truth table and the
    // target out of adoption and creation, and the module's own skipped entry
    // is the one account the author gets.
    if (
      ctx.unreadableFolders.has(folderOf(rename.from)) ||
      ctx.unreadableFolders.has(folderOf(rename.to))
    ) {
      ctx.pendingRenameSources.add(rename.from);
      ctx.pendingRenameTargets.add(rename.to);
      continue;
    }

    const answer = ctx.policy.resolved.renames[rename.from];
    const confirmed = answer === rename.to || answer === true;
    const rejected = answer === false || answer === null;

    if (rename.confidence === 'exact' || confirmed) {
      rekeys.set(rename.from, rename.to);
      emit(ctx, {
        type: 'rekey-base',
        from: rename.from,
        to: rename.to,
        fromFolder: folderOf(rename.from),
        toFolder: folderOf(rename.to),
        confidence: rename.confidence,
      });
      continue;
    }
    if (rejected) continue;

    ctx.report.pending.renames.push({
      from: rename.from,
      to: rename.to,
      confidence: rename.confidence,
      fromFolder: folderOf(rename.from),
      toFolder: folderOf(rename.to),
    });
    ctx.pendingRenameSources.add(rename.from);
    ctx.pendingRenameTargets.add(rename.to);
  }

  if (rekeys.size === 0) return;

  const rows = new Map();
  for (const [itemPath, entry] of base.rows) {
    const to = rekeys.get(itemPath);
    rows.set(to || itemPath, to ? { ...entry, itemPath: to } : entry);
  }
  base.rows = rows;
  for (const module of base.modules.values()) {
    module.order = module.order.map(
      (itemPath) => rekeys.get(itemPath) || itemPath,
    );
  }

  // The Canvas match was made on ids, which a rename does not touch, so it
  // moves with the row rather than being redone.
  for (const [from, to] of rekeys) {
    const canvasItem = ctx.canvasOf.get(from);
    ctx.canvasOf.delete(from);
    if (!canvasItem) continue;
    ctx.canvasOf.set(to, canvasItem);
    ctx.basePathOf.set(canvasItem, to);
  }
}

/**
 * Refuse the one state that cannot be reconciled: the state links nothing in a
 * module to Canvas, and both sides hold content in it.
 *
 * That happens after `reset-sync-state` against a course that already holds a
 * copy, and on a first `sync` against a populated course. Every local item
 * reads as new here and every Canvas item as new there, so the honest plan is
 * to create both — which duplicates the entire course. This is the single most
 * destructive thing the old system did.
 *
 * The trigger is "no base row for this module", not "no base module row": a
 * module entry that names a Canvas module but holds no items — a run that
 * crashed between creating the module and recording what went in it — leads to
 * exactly the same duplication, and the same refusal is the right answer.
 *
 * Judged per module, never for the course: a genuinely new module on one side
 * is an ordinary thing and must not trip it.
 *
 * The refusal's own advice is to pick a direction, and a run that has picked
 * one needs no refusal: `planAdoptions` pairs the two sides by title and the
 * pinned side is written over what it claims. So a pinned run skips this
 * entirely — including the pairs adoption could not make, which fall through
 * to being created and are reported as such.
 */
function detectCollisions(ctx, contexts) {
  if (ctx.policy.adopt) return;

  const collided = [];
  for (const mc of contexts) {
    if (mc.baseRows.length > 0) continue;
    if (!mc.localModule || !mc.canvasModule) continue;
    const localCount = mc.localModule.items.length;
    const canvasCount = mc.canvasModule.items.filter(
      (item) => item.recognised,
    ).length;
    if (localCount === 0 || canvasCount === 0) continue;

    mc.collided = true;
    collided.push({
      folder: mc.folder,
      canvasModuleId: mc.canvasModule.canvasModuleId,
      name: mc.canvasModule.name ?? mc.localModule.name,
      localItems: localCount,
      canvasItems: canvasCount,
    });
  }

  if (collided.length === 0) return;
  const named = collided
    .map(
      (m) =>
        `${m.folder ?? m.name} (${m.localItems} local, ${m.canvasItems} on Canvas)`,
    )
    .join(', ');
  ctx.report.collision = {
    modules: collided,
    message:
      `The sync state links nothing in ${named} to Canvas, yet both sides hold ` +
      'items. Every one of them reads as new on the side it is on, so ' +
      'reconciling would create a second copy of each and duplicate the ' +
      'module. Pick a direction instead — `npx course push` pins the local ' +
      'copy as the winner and `npx course pull` pins Canvas — or clear the ' +
      'side you do not want first.',
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Decide what a sync run should do.
 *
 * @param {object} input
 * @param {object} input.base - Schema-v4 sync state, as `lib/sync/state.js`
 *   produces it: the truth as of the last sync, and the only thing that can
 *   tell "changed" from "new" from "deleted".
 * @param {object} input.local - `{ modules: [{folder, name, position, items:
 *   [{itemPath, title, canvasType, indent, position, localHash, localMtimeMs,
 *   dirty}]}] }`. `dirty` is whether git holds uncommitted changes for that
 *   file, and it is the caller's job to answer it.
 * @param {object} input.canvas - `{ modules: [{canvasModuleId, name, position,
 *   suggestedFolder, items: [{moduleItemId, canvasType, rawType, canvasId,
 *   pageUrl, title, indent, position, canvasHash, canvasUpdatedAt,
 *   suggestedPath, recognised}]}] }`. A module may carry `unreadable` — the
 *   failure message from a `listModuleItems` that did not answer — in place of
 *   its items; the planner walls such a module off (`planModule`) rather than
 *   reading its missing items as deleted. A file item also carries
 *   `legacyCanvasHash`, its 1.5.1 fingerprint (`legacyFileFingerprint`).
 * @param {object} input.policy - `{ write: {canvas, local}, conflict, order,
 *   adopt, pruneCanvas, pruneLocal, modules, resolved }`. `push` is
 *   `write: {canvas: true, local: false}` with `conflict: 'local'` and
 *   `adopt: 'local'`, `pull` the mirror image, `status` writes to neither and
 *   adopts nothing. Only `sync` passes `order: 'ask'`, because only `sync`
 *   collects what that parks in `pending.order`.
 * @returns {object} `{ actions, conflicts, skipped, adopted, orphans,
 *   decisions, unrecognised, ordering, pending, collision, withheld }`.
 */
function plan({ base, local, canvas, policy } = {}) {
  const normalisedBase = normaliseBase(base);
  const localModules = normaliseLocal(local);
  const canvasModules = normaliseCanvas(canvas);

  const ctx = {
    policy: normalisePolicy(policy),
    report: emptyReport(),
    pendingRenameSources: new Set(),
    pendingRenameTargets: new Set(),
    adoptedLocal: new Set(),
  };
  ctx.included = (folder) =>
    ctx.policy.modules === null || ctx.policy.modules.has(folder);

  // The two halves of "was a binary this item embeds edited in place", read
  // from the raw inputs because neither belongs to an item: `state.files` is
  // keyed by a path under `course/` and the hashes are a whole-tree answer.
  //
  // `complete` gates this as it gates the sweep, and on purpose. Nothing forces
  // it to — the question is per item, and an item the gather could read has
  // read its own references whatever went wrong elsewhere. But `complete` is
  // the one licence over this one structure (`createReferenceSet` in
  // `lib/sync/gather.js`), and a second consumer that honours half of it turns
  // a rule into a table of exceptions. It costs a course with an unreadable
  // item its image updates until that item is readable, which the gather
  // already warns about by name on every run. Only a `Map` carries hashes at
  // all: the plain `Set` this used to be, or nothing, says "cannot answer".
  const embedded = (local && local.embedded) || null;
  const refs = embedded && embedded.refs;
  ctx.embeddedHashes =
    refs instanceof Map && embedded.complete === true ? refs : null;
  ctx.baseFiles = (base && base.files) || {};

  const localItems = localModules.flatMap((module) => module.items);
  const canvasItems = canvasModules.flatMap((module) => module.items);

  const matched = matchBaseToCanvas(normalisedBase.rows, canvasItems);
  ctx.canvasOf = matched.canvasOf;
  ctx.basePathOf = matched.basePathOf;
  ctx.claimedCanvas = matched.claimed;

  // The folders fenced off behind a module whose items Canvas would not list.
  // The wall itself lives in `planModule`, which reads the flag off the
  // context's own module; this set exists for the two decisions that run
  // outside any context — rename detection below, and the embedded-file sweep
  // at the end — and it can only be seeded from the state's own links,
  // because the name pairing that can also tie a folder to a Canvas module
  // has not happened yet. That is enough for renames: a folder the state does
  // not link holds no base rows, so no rename can start from it, and one
  // ending in it is caught by the wall once the row lands there.
  ctx.unreadableFolders = new Set();
  for (const module of canvasModules) {
    if (module.unreadable == null || module.canvasModuleId == null) continue;
    for (const [folder, entry] of normalisedBase.modules) {
      if (
        entry.canvasModuleId != null &&
        String(entry.canvasModuleId) === String(module.canvasModuleId)
      ) {
        ctx.unreadableFolders.add(folder);
      }
    }
  }

  applyRenames(ctx, normalisedBase, localItems, canvasItems);
  ctx.baseRows = normalisedBase.rows;

  const contexts = buildModuleContexts(
    normalisedBase,
    localModules,
    canvasModules,
    // A Canvas module nothing links to a local folder has no folder to restrict
    // on, so `-m` excludes it rather than guessing that it was meant.
  ).filter((mc) =>
    mc.folder === null ? ctx.policy.modules === null : ctx.included(mc.folder),
  );

  // Base rows follow their current path, not the module the state files them
  // under: a rename that crossed a module folder has already moved them.
  const byFolder = new Map(
    contexts.filter((mc) => mc.folder !== null).map((mc) => [mc.folder, mc]),
  );
  for (const entry of normalisedBase.rows.values()) {
    const mc = byFolder.get(folderOf(entry.itemPath));
    if (mc) mc.baseRows.push(entry);
  }
  for (const mc of contexts) {
    if (!mc.baseModule) continue;
    const here = new Set(mc.baseRows.map((entry) => entry.itemPath));
    mc.baseOrder = mc.baseModule.order.filter((itemPath) => here.has(itemPath));
    for (const entry of mc.baseRows) {
      if (!mc.baseOrder.includes(entry.itemPath))
        mc.baseOrder.push(entry.itemPath);
    }
  }

  // The pairing above can tie an unreadable module to a folder the state never
  // linked — by name, or by the folder its own name derives — so the fenced
  // set is completed here, once every link that will exist this run does. Only
  // the embedded-file sweep still reads it after this point.
  for (const mc of contexts) {
    if (
      mc.folder != null &&
      mc.canvasModule &&
      mc.canvasModule.unreadable != null
    ) {
      ctx.unreadableFolders.add(mc.folder);
    }
  }

  detectCollisions(ctx, contexts);
  for (const mc of contexts) planModule(ctx, mc);

  // After every module, and reading the raw inputs rather than the normalised
  // ones: this asks about `state.files`, which is keyed by a path under
  // `course/` and belongs to no module's item list. Last, so that its actions
  // sort behind the writes of the run they clean up after.
  planEmbeddedFileOrphans(ctx, base, local);

  // Both lists in execution order, and `withheld` for the same reason as
  // `actions`: under `status` it *is* the action list, and a preview whose
  // order differs from the run it previews is not a preview.
  const byRank = (a, b) => ACTION_RANK[a.type] - ACTION_RANK[b.type];
  ctx.report.actions.sort(byRank);
  ctx.report.withheld.sort(byRank);
  return ctx.report;
}

module.exports = {
  ACTION_RANK,
  ACTION_SIDES,
  plan,
};
