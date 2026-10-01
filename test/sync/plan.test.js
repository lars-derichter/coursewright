const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { REFERENCE_TYPES } = require('../../lib/sync/fingerprint');
const { ACTION_RANK, plan } = require('../../lib/sync/plan');

// ---------------------------------------------------------------------------
// Fixtures
//
// One builder per side, all three agreeing by default, so a case says only what
// it changes. Ids and fingerprints are derived from the item path, which keeps
// them consistent across the three sides without any test having to repeat one.
// ---------------------------------------------------------------------------

const FOLDER = '01-intro';
const PATH = '01-intro/01-welcome.md';
const CANVAS_TIME = '2026-08-19T09:00:00.000Z';
const LOCAL_TIME = Date.parse('2026-08-19T08:00:00.000Z');

/**
 * Canvas ids derived from both numeric prefixes, so the three sides agree and
 * no two items in different modules end up sharing an id.
 */
function ids(itemPath) {
  const [folder, file] = itemPath.split('/');
  const module = Number(folder.match(/^(\d+)/)[1]);
  const item = Number(file.match(/^(\d+)/)[1]);
  return {
    canvasId: 1000 + module * 10 + item,
    moduleItemId: 5000 + module * 10 + item,
    pageUrl: `page-${module}-${item}`,
  };
}

/** The de-prefixed filename, which is what every side calls the item. */
function titleOf(itemPath) {
  return itemPath.split('/').pop().replace(/^\d+-/, '').replace(/\.md$/, '');
}

/** A base row, fingerprinted as `L:<path>` locally and `C:<path>` on Canvas. */
function bRow(itemPath, overrides = {}) {
  const { canvasId, moduleItemId, pageUrl } = ids(itemPath);
  return {
    canvas_type: 'page',
    canvas_id: canvasId,
    page_url: pageUrl,
    module_item_id: moduleItemId,
    local_hash: `L:${itemPath}`,
    canvas_hash: `C:${itemPath}`,
    title: titleOf(itemPath),
    ...overrides,
  };
}

function bMod(paths, extra = {}) {
  const items = {};
  for (const itemPath of paths) {
    items[itemPath] = bRow(itemPath, (extra.rows || {})[itemPath]);
  }
  return {
    canvas_module_id: extra.canvasModuleId ?? 100,
    name: extra.name ?? 'Introduction',
    position: extra.position ?? 1,
    item_order: extra.order ?? paths,
    items,
  };
}

function lItem(itemPath, overrides = {}) {
  return {
    itemPath,
    title: titleOf(itemPath),
    canvasType: 'page',
    indent: 0,
    position: 1,
    localHash: `L:${itemPath}`,
    localMtimeMs: LOCAL_TIME,
    dirty: false,
    ...overrides,
  };
}

function lMod(folder, paths, extra = {}) {
  return {
    folder,
    name: extra.name ?? 'Introduction',
    position: extra.position ?? 1,
    // The folder's own git answer, which `gatherLocal` sets from the module
    // path itself. It covers everything the scanner never sees — a `_files/`
    // binary, `_category_.json` — so it is the only flag that can speak for
    // what a recursive `delete-local-module` would really remove.
    dirty: extra.dirty ?? false,
    // And the answer for `_category_.json` alone, which is the one write
    // `update-local-module` makes. Deliberately separate from the flag above:
    // that one is true for anything uncommitted anywhere under the folder.
    categoryDirty: extra.categoryDirty ?? false,
    items: paths.map((itemPath, index) =>
      lItem(itemPath, {
        position: index + 1,
        ...(extra.items || {})[itemPath],
      }),
    ),
  };
}

function cItem(itemPath, overrides = {}) {
  const { canvasId, moduleItemId, pageUrl } = ids(itemPath);
  return {
    moduleItemId,
    canvasType: 'page',
    rawType: 'Page',
    canvasId,
    pageUrl,
    title: titleOf(itemPath),
    indent: 0,
    position: 1,
    canvasHash: `C:${itemPath}`,
    canvasUpdatedAt: CANVAS_TIME,
    suggestedPath: itemPath,
    recognised: true,
    ...overrides,
  };
}

function cMod(paths, extra = {}) {
  return {
    canvasModuleId: extra.canvasModuleId ?? 100,
    name: extra.name ?? 'Introduction',
    position: extra.position ?? 1,
    suggestedFolder: extra.suggestedFolder ?? null,
    items: [
      ...paths.map((itemPath, index) =>
        cItem(itemPath, {
          position: index + 1,
          ...(extra.items || {})[itemPath],
        }),
      ),
      ...(extra.extraItems || []),
    ],
  };
}

/**
 * A text header, on all three sides. Hand-built rather than derived from the
 * path like everything else: a subfolder has no numeric prefix on its own name,
 * and Canvas gives a SubHeader no content id, so its only identity is the
 * module item it is.
 */
const HEADER = '01-intro/theory';

function plainHeader() {
  return {
    row: {
      canvas_type: 'sub_header',
      canvas_id: null,
      page_url: null,
      module_item_id: 7001,
      local_hash: 'L:header',
      canvas_hash: 'C:header',
      title: 'Theory',
    },
    local: {
      itemPath: HEADER,
      title: 'Theory',
      canvasType: 'sub_header',
      indent: 0,
      position: 0,
      localHash: 'L:header',
      localMtimeMs: LOCAL_TIME,
      dirty: false,
    },
    canvas: {
      moduleItemId: 7001,
      canvasType: 'sub_header',
      rawType: 'SubHeader',
      canvasId: null,
      pageUrl: null,
      title: 'Theory',
      indent: 0,
      position: 1,
      canvasHash: 'C:header',
      canvasUpdatedAt: CANVAS_TIME,
      suggestedPath: HEADER,
    },
  };
}

/**
 * The one-item course every truth-table row is a variation on: module
 * `01-intro`, page 1234 at `01-intro/01-welcome.md`, in step on all three
 * sides. Drop a side, or override its fields, to build a row.
 */
function single({
  base = true,
  local = true,
  canvas = true,
  localFields = {},
  canvasFields = {},
} = {}) {
  return {
    base: { modules: { [FOLDER]: bMod(base ? [PATH] : []) } },
    local: {
      modules: [
        lMod(FOLDER, local ? [PATH] : [], { items: { [PATH]: localFields } }),
      ],
    },
    canvas: {
      modules: [
        cMod(canvas ? [PATH] : [], { items: { [PATH]: canvasFields } }),
      ],
    },
  };
}

/** A module of three items, with each side's order given as a path list. */
const A = '01-intro/01-a.md';
const B = '01-intro/02-b.md';
const C = '01-intro/03-c.md';

function ordered({
  base = [A, B, C],
  local = [A, B, C],
  canvas = [A, B, C],
  extraItems = [],
} = {}) {
  return {
    base: { modules: { [FOLDER]: bMod(base) } },
    local: { modules: [lMod(FOLDER, local)] },
    canvas: { modules: [cMod(canvas, { extraItems })] },
  };
}

/** The action types, in the order the plan puts them. */
function types(result) {
  return result.actions.map((action) => action.type);
}

/** The one action of a type, asserting there is exactly one. */
function only(result, type) {
  const matches = result.actions.filter((action) => action.type === type);
  assert.equal(matches.length, 1, `expected exactly one ${type}`);
  return matches[0];
}

// ---------------------------------------------------------------------------

describe('plan: the truth table, row by row', () => {
  it('in base, unchanged, unchanged: nothing', () => {
    const result = plan({ ...single(), policy: {} });

    assert.deepEqual(types(result), []);
    assert.deepEqual(result.conflicts, []);
    assert.deepEqual(result.orphans, { canvas: [], local: [] });
  });

  it('in base, changed locally, unchanged on Canvas: update Canvas, same ids', () => {
    const result = plan({
      ...single({ localFields: { localHash: 'edited' } }),
      policy: {},
    });

    assert.deepEqual(types(result), ['update-canvas-item']);
    const action = only(result, 'update-canvas-item');
    assert.equal(action.canvasId, 1011);
    assert.equal(action.moduleItemId, 5011);
    assert.equal(action.pageUrl, 'page-1-1');
    assert.equal(action.canvasType, 'page');
    assert.equal(action.itemPath, PATH);
  });

  it('in base, unchanged locally, changed on Canvas: write the file', () => {
    const result = plan({
      ...single({ canvasFields: { canvasHash: 'edited' } }),
      policy: {},
    });

    assert.deepEqual(types(result), ['update-local-item']);
    const action = only(result, 'update-local-item');
    assert.equal(action.itemPath, PATH);
    assert.equal(action.canvasHash, 'edited');
    assert.equal(action.canvasUpdatedAt, CANVAS_TIME);
  });

  it('in base, changed on both sides: a conflict, not a write of either', () => {
    const result = plan({
      ...single({
        localFields: { localHash: 'edited' },
        canvasFields: { canvasHash: 'edited' },
      }),
      policy: { conflict: 'ask' },
    });

    assert.deepEqual(types(result), []);
    assert.equal(result.pending.conflicts.length, 1);
    assert.equal(result.pending.conflicts[0].itemPath, PATH);
  });

  it('not in base, present locally, absent on Canvas: create on Canvas', () => {
    const result = plan({
      ...single({ base: false, canvas: false }),
      policy: {},
    });

    assert.deepEqual(types(result), ['create-canvas-item']);
    const action = only(result, 'create-canvas-item');
    assert.equal(action.itemPath, PATH);
    assert.equal(action.canvasModuleId, 100);
    assert.equal(action.position, 1);
  });

  it('not in base, absent locally, present on Canvas: create the file', () => {
    const result = plan({
      ...single({ base: false, local: false }),
      policy: {},
    });

    assert.deepEqual(types(result), ['create-local-item']);
    const action = only(result, 'create-local-item');
    assert.equal(action.itemPath, PATH);
    assert.equal(action.canvasId, 1011);
    assert.equal(action.moduleItemId, 5011);
  });

  it('in base, gone locally, unchanged on Canvas: an orphan, never a delete', () => {
    const result = plan({ ...single({ local: false }), policy: {} });

    assert.deepEqual(types(result), []);
    assert.equal(result.orphans.canvas.length, 1);
    assert.deepEqual(result.orphans.local, []);
    const orphan = result.orphans.canvas[0];
    assert.equal(orphan.itemPath, PATH);
    assert.equal(orphan.pruned, false);
    assert.equal(orphan.canvasId, 1011);
  });

  it('in base, unchanged locally, gone from Canvas: an orphan here', () => {
    const result = plan({ ...single({ canvas: false }), policy: {} });

    assert.deepEqual(types(result), []);
    assert.equal(result.orphans.local.length, 1);
    assert.deepEqual(result.orphans.canvas, []);
    assert.equal(result.orphans.local[0].itemPath, PATH);
    assert.equal(result.orphans.local[0].pruned, false);
  });

  it('in base, gone locally, changed on Canvas: a decision, no action', () => {
    const result = plan({
      ...single({ local: false, canvasFields: { canvasHash: 'edited' } }),
      policy: { pruneCanvas: true },
    });

    assert.deepEqual(types(result), []);
    assert.deepEqual(result.orphans.canvas, []);
    assert.equal(result.decisions.length, 1);
    assert.equal(result.decisions[0].kind, 'local-deleted-canvas-changed');
    assert.equal(result.decisions[0].itemPath, PATH);
    assert.match(result.decisions[0].summary, /discard that work/);
  });

  it('in base, changed locally, gone from Canvas: a decision, no action', () => {
    const result = plan({
      ...single({ canvas: false, localFields: { localHash: 'edited' } }),
      policy: { pruneLocal: true },
    });

    assert.deepEqual(types(result), []);
    assert.deepEqual(result.orphans.local, []);
    assert.equal(result.decisions.length, 1);
    assert.equal(result.decisions[0].kind, 'local-changed-canvas-deleted');
  });

  it('in base, gone from both sides: converged, and reported nowhere', () => {
    const result = plan({
      ...single({ local: false, canvas: false }),
      policy: {},
    });

    assert.deepEqual(types(result), ['drop-base-row']);
    assert.deepEqual(result.orphans, { canvas: [], local: [] });
    assert.deepEqual(result.decisions, []);
    assert.deepEqual(result.conflicts, []);
    assert.deepEqual(result.skipped, []);
  });
});

describe('plan: unknown fingerprints point towards local', () => {
  it('reads a row with no stored local hash as changed here', () => {
    const course = single();
    course.base.modules[FOLDER].items[PATH].local_hash = null;

    // A row repaired by hand to adopt an existing Canvas object: pushing is
    // what records the fingerprints, and it is the direction git can undo.
    assert.deepEqual(types(plan({ ...course, policy: {} })), [
      'update-canvas-item',
    ]);
  });

  it('reads a row with no stored Canvas hash as unchanged there', () => {
    const course = single();
    course.base.modules[FOLDER].items[PATH].canvas_hash = null;

    assert.deepEqual(types(plan({ ...course, policy: {} })), []);
  });

  it('reads an unfingerprinted Canvas item as unchanged', () => {
    const result = plan({
      ...single({ canvasFields: { canvasHash: null } }),
      policy: {},
    });

    assert.deepEqual(types(result), []);
  });
});

describe('plan: conflict resolution', () => {
  const conflicted = (localFields = {}, canvasFields = {}) =>
    single({
      localFields: { localHash: 'edited', ...localFields },
      canvasFields: { canvasHash: 'edited', ...canvasFields },
    });

  it('newest: Canvas wins when its timestamp is later', () => {
    const result = plan({ ...conflicted(), policy: { conflict: 'newest' } });

    assert.deepEqual(types(result), ['update-local-item']);
    assert.equal(result.conflicts.length, 1);
    assert.equal(result.conflicts[0].winner, 'canvas');
    assert.equal(result.conflicts[0].applied, true);
    assert.match(result.conflicts[0].reason, /newest/);
  });

  it('newest: local wins when the file is the later of the two', () => {
    const result = plan({
      ...conflicted({}, { canvasUpdatedAt: '2026-08-19T07:00:00.000Z' }),
      policy: { conflict: 'newest' },
    });

    assert.deepEqual(types(result), ['update-canvas-item']);
    assert.equal(result.conflicts[0].winner, 'local');
  });

  it('newest: local wins a tie', () => {
    const result = plan({
      ...conflicted(
        {},
        { canvasUpdatedAt: new Date(LOCAL_TIME).toISOString() },
      ),
      policy: { conflict: 'newest' },
    });

    assert.equal(result.conflicts[0].winner, 'local');
  });

  it('newest: local wins when Canvas gives no timestamp', () => {
    const result = plan({
      ...conflicted({}, { canvasUpdatedAt: null }),
      policy: { conflict: 'newest' },
    });

    assert.deepEqual(types(result), ['update-canvas-item']);
    assert.equal(result.conflicts[0].winner, 'local');
    assert.equal(
      result.conflicts[0].reason,
      'newest: Canvas gave no usable timestamp, so it cannot prove it is newer',
      'a page has an `updated_at` and this one arrived without it, so the ' +
        'reason names Canvas. The reference types below and the module rename ' +
        'further down are the other case — nothing was asked for, or there is ' +
        'nothing to ask — and none of them may drift into this wording',
    );
  });

  it('newest: local wins when the Canvas timestamp will not parse', () => {
    const result = plan({
      ...conflicted({}, { canvasUpdatedAt: 'last Tuesday' }),
      policy: { conflict: 'newest' },
    });

    assert.equal(result.conflicts[0].winner, 'local');
  });

  /**
   * The same both-sides conflict over an item of one given type, shaped the way
   * `gather` really hands one over: a reference type carries no
   * `canvasUpdatedAt` at all, because its `REFERENCE_TYPES` branch returns the
   * module item and asks Canvas nothing further.
   */
  const typed = (canvasType) => ({
    base: {
      modules: {
        [FOLDER]: bMod([PATH], {
          rows: { [PATH]: { canvas_type: canvasType } },
        }),
      },
    },
    local: {
      modules: [
        lMod(FOLDER, [PATH], {
          items: { [PATH]: { canvasType, localHash: 'edited' } },
        }),
      ],
    },
    canvas: {
      modules: [
        cMod([PATH], {
          items: {
            [PATH]: { canvasType, canvasHash: 'edited', canvasUpdatedAt: null },
          },
        }),
      ],
    },
    policy: { conflict: 'newest' },
  });

  it('newest: an untimed type says which timestamp is missing and why', () => {
    // Local wins for all four, as it always did. What changes is the sentence:
    // "Canvas gave no usable timestamp" claims Canvas failed to supply
    // something, and none of these four ever had one to supply. Two shapes,
    // deliberately worded apart by what is untimed — a header and a link are
    // the whole object, while a quiz and an LTI tool sync as the module item
    // pointing at one. Neither shape may imply a fetch that would settle the
    // conflict: a Classic Quiz carries no timestamps at all, and an LTI tool's
    // time the installation rather than the item fields compared here.
    const expected = {
      sub_header:
        'newest: Canvas keeps no timestamp on a text header, so it cannot ' +
        'prove it is newer',
      external_url:
        'newest: Canvas keeps no timestamp on an external URL, so it cannot ' +
        'prove it is newer',
      quiz:
        'newest: a quiz syncs as its place in the module, and Canvas keeps no ' +
        'timestamp on that, so it cannot prove it is newer',
      external_tool:
        'newest: an LTI tool syncs as its place in the module, and Canvas ' +
        'keeps no timestamp on that, so it cannot prove it is newer',
    };

    for (const [canvasType, reason] of Object.entries(expected)) {
      const result = plan(typed(canvasType));

      assert.deepEqual(types(result), ['update-canvas-item'], canvasType);
      assert.equal(result.conflicts.length, 1, canvasType);
      assert.equal(result.conflicts[0].winner, 'local', canvasType);
      assert.equal(result.conflicts[0].applied, true, canvasType);
      assert.equal(result.conflicts[0].reason, reason, canvasType);
    }
  });

  it('every reference type has a reason of its own, not the Canvas one', () => {
    // The coverage guard, walked over `REFERENCE_TYPES` rather than over a
    // list repeated here: a fifth type added to that set reaches this same
    // untimed branch, and without a sentence of its own it would silently fall
    // back to blaming Canvas for a timestamp nothing ever requested.
    for (const canvasType of REFERENCE_TYPES) {
      const result = plan(typed(canvasType));

      assert.equal(result.conflicts.length, 1, canvasType);
      assert.notEqual(
        result.conflicts[0].reason,
        'newest: Canvas gave no usable timestamp, so it cannot prove it is newer',
        `${canvasType} has no reason of its own in UNTIMED_ITEM_REASONS`,
      );
    }
  });

  it('local: pins the local side whatever the timestamps say', () => {
    const result = plan({ ...conflicted(), policy: { conflict: 'local' } });

    assert.deepEqual(types(result), ['update-canvas-item']);
    assert.equal(result.conflicts[0].winner, 'local');
    assert.equal(result.conflicts[0].reason, 'policy local');
  });

  it('canvas: pins the Canvas side', () => {
    const result = plan({
      ...conflicted({}, { canvasUpdatedAt: '2026-01-01T00:00:00.000Z' }),
      policy: { conflict: 'canvas' },
    });

    assert.deepEqual(types(result), ['update-local-item']);
    assert.equal(result.conflicts[0].winner, 'canvas');
  });

  it('ask: pends the item and decides nothing', () => {
    const result = plan({ ...conflicted(), policy: { conflict: 'ask' } });

    assert.deepEqual(types(result), []);
    assert.deepEqual(result.conflicts, []);
    assert.equal(result.pending.conflicts.length, 1);
    assert.deepEqual(result.pending.conflicts[0].localMtimeMs, LOCAL_TIME);
    assert.equal(result.pending.conflicts[0].canvasUpdatedAt, CANVAS_TIME);
  });

  it('an answer beats every one of the four policies', () => {
    for (const conflict of ['newest', 'local', 'canvas', 'ask']) {
      const result = plan({
        ...conflicted(),
        policy: { conflict, resolved: { conflicts: { [PATH]: 'canvas' } } },
      });

      assert.deepEqual(types(result), ['update-local-item'], conflict);
      assert.equal(result.conflicts[0].winner, 'canvas', conflict);
      assert.equal(result.conflicts[0].reason, 'answered', conflict);
      assert.deepEqual(result.pending.conflicts, [], conflict);
    }
  });

  it('an answer of local beats a canvas policy too', () => {
    const result = plan({
      ...conflicted(),
      policy: {
        conflict: 'canvas',
        resolved: { conflicts: { [PATH]: 'local' } },
      },
    });

    assert.deepEqual(types(result), ['update-canvas-item']);
  });

  it('an answer of skip reports a remedy rather than a winner', () => {
    const result = plan({
      ...conflicted(),
      policy: { conflict: 'ask', resolved: { conflicts: { [PATH]: 'skip' } } },
    });

    assert.deepEqual(types(result), []);
    assert.deepEqual(result.pending.conflicts, []);
    assert.equal(result.skipped.length, 1);
    assert.equal(result.skipped[0].reason, 'conflict-unresolved');
    assert.match(result.skipped[0].remedy, /--conflict local/);
  });

  it('refuses a policy value it does not know', () => {
    assert.throws(
      () => plan({ ...single(), policy: { conflict: 'newst' } }),
      /Unknown conflict policy "newst"/,
    );
    assert.throws(
      () => plan({ ...single(), policy: { order: 'whatever' } }),
      /Unknown order policy/,
    );
    assert.throws(
      () => plan({ ...single(), policy: { adopt: 'both' } }),
      /Unknown adopt policy "both"/,
    );
    assert.throws(
      () =>
        plan({
          ...single(),
          policy: { resolved: { conflicts: { [PATH]: 'mine' } } },
        }),
      /Unknown conflict answer "mine"/,
    );
  });
});

describe('plan: the git guard', () => {
  it('blocks a write into a file with uncommitted changes', () => {
    const result = plan({
      ...single({
        localFields: { dirty: true },
        canvasFields: { canvasHash: 'edited' },
      }),
      policy: {},
    });

    assert.deepEqual(types(result), []);
    assert.equal(result.skipped.length, 1);
    assert.equal(result.skipped[0].reason, 'git-dirty');
    assert.equal(result.skipped[0].action, 'update-local-item');
    assert.match(result.skipped[0].remedy, /01-intro\/01-welcome\.md/);
    assert.match(result.skipped[0].remedy, /Commit or stash/);
  });

  it('blocks a write the author asked for, when the file is dirty', () => {
    const result = plan({
      ...single({
        localFields: { dirty: true, localHash: 'edited' },
        canvasFields: { canvasHash: 'edited' },
      }),
      policy: {
        conflict: 'ask',
        resolved: { conflicts: { [PATH]: 'canvas' } },
      },
    });

    assert.deepEqual(types(result), []);
    assert.equal(result.conflicts[0].winner, 'canvas');
    assert.equal(
      result.conflicts[0].applied,
      false,
      'the answer is recorded, and the write it asked for still did not happen',
    );
    assert.equal(result.skipped[0].reason, 'git-dirty');
  });

  it('names the refusal on the conflict it would not settle', () => {
    // `applied: false` alone conflates two opposite situations. Under a pinned
    // direction the write was never going to be made and `npx course sync` is
    // exactly what settles it; under a guard the write was refused, sync meets
    // the same guard, and that advice is the one thing that cannot help. The
    // report has to tell them apart, so the planner has to say which it was.
    const guarded = plan({
      ...single({
        localFields: { dirty: true, localHash: 'edited' },
        canvasFields: { canvasHash: 'edited' },
      }),
      policy: { conflict: 'canvas' },
    });

    assert.equal(guarded.conflicts[0].applied, false);
    assert.equal(guarded.conflicts[0].refusal, 'git-dirty');
    assert.equal(
      guarded.skipped[0].reason,
      'git-dirty',
      'the accurate remedy is on that entry, and this is the link to it',
    );

    const pinned = plan({
      ...single({
        localFields: { localHash: 'edited' },
        canvasFields: { canvasHash: 'edited' },
      }),
      policy: { write: { canvas: true, local: false }, conflict: 'canvas' },
    });

    assert.equal(pinned.conflicts[0].applied, false);
    assert.equal(
      pinned.conflicts[0].refusal,
      null,
      'nothing refused this one; the policy withheld it',
    );
  });

  it('names the refusal for a guard that is not the git one', () => {
    // `refusalSince` reads the skip list rather than any one guard, so the
    // type-changed refusal — the other reason a conflict's winning write never
    // reaches Canvas — is covered without being named.
    const result = plan({
      ...single({
        localFields: { canvasType: 'assignment', localHash: 'edited' },
        canvasFields: { canvasHash: 'edited' },
      }),
      policy: { conflict: 'local' },
    });

    assert.deepEqual(types(result), []);
    assert.equal(result.conflicts[0].winner, 'local');
    assert.equal(result.conflicts[0].applied, false);
    assert.equal(result.conflicts[0].refusal, 'type-changed');
  });

  it('blocks a local prune of a dirty file', () => {
    const result = plan({
      ...single({ canvas: false, localFields: { dirty: true } }),
      policy: { pruneLocal: true },
    });

    assert.deepEqual(types(result), []);
    assert.equal(result.orphans.local[0].pruned, false);
    assert.equal(result.skipped[0].reason, 'git-dirty');
    assert.equal(result.skipped[0].action, 'delete-local-item');
  });

  it('does not block a write to Canvas', () => {
    const result = plan({
      ...single({ localFields: { dirty: true, localHash: 'edited' } }),
      policy: {},
    });

    assert.deepEqual(
      types(result),
      ['update-canvas-item'],
      'Canvas is not where the undo lives, so a dirty file is no reason to ' +
        'refuse a push',
    );
    assert.deepEqual(result.skipped, []);
  });

  it('does not block a Canvas prune', () => {
    const result = plan({
      ...single({ local: false }),
      policy: { pruneCanvas: true },
    });

    assert.deepEqual(types(result), ['delete-canvas-item']);
  });

  it('withholds rather than skips a local write the policy already forbids', () => {
    // Under a Canvas-pinned run this write was never going to happen, so there
    // is nothing for the guard to protect. Recording a skip would put the file
    // under "Skipped" with a remedy telling the author to commit or stash it,
    // and a skip fails the run — over a file push does not touch.
    const result = plan({
      ...single({
        localFields: { dirty: true },
        canvasFields: { canvasHash: 'edited' },
      }),
      policy: { write: { canvas: true, local: false } },
    });

    assert.deepEqual(result.skipped, []);
    assert.equal(result.withheld.length, 1);
    assert.equal(result.withheld[0].type, 'update-local-item');
    assert.equal(result.withheld[0].reason, 'write-policy');
  });

  it('still skips a local prune the policy allows, dirty file and all', () => {
    // The mirror of the case above: `pull --prune-local` does write here, so
    // the guard is the only thing standing between a dirty file and its
    // deletion.
    const result = plan({
      ...single({ canvas: false, localFields: { dirty: true } }),
      policy: { write: { canvas: false, local: true }, pruneLocal: true },
    });

    assert.deepEqual(types(result), []);
    assert.equal(result.skipped[0].reason, 'git-dirty');
    assert.equal(result.skipped[0].action, 'delete-local-item');
  });
});

describe('plan: what the write policy forbids is withheld, not lost', () => {
  it('push leaves a remote edit alone and says so', () => {
    const result = plan({
      ...single({ canvasFields: { canvasHash: 'edited' } }),
      policy: { write: { canvas: true, local: false } },
    });

    assert.deepEqual(types(result), []);
    assert.equal(result.withheld.length, 1);
    assert.equal(result.withheld[0].type, 'update-local-item');
    assert.equal(result.withheld[0].side, 'local');
    assert.equal(result.withheld[0].reason, 'write-policy');
    assert.equal(result.withheld[0].itemPath, PATH);
  });

  it('pull leaves a local edit alone and says so', () => {
    const result = plan({
      ...single({ localFields: { localHash: 'edited' } }),
      policy: { write: { canvas: false, local: true } },
    });

    assert.deepEqual(types(result), []);
    assert.equal(result.withheld[0].type, 'update-canvas-item');
    assert.equal(result.withheld[0].side, 'canvas');
  });

  it('status writes nothing and reports everything', () => {
    const course = {
      base: {
        modules: {
          [FOLDER]: bMod([A, B, C]),
          '02-basics': bMod([], { canvasModuleId: 200, name: 'Basics' }),
        },
      },
      local: {
        modules: [
          lMod(FOLDER, [A, C, B], {
            items: { [A]: { localHash: 'edited' } },
          }),
          lMod('02-basics', [], { name: 'Basics', position: 2 }),
        ],
      },
      canvas: {
        modules: [
          cMod([A, B, C], { items: { [B]: { canvasHash: 'edited' } } }),
          cMod([], { canvasModuleId: 200, name: 'Basics', position: 2 }),
        ],
      },
    };

    const preview = plan({
      ...course,
      policy: { write: { canvas: false, local: false } },
    });
    const real = plan({ ...course, policy: {} });

    assert.deepEqual(preview.actions, [], 'status writes nothing');
    assert.deepEqual(
      preview.withheld.map((entry) => entry.type),
      types(real),
      'and withholds exactly what a real run would have done',
    );
    assert.deepEqual(
      preview.ordering.map(({ applied: _applied, ...rest }) => rest),
      real.ordering.map(({ applied: _applied, ...rest }) => rest),
      'the same ordering decision, only not carried out',
    );
    assert.equal(real.ordering[0].applied, true);
    assert.equal(preview.ordering[0].applied, false);
    assert.deepEqual(preview.orphans, real.orphans);
  });

  it('withholds the state-file writes too, since status writes no file either', () => {
    const result = plan({
      ...single({ local: false, canvas: false }),
      policy: { write: { canvas: false, local: false } },
    });

    assert.deepEqual(types(result), []);
    assert.equal(result.withheld[0].type, 'drop-base-row');
  });
});

describe('plan: ordering', () => {
  it('says nothing when neither side moved', () => {
    const result = plan({ ...ordered(), policy: { order: 'ask' } });

    assert.deepEqual(types(result), []);
    assert.deepEqual(result.ordering, []);
  });

  it('takes the local order when only local moved', () => {
    const result = plan({
      ...ordered({ local: [B, A, C] }),
      policy: { order: 'ask' },
    });

    assert.deepEqual(types(result), ['reorder-canvas-module']);
    assert.equal(result.ordering.length, 1);
    assert.equal(result.ordering[0].winner, 'local');
    assert.equal(result.ordering[0].reason, 'only this side reordered');
    assert.deepEqual(result.pending.order, []);
    assert.deepEqual(
      only(result, 'reorder-canvas-module').order.map((o) => [
        o.itemPath,
        o.moduleItemId,
        o.position,
      ]),
      [
        [B, 5012, 1],
        [A, 5011, 2],
        [C, 5013, 3],
      ],
    );
  });

  it('takes the Canvas order when only Canvas moved', () => {
    const result = plan({
      ...ordered({ canvas: [B, A, C] }),
      policy: { order: 'ask' },
    });

    assert.deepEqual(types(result), ['reorder-local-module']);
    assert.equal(result.ordering[0].winner, 'canvas');
    assert.deepEqual(
      only(result, 'reorder-local-module').order.map((o) => o.itemPath),
      [B, A, C],
    );
  });

  it('says nothing when both sides moved to the same order', () => {
    const result = plan({
      ...ordered({ local: [C, A, B], canvas: [C, A, B] }),
      policy: { order: 'ask' },
    });

    assert.deepEqual(types(result), []);
    assert.deepEqual(result.ordering, []);
  });

  it('asks once per module when both moved differently', () => {
    const result = plan({
      ...ordered({ local: [B, A, C], canvas: [C, A, B] }),
      policy: { order: 'ask' },
    });

    assert.deepEqual(types(result), []);
    assert.equal(result.pending.order.length, 1);
    assert.deepEqual(result.pending.order[0], {
      folder: FOLDER,
      base: [A, B, C],
      local: [B, A, C],
      canvas: [C, A, B],
    });
    assert.equal(result.ordering[0].skipped, true);
    assert.match(result.ordering[0].reason, /awaiting an answer/);
  });

  it('resolves a contested order by policy', () => {
    for (const [order, action] of [
      ['local', 'reorder-canvas-module'],
      ['canvas', 'reorder-local-module'],
    ]) {
      const result = plan({
        ...ordered({ local: [B, A, C], canvas: [C, A, B] }),
        policy: { order },
      });

      assert.deepEqual(types(result), [action], order);
      assert.equal(result.ordering[0].winner, order);
      assert.equal(result.ordering[0].reason, `policy ${order}`);
      assert.equal(result.ordering[0].applied, true);
    }
  });

  it('asks nothing when the caller never said it could ask', () => {
    // The default, and the reason it is `skip` rather than `ask`: `push`,
    // `pull` and `status` all pass no order policy, and none of them collects
    // what `ask` parks in `pending.order`. A caller that cannot answer must not
    // be handed a question, and the author must not read that one is coming.
    const result = plan({
      ...ordered({ local: [B, A, C], canvas: [C, A, B] }),
      policy: {},
    });

    assert.deepEqual(types(result), []);
    assert.deepEqual(result.pending.order, [], 'nothing is left pending');
    assert.equal(result.ordering[0].skipped, true);
    assert.doesNotMatch(result.ordering[0].reason, /awaiting an answer/);
    assert.match(result.ordering[0].reason, /never asks which wins/);
    assert.match(
      result.ordering[0].reason,
      /`npx course sync` is the one that does/,
      'the line names the one command that settles it',
    );
    // Both orders travel with the entry, so the report can print them.
    assert.deepEqual(result.ordering[0].local, [B, A, C]);
    assert.deepEqual(result.ordering[0].canvas, [C, A, B]);
  });

  it('takes skip as a policy in its own right', () => {
    const result = plan({
      ...ordered({ local: [B, A, C], canvas: [C, A, B] }),
      policy: { order: 'skip' },
    });

    assert.deepEqual(types(result), []);
    assert.deepEqual(result.pending.order, []);
    assert.match(result.ordering[0].reason, /never asks which wins/);
  });

  it('leaves a one-sided reorder alone under skip, the way ask does', () => {
    // `order` bites only on a contested reorder. A module only one side moved
    // is not a question, so the default must not turn it into one.
    const result = plan({
      ...ordered({ local: [B, A, C] }),
      policy: {},
    });

    assert.deepEqual(types(result), ['reorder-canvas-module']);
    assert.equal(result.ordering[0].winner, 'local');
    assert.equal(result.ordering[0].reason, 'only this side reordered');
  });

  it('an answer beats the order policy', () => {
    const result = plan({
      ...ordered({ local: [B, A, C], canvas: [C, A, B] }),
      policy: { order: 'ask', resolved: { order: { [FOLDER]: 'canvas' } } },
    });

    assert.deepEqual(types(result), ['reorder-local-module']);
    assert.equal(result.ordering[0].reason, 'answered');
    assert.deepEqual(result.pending.order, []);
  });

  it('an answer of skip records the skip and reorders nothing', () => {
    const result = plan({
      ...ordered({ local: [B, A, C], canvas: [C, A, B] }),
      policy: { order: 'ask', resolved: { order: { [FOLDER]: 'skip' } } },
    });

    assert.deepEqual(types(result), []);
    assert.deepEqual(result.pending.order, []);
    assert.equal(result.ordering[0].skipped, true);
    assert.match(result.ordering[0].reason, /neither was chosen/);
  });

  it('an item added at the top is a membership change, not a reorder', () => {
    // The one that is easy to get wrong: unrestricted, [new, b, c] against a
    // base of [b, c] looks like every item moved down one.
    const result = plan({
      ...ordered({ base: [B, C], local: [A, B, C], canvas: [B, C] }),
      policy: { order: 'ask' },
    });

    assert.deepEqual(types(result), ['create-canvas-item']);
    assert.deepEqual(result.ordering, []);
    assert.deepEqual(result.pending.order, []);
  });

  it('an item removed from the middle is not a reorder either', () => {
    const result = plan({
      ...ordered({ base: [A, B, C], local: [A, C], canvas: [A, B, C] }),
      policy: { order: 'ask' },
    });

    assert.deepEqual(types(result), []);
    assert.deepEqual(result.ordering, []);
    assert.equal(result.orphans.canvas.length, 1);
  });

  it('is suppressed for a module holding an unrecognised item, with the reason', () => {
    const result = plan({
      ...ordered({
        local: [B, A, C],
        extraItems: [
          {
            moduleItemId: 9999,
            canvasType: null,
            rawType: 'AssessmentQuestion',
            title: 'Something new',
            position: 99,
            recognised: false,
          },
        ],
      }),
      policy: { order: 'ask', pruneCanvas: true },
    });

    assert.deepEqual(
      types(result),
      [],
      'membership and content are still reconciled; only the order is not',
    );
    assert.equal(result.ordering.length, 1);
    assert.equal(result.ordering[0].skipped, true);
    assert.match(result.ordering[0].reason, /does not understand/);
    assert.deepEqual(result.ordering[0].unrecognised, ['AssessmentQuestion']);

    assert.deepEqual(result.unrecognised, [
      {
        moduleFolder: FOLDER,
        canvasModuleId: 100,
        moduleItemId: 9999,
        rawType: 'AssessmentQuestion',
        canvasType: null,
        title: 'Something new',
      },
    ]);
  });

  it('never fabricates a local file for an unrecognised item', () => {
    const result = plan({
      ...ordered({
        extraItems: [
          {
            moduleItemId: 9999,
            rawType: 'Wiki',
            title: 'Mystery',
            position: 99,
            recognised: false,
          },
        ],
      }),
      policy: { pruneCanvas: true, pruneLocal: true },
    });

    assert.deepEqual(types(result), []);
    assert.deepEqual(result.orphans.canvas, []);
  });

  it('treats a type this version does not know as unrecognised by default', () => {
    const result = plan({
      ...ordered({
        local: [B, A, C],
        extraItems: [
          {
            moduleItemId: 9999,
            canvasType: 'wiki_gadget',
            rawType: 'WikiGadget',
            title: 'Part one',
            position: 99,
          },
        ],
      }),
      policy: { order: 'ask' },
    });

    assert.equal(
      result.unrecognised.length,
      1,
      'a caller that forgets the flag gets the cautious answer',
    );
    assert.deepEqual(
      types(result),
      [],
      'and the cautious answer still switches ordering off for the module',
    );
    assert.equal(result.ordering[0].skipped, true);
  });

  it('reconciles the order of a module holding a text header', () => {
    // The regression: every subfolder inside a module folder becomes a Canvas
    // text header, so treating that type as ununderstandable switched ordering
    // off for most real modules. Note that `recognised` is deliberately not
    // set here — the default is the thing under test.
    const header = plainHeader();
    const base = bMod([A, B, C]);
    base.item_order = [HEADER, A, B, C];
    base.items = { [HEADER]: header.row, ...base.items };

    const local = lMod(FOLDER, [B, A, C]);
    local.items = [header.local, ...local.items];

    const canvas = cMod([A, B, C]);
    canvas.items = [
      header.canvas,
      ...canvas.items.map((item) => ({ ...item, position: item.position + 1 })),
    ];

    const result = plan({
      base: { modules: { [FOLDER]: base } },
      local: { modules: [local] },
      canvas: { modules: [canvas] },
      policy: { order: 'ask' },
    });

    assert.deepEqual(result.unrecognised, []);
    assert.deepEqual(types(result), ['reorder-canvas-module']);
    assert.equal(result.ordering.length, 1);
    assert.equal(result.ordering[0].skipped, false);
    assert.equal(result.ordering[0].winner, 'local');
    assert.deepEqual(result.ordering[0].local, [HEADER, B, A, C]);
  });

  it('matches a text header through its module item id', () => {
    const header = plainHeader();
    const base = bMod([]);
    base.item_order = [HEADER];
    base.items = { [HEADER]: header.row };
    const local = lMod(FOLDER, []);
    local.items = [header.local];

    const course = {
      base: { modules: { [FOLDER]: base } },
      local: { modules: [local] },
      canvas: { modules: [cMod([], { extraItems: [header.canvas] })] },
    };

    assert.deepEqual(
      types(plan({ ...course, policy: {} })),
      [],
      'no content id, so the row finds it by module item id or not at all',
    );

    const retitled = structuredClone(course);
    retitled.canvas.modules[0].items[0].canvasHash = 'C:renamed';
    retitled.canvas.modules[0].items[0].title = 'Background';

    const result = plan({ ...retitled, policy: {} });
    assert.deepEqual(
      types(result),
      ['update-local-item'],
      'a text header renamed in Canvas is an ordinary remote change',
    );
    assert.equal(only(result, 'update-local-item').itemPath, HEADER);
    assert.equal(only(result, 'update-local-item').title, 'Background');
  });
});

describe('plan: the collision guard', () => {
  it('refuses a module both sides hold and the state knows nothing about', () => {
    const result = plan({
      ...single({ base: false }),
      policy: {},
    });

    assert.deepEqual(
      types(result),
      [],
      'creating both sides would duplicate the module',
    );
    assert.equal(result.collision.modules.length, 1);
    assert.deepEqual(result.collision.modules[0], {
      folder: FOLDER,
      canvasModuleId: 100,
      name: 'Introduction',
      localItems: 1,
      canvasItems: 1,
    });
    assert.match(result.collision.message, /1 local, 1 on Canvas/);
    assert.match(result.collision.message, /npx course push/);
    assert.match(result.collision.message, /npx course pull/);
  });

  it('refuses it on a module row that names a module but no items', () => {
    // A run that died between creating the module and recording its contents
    // duplicates exactly as thoroughly as no row at all.
    const course = single({ base: false });
    assert.deepEqual(course.base.modules[FOLDER].items, {});

    assert.equal(plan({ ...course, policy: {} }).collision.modules.length, 1);
  });

  it('pairs the two sides by name when nothing else links them', () => {
    const result = plan({
      base: { modules: {} },
      local: { modules: [lMod(FOLDER, [PATH])] },
      canvas: { modules: [cMod([PATH])] },
      policy: {},
    });

    assert.deepEqual(types(result), []);
    assert.equal(result.collision.modules.length, 1);
  });

  it('does not trip on a module that is new locally', () => {
    const result = plan({
      base: { modules: {} },
      local: { modules: [lMod(FOLDER, [PATH])] },
      canvas: { modules: [] },
      policy: {},
    });

    assert.equal(result.collision, null);
    assert.deepEqual(types(result), [
      'create-canvas-module',
      'create-canvas-item',
    ]);
  });

  it('does not trip on a module that is new on Canvas', () => {
    const result = plan({
      base: { modules: {} },
      local: { modules: [] },
      canvas: { modules: [cMod([PATH], { suggestedFolder: FOLDER })] },
      policy: {},
    });

    assert.equal(result.collision, null);
    assert.deepEqual(types(result), [
      'create-local-module',
      'create-local-item',
    ]);
    assert.equal(only(result, 'create-local-module').folder, FOLDER);
  });

  it('does not trip when the module exists on both sides but only one holds items', () => {
    const result = plan({
      base: { modules: {} },
      local: { modules: [lMod(FOLDER, [PATH])] },
      canvas: { modules: [cMod([])] },
      policy: {},
    });

    assert.equal(result.collision, null);
    assert.deepEqual(
      types(result),
      ['link-base-module', 'create-canvas-item'],
      'the module is adopted rather than created a second time, and the state ' +
        'is told which Canvas module it is',
    );
    assert.equal(only(result, 'create-canvas-item').canvasModuleId, 100);
  });

  it('does not trip on an empty course', () => {
    const result = plan({
      base: { modules: {} },
      local: { modules: [] },
      canvas: { modules: [] },
      policy: {},
    });

    assert.equal(result.collision, null);
    assert.deepEqual(types(result), []);
  });

  it('judges it per module, and lets the innocent one through', () => {
    const result = plan({
      base: { modules: {} },
      local: {
        modules: [
          lMod('01-alpha', ['01-alpha/01-a.md'], { name: 'Alpha' }),
          lMod('02-beta', ['02-beta/01-a.md'], { name: 'Beta', position: 2 }),
        ],
      },
      canvas: {
        modules: [cMod(['01-alpha/01-a.md'], { name: 'Alpha' })],
      },
      policy: {},
    });

    assert.equal(result.collision.modules.length, 1);
    assert.equal(result.collision.modules[0].folder, '01-alpha');
    assert.deepEqual(
      types(result),
      ['create-canvas-module', 'create-canvas-item'],
      'the genuinely new module is still created',
    );
    assert.equal(only(result, 'create-canvas-module').folder, '02-beta');
  });
});

describe('plan: adoption', () => {
  /**
   * The collision case, exactly: a module row that names a Canvas module and
   * knows nothing about what is in it, with the same page on both sides. What
   * `sync` refuses, a pinned direction adopts.
   */
  const both = (extra = {}) => single({ base: false, ...extra });

  it('claims the Canvas page instead of creating a second one', () => {
    const result = plan({ ...both(), policy: { adopt: 'local' } });

    assert.equal(result.collision, null);
    assert.deepEqual(types(result), ['update-canvas-item']);
    const action = only(result, 'update-canvas-item');
    assert.equal(action.itemPath, PATH);
    assert.equal(action.canvasId, 1011);
    assert.equal(action.moduleItemId, 5011);
    assert.equal(action.pageUrl, 'page-1-1');
    assert.equal(action.canvasType, 'page');

    assert.equal(result.adopted.length, 1);
    assert.deepEqual(result.adopted[0], {
      moduleFolder: FOLDER,
      itemPath: PATH,
      title: 'welcome',
      canvasType: 'page',
      canvasId: 1011,
      moduleItemId: 5011,
      direction: 'local',
      applied: true,
    });
  });

  it('marks the update as an adoption, which nothing else told apart', () => {
    // `planCanvasUpdate` and `adoptPair` emit the same type and, before this,
    // the same fields. The executor needs the difference for one thing:
    // `writeTitleIfAbsent`, which puts a `title:` into a markdown item that
    // declares none so that its Canvas name stops following its filename
    // around. Creating an object and claiming one are the same moment for that
    // — and an ordinary push is not, because writing into a file the author is
    // merely pushing would be sync editing their tree unasked.
    assert.equal(
      only(
        plan({ ...both(), policy: { adopt: 'local' } }),
        'update-canvas-item',
      ).adopted,
      true,
    );

    const ordinary = plan({
      base: { modules: { [FOLDER]: bMod([PATH]) } },
      local: {
        modules: [
          lMod(FOLDER, [PATH], {
            items: { [PATH]: { localHash: 'L:edited' } },
          }),
        ],
      },
      canvas: { modules: [cMod([PATH])] },
      policy: {},
    });
    assert.equal(
      only(ordinary, 'update-canvas-item').adopted,
      undefined,
      'an ordinary update must not claim to be an adoption',
    );
  });

  it('claims it the other way round under a Canvas-pinned run', () => {
    const result = plan({ ...both(), policy: { adopt: 'canvas' } });

    assert.equal(result.collision, null);
    assert.deepEqual(types(result), ['update-local-item']);
    const action = only(result, 'update-local-item');
    assert.equal(action.itemPath, PATH);
    assert.equal(action.canvasId, 1011);
    assert.equal(action.moduleItemId, 5011);
    assert.equal(action.canvasHash, `C:${PATH}`);
    assert.equal(action.canvasUpdatedAt, CANVAS_TIME);

    assert.equal(result.adopted.length, 1);
    assert.equal(result.adopted[0].direction, 'canvas');
    assert.equal(result.adopted[0].applied, true);
  });

  /**
   * A course the state knows nothing at all about — no module row, not even an
   * empty one. `both()` above is the other shape: a row that names the Canvas
   * module and lists none of its items. Only this one leaves the planner with
   * no record of which Canvas module the folder is.
   */
  const unknownCourse = () => ({
    base: { modules: {} },
    local: { modules: [lMod(FOLDER, [PATH])] },
    canvas: { modules: [cMod([PATH])] },
  });

  it('writes down which Canvas module the folder is', () => {
    const result = plan({ ...unknownCourse(), policy: { adopt: 'local' } });

    assert.deepEqual(types(result), ['link-base-module', 'update-canvas-item']);
    const link = only(result, 'link-base-module');
    assert.equal(link.folder, FOLDER);
    assert.equal(link.canvasModuleId, 100);
    assert.equal(link.name, 'Introduction');
    assert.equal(link.position, 1, 'the local slot, not the Canvas one');
  });

  it('writes it down under a Canvas-pinned run too', () => {
    // The link is a state operation, so it survives either pin. An
    // `update-canvas-module` would not: `emit` withholds a Canvas-side action
    // here, and pull would record nothing.
    const result = plan({ ...unknownCourse(), policy: { adopt: 'canvas' } });

    assert.ok(types(result).includes('link-base-module'));
    assert.deepEqual(result.withheld, []);
  });

  it('records the local spelling of the name', () => {
    // Pairing compares names with case and padding taken out, so the two sides
    // can pair while disagreeing about how the name is written. The base is
    // read back against the local side on the next run, so the local spelling
    // is the one that keeps it quiet.
    const result = plan({
      base: { modules: {} },
      local: { modules: [lMod(FOLDER, [PATH], { name: 'Introduction' })] },
      canvas: { modules: [cMod([PATH], { name: '  introduction ' })] },
      policy: { adopt: 'local' },
    });

    assert.deepEqual(types(result), ['link-base-module', 'update-canvas-item']);
    assert.equal(only(result, 'link-base-module').name, 'Introduction');
  });

  it('writes nothing down for a module only one side holds', () => {
    // A module being created on Canvas records its id from the create; a module
    // being created locally records it from that. Neither needs a link.
    const created = plan({
      base: { modules: {} },
      local: { modules: [lMod(FOLDER, [PATH])] },
      canvas: { modules: [] },
      policy: { adopt: 'local' },
    });
    assert.ok(!types(created).includes('link-base-module'));
  });

  it('writes nothing down for a module the run refuses', () => {
    // No policy switches the link off — but a collided module is refused
    // before `planModuleMetadata` is reached at all, so nothing about it is
    // recorded either.
    const result = plan({ ...unknownCourse(), policy: { adopt: null } });

    assert.ok(result.collision);
    assert.deepEqual(types(result), []);
  });

  it('writes it down under plain sync, where adoption never runs', () => {
    // A pair with items on one side only never trips the collision guard, so
    // `sync` reaches the same branch with no adoption anywhere. Gating the
    // link on `policy.adopt` left this case broken in exactly the way the
    // adopting one was.
    const result = plan({
      base: { modules: {} },
      local: { modules: [lMod(FOLDER, [PATH])] },
      canvas: { modules: [cMod([])] },
      policy: {},
    });

    assert.equal(result.collision, null);
    assert.deepEqual(types(result), ['link-base-module', 'create-canvas-item']);
    assert.equal(only(result, 'link-base-module').canvasModuleId, 100);
  });

  it('writes it down from the other side of the same branch', () => {
    // The mirror: the Canvas module holds the items and the local folder is
    // empty. Same pairing, same missing link, and the item write that follows
    // is a local one.
    const result = plan({
      base: { modules: {} },
      local: { modules: [lMod(FOLDER, [])] },
      canvas: { modules: [cMod([PATH])] },
      policy: {},
    });

    assert.equal(result.collision, null);
    assert.deepEqual(types(result), ['link-base-module', 'create-local-item']);
    assert.equal(only(result, 'link-base-module').folder, FOLDER);
    assert.equal(only(result, 'link-base-module').canvasModuleId, 100);
  });

  it('refuses the same course when no direction is pinned', () => {
    // The proof that `sync` did not quietly change: with both sides writable
    // nothing can say which copy is the newer, so the refusal stands.
    const result = plan({ ...both(), policy: { adopt: null } });

    assert.deepEqual(types(result), []);
    assert.deepEqual(result.adopted, []);
    assert.equal(result.collision.modules.length, 1);
    assert.equal(result.collision.modules[0].folder, FOLDER);
  });

  it('matches on the title, not on the prefix a position would give it', () => {
    // `suggestedPath` is built from the title *and* the Canvas position, so an
    // item sitting third there and first here never matches on it.
    const result = plan({
      base: { modules: { [FOLDER]: bMod([]) } },
      local: { modules: [lMod(FOLDER, [PATH])] },
      canvas: {
        modules: [
          cMod([PATH], {
            items: {
              [PATH]: { position: 3, suggestedPath: '01-intro/03-welcome.md' },
            },
          }),
        ],
      },
      policy: { adopt: 'local' },
    });

    assert.deepEqual(types(result), ['update-canvas-item']);
    assert.equal(only(result, 'update-canvas-item').itemPath, PATH);
  });

  it('matches titles that differ only in case and padding', () => {
    const result = plan({
      ...both({
        localFields: { title: 'Welcome' },
        canvasFields: { title: '  welcome  ' },
      }),
      policy: { adopt: 'local' },
    });

    assert.deepEqual(types(result), ['update-canvas-item']);
    assert.equal(only(result, 'update-canvas-item').title, 'Welcome');
  });

  it('never adopts across types, which would be a conversion', () => {
    const result = plan({
      ...both({
        canvasFields: { canvasType: 'assignment', rawType: 'Assignment' },
      }),
      policy: { adopt: 'local' },
    });

    assert.deepEqual(result.adopted, []);
    assert.deepEqual(types(result), [
      'create-canvas-item',
      'create-local-item',
    ]);
  });

  it('adopts a quiz by title, which no id could match', () => {
    const QUIZ = '01-intro/05-quiz.md';
    const result = plan({
      base: { modules: { [FOLDER]: bMod([]) } },
      local: {
        modules: [
          lMod(FOLDER, [QUIZ], { items: { [QUIZ]: { canvasType: 'quiz' } } }),
        ],
      },
      canvas: {
        modules: [
          cMod([QUIZ], {
            items: {
              [QUIZ]: {
                canvasType: 'quiz',
                rawType: 'Quiz',
                canvasId: null,
                pageUrl: null,
              },
            },
          }),
        ],
      },
      policy: { adopt: 'local' },
    });

    assert.deepEqual(types(result), ['update-canvas-item']);
    const action = only(result, 'update-canvas-item');
    assert.equal(action.canvasType, 'quiz');
    assert.equal(action.canvasId, null);
    assert.equal(action.moduleItemId, 5015);
    assert.equal(result.adopted[0].canvasType, 'quiz');
  });

  it('adopts nothing for a title two Canvas items share', () => {
    const TWIN = '01-intro/02-welcome.md';
    const result = plan({
      base: { modules: { [FOLDER]: bMod([]) } },
      local: { modules: [lMod(FOLDER, [PATH])] },
      canvas: {
        modules: [cMod([PATH], { extraItems: [cItem(TWIN, { position: 2 })] })],
      },
      policy: { adopt: 'local' },
    });

    assert.deepEqual(result.adopted, []);
    assert.deepEqual(types(result), [
      'create-canvas-item',
      'create-local-item',
      'create-local-item',
    ]);

    assert.equal(result.decisions.length, 1);
    const decision = result.decisions[0];
    assert.equal(decision.kind, 'ambiguous-adoption');
    assert.equal(decision.title, 'welcome');
    assert.equal(decision.canvasType, 'page');
    assert.equal(decision.localCandidates, 1);
    assert.equal(decision.canvasCandidates, 2);
    assert.match(decision.summary, /1 local and 2 Canvas page item\(s\)/);
    assert.match(decision.summary, /"welcome"/);
  });

  it('will not write the Canvas copy over a file holding uncommitted work', () => {
    const result = plan({
      ...both({ localFields: { dirty: true } }),
      policy: { adopt: 'canvas' },
    });

    // Nothing at all: the write is guarded, and the pair is still claimed, so
    // neither side falls through to a create.
    assert.deepEqual(types(result), []);
    assert.equal(result.skipped.length, 1);
    assert.equal(result.skipped[0].reason, 'git-dirty');
    assert.equal(result.skipped[0].action, 'update-local-item');
    assert.match(result.skipped[0].remedy, /Commit or stash the file/);

    assert.equal(result.adopted.length, 1);
    assert.equal(result.adopted[0].applied, false);
  });

  it('keeps a pair the write policy forbids out of the create path too', () => {
    // `status` never adopts, but a pinned run with the losing side's write off
    // does — and a pair dropped from the claimed sets because its write was
    // withheld is the duplication this whole step exists to stop.
    const result = plan({
      ...both(),
      policy: { adopt: 'canvas', write: { canvas: false, local: false } },
    });

    assert.deepEqual(types(result), []);
    assert.deepEqual(
      result.withheld.map((action) => action.type),
      ['update-local-item'],
    );
    assert.equal(result.adopted.length, 1);
    assert.equal(result.adopted[0].applied, false);
  });

  it('leaves a path awaiting a rename answer unadopted', () => {
    // `01-welcome.md` was renamed and edited, and a second Canvas page carries
    // the same title. The author has been asked whether the two are one item;
    // adopting the new path onto that second page would answer the question
    // for them, and bind the file to the wrong object while doing it.
    const RENAMED = '01-intro/01-hello.md';
    const TWIN = '01-intro/02-welcome.md';
    const result = plan({
      base: { modules: { [FOLDER]: bMod([PATH]) } },
      local: {
        modules: [
          lMod(FOLDER, [RENAMED], {
            items: {
              [RENAMED]: { localHash: 'edited', title: titleOf(PATH) },
            },
          }),
        ],
      },
      canvas: {
        modules: [cMod([PATH], { extraItems: [cItem(TWIN, { position: 2 })] })],
      },
      policy: { adopt: 'local' },
    });

    assert.equal(result.pending.renames.length, 1);
    assert.equal(result.pending.renames[0].to, RENAMED);
    assert.deepEqual(result.adopted, []);
    assert.deepEqual(
      types(result),
      ['create-local-item'],
      'the second Canvas page is genuinely new; the renamed file is untouched',
    );
    assert.equal(only(result, 'create-local-item').itemPath, TWIN);
  });

  it('leaves an item the state already links alone', () => {
    // Adoption is for what the state does not know. A course in step must plan
    // nothing under a pinned run either.
    const result = plan({ ...single(), policy: { adopt: 'local' } });

    assert.deepEqual(types(result), []);
    assert.deepEqual(result.adopted, []);
  });

  /** Two items adopted, sitting in the opposite order on the two sides. */
  const crossed = (canvasOrder = [B, A]) => ({
    base: { modules: { [FOLDER]: bMod([]) } },
    local: { modules: [lMod(FOLDER, [A, B])] },
    canvas: { modules: [cMod(canvasOrder)] },
  });

  it('takes the pinned side\u2019s order when nothing recorded one', () => {
    const result = plan({ ...crossed(), policy: { adopt: 'local' } });

    assert.deepEqual(types(result), [
      'update-canvas-item',
      'update-canvas-item',
      'reorder-canvas-module',
    ]);
    // The ids come from the pairs, not from a base row, so the reorder names
    // real Canvas slots on the very run that claimed them.
    assert.deepEqual(only(result, 'reorder-canvas-module').order, [
      { itemPath: A, moduleItemId: 5011, position: 1 },
      { itemPath: B, moduleItemId: 5012, position: 2 },
    ]);

    assert.equal(result.ordering.length, 1);
    assert.equal(result.ordering[0].winner, 'local');
    assert.equal(result.ordering[0].applied, true);
    assert.match(result.ordering[0].reason, /no recorded order to compare/);
    assert.doesNotMatch(
      result.ordering[0].reason,
      /only this side reordered/,
      'nobody reordered anything; saying so would be the same lie one level up',
    );
  });

  it('takes the Canvas order under a Canvas-pinned run', () => {
    const result = plan({ ...crossed(), policy: { adopt: 'canvas' } });

    assert.deepEqual(types(result), [
      'update-local-item',
      'update-local-item',
      'reorder-local-module',
    ]);
    assert.deepEqual(only(result, 'reorder-local-module').order, [
      { itemPath: B, position: 1 },
      { itemPath: A, position: 2 },
    ]);
    assert.equal(result.ordering[0].winner, 'canvas');
    assert.equal(result.ordering[0].applied, true);
  });

  it('reorders nothing when the two sides already agree', () => {
    const result = plan({ ...crossed([A, B]), policy: { adopt: 'local' } });

    assert.deepEqual(types(result), [
      'update-canvas-item',
      'update-canvas-item',
    ]);
    assert.deepEqual(result.ordering, []);
  });

  it('leaves the base an adopting run records saying something true', () => {
    // The run after the one above, with the state it wrote and the Canvas it
    // reordered. Without the reorder, this pass reads Canvas as having moved
    // and renumbers the author's files to match — silently, because a
    // one-sided change never prompts.
    const result = plan({
      base: { modules: { [FOLDER]: bMod([A, B]) } },
      local: { modules: [lMod(FOLDER, [A, B])] },
      canvas: { modules: [cMod([A, B])] },
      policy: { adopt: 'local' },
    });

    assert.deepEqual(types(result), []);
    assert.deepEqual(result.ordering, []);
    assert.deepEqual(result.adopted, []);
  });
});

describe('plan: renames', () => {
  const RENAMED = '01-intro/01-hello.md';

  it('re-keys an exact rename silently and then classifies it as unchanged', () => {
    // The title is pinned to the one the base row holds, which is what a file
    // declaring `title:` in its frontmatter does when it is renamed. Leave it to
    // be derived from the new filename and the rename moves the title too, and
    // the item is then not unchanged at all — that case is its own describe,
    // "a title that moved without the content".
    const result = plan({
      base: { modules: { [FOLDER]: bMod([PATH]) } },
      local: {
        modules: [
          lMod(FOLDER, [RENAMED], {
            items: {
              [RENAMED]: { localHash: `L:${PATH}`, title: titleOf(PATH) },
            },
          }),
        ],
      },
      canvas: { modules: [cMod([PATH])] },
      policy: {},
    });

    assert.deepEqual(types(result), ['rekey-base']);
    assert.deepEqual(only(result, 'rekey-base'), {
      type: 'rekey-base',
      from: PATH,
      to: RENAMED,
      fromFolder: FOLDER,
      toFolder: FOLDER,
      confidence: 'exact',
    });
    assert.deepEqual(result.orphans, { canvas: [], local: [] });
  });

  it('re-keys and then pushes a rename that also changed', () => {
    // Both halves pin the title to the one the base row holds, for the reason
    // the test above gives: a title left to be derived from the new filename
    // moves with the rename, and the item is then not unchanged.
    const result = plan({
      base: { modules: { [FOLDER]: bMod([PATH]) } },
      local: {
        modules: [
          lMod(FOLDER, [RENAMED], {
            items: {
              [RENAMED]: { localHash: `L:${PATH}`, title: titleOf(PATH) },
            },
          }),
        ],
      },
      canvas: { modules: [cMod([PATH], { items: { [PATH]: {} } })] },
      policy: {},
    });

    assert.deepEqual(types(result), ['rekey-base']);

    const edited = plan({
      base: { modules: { [FOLDER]: bMod([PATH]) } },
      local: {
        modules: [
          lMod(FOLDER, [RENAMED], {
            items: {
              [RENAMED]: { localHash: `L:${PATH}`, title: titleOf(PATH) },
            },
          }),
          // A second module so the first has something to be compared against.
        ],
      },
      canvas: { modules: [cMod([PATH], { items: { [PATH]: {} } })] },
      policy: {},
    });
    assert.deepEqual(types(edited), ['rekey-base']);
    assert.equal(result.pending.renames.length, 0);
  });

  it('holds a probable rename, and creates and deletes nothing meanwhile', () => {
    const result = plan({
      base: { modules: { [FOLDER]: bMod([PATH]) } },
      local: {
        modules: [
          lMod(FOLDER, [RENAMED], {
            items: {
              [RENAMED]: { localHash: 'edited', title: titleOf(PATH) },
            },
          }),
        ],
      },
      canvas: { modules: [cMod([PATH])] },
      policy: { pruneCanvas: true },
    });

    assert.deepEqual(
      types(result),
      [],
      'letting both through would delete the Canvas page and create a second ' +
        'copy of the same content beside it',
    );
    assert.deepEqual(result.orphans.canvas, []);
    assert.deepEqual(result.pending.renames, [
      {
        from: PATH,
        to: RENAMED,
        confidence: 'probable',
        fromFolder: FOLDER,
        toFolder: FOLDER,
      },
    ]);
  });

  it('applies a probable rename once the author confirms it', () => {
    const result = plan({
      base: { modules: { [FOLDER]: bMod([PATH]) } },
      local: {
        modules: [
          lMod(FOLDER, [RENAMED], {
            items: {
              [RENAMED]: { localHash: 'edited', title: titleOf(PATH) },
            },
          }),
        ],
      },
      canvas: { modules: [cMod([PATH])] },
      policy: { resolved: { renames: { [PATH]: RENAMED } } },
    });

    assert.deepEqual(types(result), ['rekey-base', 'update-canvas-item']);
    assert.equal(only(result, 'rekey-base').confidence, 'probable');
    assert.deepEqual(result.pending.renames, []);
  });

  it('falls back to a delete and a create once the author rejects it', () => {
    const result = plan({
      base: { modules: { [FOLDER]: bMod([PATH]) } },
      local: {
        modules: [
          lMod(FOLDER, [RENAMED], {
            items: {
              [RENAMED]: { localHash: 'edited', title: titleOf(PATH) },
            },
          }),
        ],
      },
      canvas: { modules: [cMod([PATH])] },
      policy: {
        pruneCanvas: true,
        resolved: { renames: { [PATH]: false } },
      },
    });

    assert.deepEqual(types(result), [
      'create-canvas-item',
      'delete-canvas-item',
    ]);
  });

  it('follows a file dragged into another module', () => {
    const MOVED = '02-basics/01-welcome.md';
    const result = plan({
      base: { modules: { [FOLDER]: bMod([PATH]) } },
      local: {
        modules: [
          lMod(FOLDER, []),
          lMod('02-basics', [MOVED], {
            name: 'Basics',
            position: 2,
            items: { [MOVED]: { localHash: `L:${PATH}` } },
          }),
        ],
      },
      canvas: { modules: [cMod([PATH])] },
      policy: {},
    });

    assert.deepEqual(types(result), [
      'rekey-base',
      'create-canvas-module',
      'move-canvas-item',
    ]);
    const move = only(result, 'move-canvas-item');
    assert.equal(move.fromFolder, FOLDER);
    assert.equal(move.toFolder, '02-basics');
    assert.equal(move.fromCanvasModuleId, 100);
    assert.equal(move.moduleItemId, 5011);
    assert.deepEqual(result.orphans, { canvas: [], local: [] });
  });

  it('leaves an ambiguous pair to the truth table', () => {
    const result = plan({
      base: { modules: { [FOLDER]: bMod([PATH]) } },
      local: {
        modules: [
          lMod(FOLDER, ['01-intro/02-one.md', '01-intro/03-two.md'], {
            items: {
              '01-intro/02-one.md': { localHash: `L:${PATH}` },
              '01-intro/03-two.md': { localHash: `L:${PATH}` },
            },
          }),
        ],
      },
      canvas: { modules: [cMod([PATH])] },
      policy: {},
    });

    assert.deepEqual(types(result), [
      'create-canvas-item',
      'create-canvas-item',
    ]);
    assert.equal(result.orphans.canvas.length, 1);
    assert.deepEqual(result.pending.renames, []);
  });
});

// ---------------------------------------------------------------------------
// A title that moved on its own
// ---------------------------------------------------------------------------

/**
 * An item's title is not in its `local_hash`, and deliberately not: rename
 * detection pairs a vanished path with a new one by that hash, so a hash that
 * moved for a rename alone would turn every re-key into a delete plus a create.
 *
 * The consequence is that a title can move while the content does not, and the
 * three cases where it does are all renames of a file whose title is derived
 * from its filename — a bare binary, a `file` wrapper, and a markdown item
 * carrying no frontmatter `title:`. Nothing else in the truth table notices:
 * every other branch already plans a write that carries the title along, and
 * this one planned nothing at all.
 */
describe('plan: a title that moved without the content', () => {
  const BINARY = '01-intro/03-handout.pdf';
  const BINARY_RENAMED = '01-intro/03-course-handout.pdf';

  /** A bare binary dropped in a module: type `file`, title from the filename. */
  function binaryRow(overrides = {}) {
    return {
      canvas_type: 'file',
      canvas_id: 770,
      page_url: null,
      module_item_id: 5003,
      local_hash: 'L:pdf-bytes',
      canvas_hash: 'C:handout',
      title: 'Handout.Pdf',
      ...overrides,
    };
  }

  function binaryLocal(itemPath, title) {
    return {
      itemPath,
      title,
      canvasType: 'file',
      indent: 0,
      position: 1,
      localHash: 'L:pdf-bytes',
      localMtimeMs: LOCAL_TIME,
      dirty: false,
    };
  }

  function binaryCanvas() {
    return {
      moduleItemId: 5003,
      canvasType: 'file',
      rawType: 'File',
      canvasId: 770,
      pageUrl: null,
      title: 'Handout.Pdf',
      indent: 0,
      position: 1,
      canvasHash: 'C:handout',
      canvasUpdatedAt: CANVAS_TIME,
      suggestedPath: BINARY,
      recognised: true,
    };
  }

  function binaryPlan({ basePath = BINARY, localPath, title, row = {} } = {}) {
    return plan({
      base: {
        modules: {
          [FOLDER]: {
            canvas_module_id: 100,
            name: 'Introduction',
            position: 1,
            item_order: [basePath],
            items: { [basePath]: binaryRow(row) },
          },
        },
      },
      local: {
        modules: [
          {
            folder: FOLDER,
            name: 'Introduction',
            position: 1,
            items: [binaryLocal(localPath, title)],
          },
        ],
      },
      canvas: {
        modules: [
          {
            canvasModuleId: 100,
            name: 'Introduction',
            position: 1,
            suggestedFolder: null,
            items: [binaryCanvas()],
          },
        ],
      },
      policy: {},
    });
  }

  it('pushes the new title of a renamed bare binary', () => {
    // The whole defect in one case: the bytes did not move, so `local_hash` did
    // not move, so nothing was planned — and the Canvas module item kept the
    // name of a file that no longer exists.
    const result = binaryPlan({
      localPath: BINARY_RENAMED,
      title: 'Course Handout.Pdf',
    });

    assert.deepEqual(types(result), ['rekey-base', 'update-canvas-item']);
    const update = only(result, 'update-canvas-item');
    assert.equal(update.itemPath, BINARY_RENAMED);
    assert.equal(update.title, 'Course Handout.Pdf');
    assert.equal(update.canvasType, 'file');
    assert.equal(
      update.canvasId,
      770,
      'the item still points at the Canvas file it always did',
    );
  });

  it('tells the executor the content did not move', () => {
    // The flag is the whole fence. Without it the update goes back through
    // `writeFileContent`, which re-uploads the PDF, may be handed a new file id
    // and then deletes the old Canvas file — all to change a string.
    const renamed = binaryPlan({
      localPath: BINARY_RENAMED,
      title: 'Course Handout.Pdf',
    });
    assert.equal(only(renamed, 'update-canvas-item').contentUnchanged, true);

    // And it is not set when the content really did move, or the binary would
    // never be uploaded again.
    const edited = plan({
      base: { modules: { [FOLDER]: bMod([PATH]) } },
      local: {
        modules: [
          lMod(FOLDER, [PATH], {
            items: { [PATH]: { localHash: 'L:edited' } },
          }),
        ],
      },
      canvas: { modules: [cMod([PATH])] },
      policy: {},
    });
    assert.equal(
      only(edited, 'update-canvas-item').contentUnchanged,
      undefined,
      'an ordinary content update must not claim the content is unchanged',
    );
  });

  it('does the same for a markdown item with no frontmatter title', () => {
    // `writeTitleIfAbsent` only runs on the create handler, so an item this tool
    // adopted rather than created carries no `title:` and takes its name from
    // its filename for as long as the author does not add one by hand.
    const RENAMED = '01-intro/01-hello.md';
    const result = plan({
      base: { modules: { [FOLDER]: bMod([PATH]) } },
      local: {
        modules: [
          lMod(FOLDER, [RENAMED], {
            items: { [RENAMED]: { localHash: `L:${PATH}` } },
          }),
        ],
      },
      canvas: { modules: [cMod([PATH])] },
      policy: {},
    });

    assert.deepEqual(types(result), ['rekey-base', 'update-canvas-item']);
    const update = only(result, 'update-canvas-item');
    assert.equal(
      update.title,
      'hello',
      'the de-prefixed filename is the title',
    );
    assert.equal(update.canvasType, 'page');
    assert.equal(update.contentUnchanged, true);
  });

  it('is silent on the run after the title was recorded', () => {
    // The row is re-keyed and re-recorded by the run above, so the second run
    // compares the local title against the one Canvas now holds and finds
    // nothing. Anything less makes every later sync issue the same PUT.
    const result = binaryPlan({
      basePath: BINARY_RENAMED,
      localPath: BINARY_RENAMED,
      title: 'Course Handout.Pdf',
      row: { title: 'Course Handout.Pdf' },
    });

    assert.deepEqual(types(result), []);
    assert.deepEqual(result.withheld, []);
    assert.deepEqual(result.orphans, { canvas: [], local: [] });
  });

  it('concludes nothing from an item that has no title either', () => {
    // The mirror of the case below, and the one that costs more if it is got
    // wrong: comparing a missing title against a recorded one reads as "it
    // changed", and the update that follows PUTs a null title over the name the
    // Canvas item has. Nothing under `course/` produces one today — a scanned
    // item always falls back to its filename — so this guards the planner's
    // contract rather than a path a course can reach.
    const result = binaryPlan({ localPath: BINARY, title: null });

    assert.deepEqual(types(result), []);
  });

  it('concludes nothing from a row that never recorded a title', () => {
    // A row written before this version stores no title, and reading that
    // silence as "the title changed" would re-push every item in the course on
    // the first run after an upgrade. No baseline, no conclusion — the row
    // gains one the next time anything else about the item is written.
    const result = binaryPlan({
      localPath: BINARY,
      title: 'Something Else Entirely',
      row: { title: undefined },
    });

    assert.deepEqual(types(result), []);
  });
});

// ---------------------------------------------------------------------------
// An indent that moved on its own
// ---------------------------------------------------------------------------

/**
 * The same hole as the title above, one field along, and reachable by an
 * ordinary drag in a file manager: move `01-intro/03-notes.md` into
 * `01-intro/theory/` without renaming it. The bytes did not move, so
 * `local_hash` did not; the basename did not move, so the derived title did
 * not and `hasTitleChanged` does not fire. The re-key lands and the text
 * header is created, and the page keeps indent 0 — sitting beside the header
 * it now belongs under rather than beneath it.
 *
 * An indent is one bit of the item's own path (`scanSubfolderItems` in
 * `lib/convert/course-scanner.js`), so this is the only local change of the
 * three that the author makes without opening a file at all.
 */
describe('plan: an indent that moved without the content', () => {
  const NOTES = '01-intro/03-notes.md';
  const MOVED = '01-intro/theory/03-notes.md';
  const OTHER = '02-basics';

  /**
   * The header for `theory/` already synced on all three sides, so that the
   * only thing under test is the page that was dragged into it. A brand-new
   * subfolder is the case below, and it plans the header's create alongside.
   */
  function headerRow() {
    return {
      canvas_type: 'sub_header',
      canvas_id: null,
      page_url: null,
      module_item_id: 7001,
      local_hash: 'L:header',
      canvas_hash: 'C:header',
      title: 'Theory',
      indent: 0,
    };
  }

  function notesRow(overrides = {}) {
    return {
      canvas_type: 'page',
      canvas_id: 1234,
      page_url: 'notes',
      module_item_id: 5003,
      local_hash: 'L:notes',
      canvas_hash: 'C:notes',
      title: 'Notes',
      indent: 0,
      ...overrides,
    };
  }

  function localNotes(itemPath, indent) {
    return {
      itemPath,
      title: 'Notes',
      canvasType: 'page',
      indent,
      position: 2,
      localHash: 'L:notes',
      localMtimeMs: LOCAL_TIME,
      dirty: false,
    };
  }

  function canvasNotes(indent, overrides = {}) {
    return {
      moduleItemId: 5003,
      canvasType: 'page',
      rawType: 'Page',
      canvasId: 1234,
      pageUrl: 'notes',
      title: 'Notes',
      indent,
      position: 2,
      canvasHash: 'C:notes',
      canvasUpdatedAt: CANVAS_TIME,
      suggestedPath: NOTES,
      recognised: true,
      ...overrides,
    };
  }

  /**
   * One module holding the text header and one page, with where the page sits
   * locally, what indent the base recorded for it, and what Canvas still shows
   * all given separately — every fence here is one of the three disagreeing.
   */
  function dragged({
    basePath = NOTES,
    localPath = MOVED,
    localIndent = 1,
    canvasIndent = 0,
    row = {},
  } = {}) {
    return plan({
      base: {
        modules: {
          [FOLDER]: {
            canvas_module_id: 100,
            name: 'Introduction',
            position: 1,
            item_order: [HEADER, basePath],
            items: { [HEADER]: headerRow(), [basePath]: notesRow(row) },
          },
        },
      },
      local: {
        modules: [
          {
            folder: FOLDER,
            name: 'Introduction',
            position: 1,
            items: [plainHeader().local, localNotes(localPath, localIndent)],
          },
        ],
      },
      canvas: {
        modules: [
          {
            canvasModuleId: 100,
            name: 'Introduction',
            position: 1,
            suggestedFolder: null,
            items: [plainHeader().canvas, canvasNotes(canvasIndent)],
          },
        ],
      },
      policy: {},
    });
  }

  it('pushes the new indent of a page dragged into a subfolder', () => {
    // The whole defect in one case. Before this the plan was the re-key and
    // nothing else, and the page stayed at indent 0 on Canvas for good.
    const result = dragged();

    assert.deepEqual(types(result), ['rekey-base', 'update-canvas-item']);
    const update = only(result, 'update-canvas-item');
    assert.equal(update.itemPath, MOVED);
    assert.equal(update.indent, 1, 'the page now sits under the text header');
    assert.equal(update.title, 'Notes', 'and it was not renamed doing it');
    assert.equal(
      update.canvasId,
      1234,
      'the item still points at the Canvas object it always did',
    );
    assert.equal(
      update.contentUnchanged,
      true,
      'the markdown is what it was, and the executor is told so',
    );
    assert.deepEqual(result.conflicts, []);
  });

  it('pushes it out of the subfolder again', () => {
    // The other direction, which is the same signal read the other way and is
    // not covered by the first: a `>` comparison, or a truthiness test on the
    // local indent, passes the case above and fails this one.
    const result = dragged({
      basePath: MOVED,
      localPath: NOTES,
      localIndent: 0,
      canvasIndent: 1,
      row: { indent: 1 },
    });

    assert.deepEqual(types(result), ['rekey-base', 'update-canvas-item']);
    assert.equal(only(result, 'update-canvas-item').indent, 0);
  });

  it('plans the header alongside when the subfolder is a new one', () => {
    // The case as an author meets it: the subfolder did not exist before, so
    // its text header is created in the same run. The two are separate items
    // and neither stands in for the other — creating the header does nothing
    // whatever to the indent of the page underneath it.
    const result = plan({
      base: {
        modules: {
          [FOLDER]: {
            canvas_module_id: 100,
            name: 'Introduction',
            position: 1,
            item_order: [NOTES],
            items: { [NOTES]: notesRow() },
          },
        },
      },
      local: {
        modules: [
          {
            folder: FOLDER,
            name: 'Introduction',
            position: 1,
            items: [plainHeader().local, localNotes(MOVED, 1)],
          },
        ],
      },
      canvas: {
        modules: [
          {
            canvasModuleId: 100,
            name: 'Introduction',
            position: 1,
            suggestedFolder: null,
            items: [canvasNotes(0)],
          },
        ],
      },
      policy: {},
    });

    assert.deepEqual(types(result).sort(), [
      'create-canvas-item',
      'rekey-base',
      'update-canvas-item',
    ]);
    assert.equal(only(result, 'create-canvas-item').canvasType, 'sub_header');
    assert.equal(only(result, 'update-canvas-item').indent, 1);
  });

  it('is silent on the run after the indent was recorded', () => {
    // The run above re-keys the row and records the indent it pushed, so the
    // next one compares 1 against 1 and finds nothing. Anything less makes
    // every later sync issue the same PUT for ever.
    const result = dragged({
      basePath: MOVED,
      localPath: MOVED,
      localIndent: 1,
      canvasIndent: 1,
      row: { indent: 1 },
    });

    assert.deepEqual(types(result), []);
    assert.deepEqual(result.withheld, []);
    assert.deepEqual(result.orphans, { canvas: [], local: [] });
  });

  it('concludes nothing from a row that never recorded an indent', () => {
    // The guard, and the one that costs most if it is missing: a state file
    // written before this records no indent on any row, and reading that
    // silence as "the indent moved" plans an update for every item in every
    // course on the first run after the upgrade. No baseline, no conclusion —
    // the re-key still lands, because that one is answered by the path.
    assert.deepEqual(types(dragged({ row: { indent: undefined } })), [
      'rekey-base',
    ]);
  });

  it('does not read the base indent off the live Canvas item', () => {
    // The route this rejected, in the shape that shows why. `indent` is in
    // `COMMON_FIELDS`, so `!canvasChanged` looks like proof that
    // `canvasItem.indent` is the indent the last sync left — but a page whose
    // `updated_at` and title still match its row is never re-fetched, and
    // `fingerprintCanvasItem` copies `row.canvas_hash` onto the live item
    // verbatim while reading `indent` off it live (`lib/sync/gather.js`). So
    // here Canvas reads as unchanged *and* disagrees with the row about the
    // indent. The row is the baseline; the drift is Canvas's to be corrected,
    // not evidence that the local side moved.
    const result = dragged({
      basePath: NOTES,
      localPath: NOTES,
      localIndent: 0,
      canvasIndent: 1,
    });

    assert.deepEqual(types(result), []);
  });

  it('leaves a cross-module move to the action that already carries one', () => {
    // A subfolder move that also crossed modules is `move-canvas-item`, which
    // sends the indent itself. Nothing here may duplicate it: with the indent
    // unmoved, the move is the whole plan.
    const result = plan({
      base: {
        modules: {
          [FOLDER]: {
            canvas_module_id: 100,
            name: 'Introduction',
            position: 1,
            item_order: [NOTES],
            items: { [NOTES]: notesRow() },
          },
          [OTHER]: {
            canvas_module_id: 200,
            name: 'Basics',
            position: 2,
            item_order: [],
            items: {},
          },
        },
      },
      local: {
        modules: [
          {
            folder: FOLDER,
            name: 'Introduction',
            position: 1,
            items: [],
          },
          {
            folder: OTHER,
            name: 'Basics',
            position: 2,
            items: [localNotes(`${OTHER}/03-notes.md`, 0)],
          },
        ],
      },
      canvas: {
        modules: [
          {
            canvasModuleId: 100,
            name: 'Introduction',
            position: 1,
            suggestedFolder: null,
            items: [canvasNotes(0)],
          },
          {
            canvasModuleId: 200,
            name: 'Basics',
            position: 2,
            suggestedFolder: null,
            items: [],
          },
        ],
      },
      policy: {},
    });

    assert.deepEqual(types(result), ['rekey-base', 'move-canvas-item']);
    assert.equal(only(result, 'move-canvas-item').indent, 0);
  });
});

// ---------------------------------------------------------------------------
// A binary the body embeds that moved on its own
// ---------------------------------------------------------------------------

/**
 * Redraw `_files/diagram.png` and save. The page around it is byte for byte
 * what it was, so `local_hash` does not move and nothing in the truth table
 * notices — the same hole a renamed title falls through, one level further in.
 * The upload was never the problem: `uploadEmbeddedFiles` compares these two
 * hashes itself, but it runs only inside a push that was planned already, so
 * the new image went up when its page happened to be pushed for some other
 * reason and never on its own.
 *
 * The fences matter as much as the case: a signal read one shade too eagerly
 * re-uploads every image in the course on every run, and one read against a
 * type whose body Canvas never receives plans a push the executor cannot carry
 * out, which leaves the item reporting as changed for ever.
 */
describe('plan: a binary the body embeds that moved on its own', () => {
  const IMAGE = '01-intro/_files/diagram.png';
  const OLD = 'sha-of-the-first-draft';
  const NEW = 'sha-of-the-redrawn-diagram';

  /** What `gatherLocal` hands over: path against current bytes, plus the licence. */
  function tree(hashes, { complete = true } = {}) {
    return { refs: new Map(Object.entries(hashes)), complete };
  }

  /**
   * One unchanged page that embeds one image, with the state's record of that
   * image, what the tree says it hashes to now, and the item's own reference
   * list all given separately — because every fence here is one of them going
   * missing.
   */
  function embedding({
    files = { [IMAGE]: { canvas_file_id: 770, sha256: OLD } },
    embedded = tree({ [IMAGE]: NEW }),
    embeds = [IMAGE],
    canvasType = 'page',
    policy = {},
  } = {}) {
    return plan({
      base: {
        modules: {
          [FOLDER]: bMod([PATH], {
            rows: { [PATH]: { canvas_type: canvasType } },
          }),
        },
        files,
      },
      local: {
        modules: [
          lMod(FOLDER, [PATH], { items: { [PATH]: { canvasType, embeds } } }),
        ],
        // `null` stands for the caller that hands over no `embedded` key at
        // all, which is every `local` built before the reference set existed.
        ...(embedded === null ? {} : { embedded }),
      },
      canvas: {
        modules: [cMod([PATH], { items: { [PATH]: { canvasType } } })],
      },
      policy,
    });
  }

  it('pushes the page whose image was edited in place', () => {
    const result = embedding();

    assert.deepEqual(types(result), ['update-canvas-item']);
    const update = only(result, 'update-canvas-item');
    assert.equal(update.itemPath, PATH);
    assert.equal(update.canvasType, 'page');
    assert.equal(
      update.localHash,
      `L:${PATH}`,
      'the page did not change and the action must not pretend it did',
    );
    assert.equal(
      update.contentUnchanged,
      true,
      'the markdown is what it was, and the executor is told so',
    );
    assert.deepEqual(
      result.conflicts,
      [],
      'only one side edited anything, so there is nothing to choose between',
    );
  });

  it('plans nothing for an image that is the one the state recorded', () => {
    // The fence that keeps this from re-uploading the whole course on every
    // single run. Everything else about the case is identical.
    assert.deepEqual(
      types(embedding({ embedded: tree({ [IMAGE]: OLD }) })),
      [],
    );
  });

  it('plans nothing when the gather could not prove the tree whole', () => {
    // The same licence the orphan sweep answers to, and default-deny in the
    // same way: false, a plain `Set` from a caller written before the hashes,
    // and no `embedded` at all are one answer. A run that cannot say what the
    // course contains does not get to conclude that a binary moved.
    const unusable = {
      'complete: false': tree({ [IMAGE]: NEW }, { complete: false }),
      'no flag at all': { refs: new Map([[IMAGE, NEW]]) },
      'a set of paths, carrying no hashes': {
        refs: new Set([IMAGE]),
        complete: true,
      },
      'no reference set at all': null,
    };
    for (const [label, embedded] of Object.entries(unusable)) {
      assert.deepEqual(
        types(embedding({ embedded })),
        [],
        `planned an update with ${label}`,
      );
    }
  });

  it('concludes nothing about an item whose references are unknown', () => {
    // `embeds: null` is the per-item half of the same silence: the gather could
    // not read that item, so what it points at is nobody's guess.
    assert.deepEqual(types(embedding({ embeds: null })), []);
  });

  it('concludes nothing from a binary or a row it has no hash for', () => {
    // A `![](…)` pointing at a file that is not there hashes to null, and a row
    // with no `sha256` is a baseline that was never written. Neither is evidence
    // that anything moved, and `uploadEmbeddedFiles` skips both too — so a push
    // planned on either would be one the run could not honour.
    assert.deepEqual(
      types(embedding({ embedded: tree({ [IMAGE]: null }) })),
      [],
    );
    assert.deepEqual(
      types(embedding({ files: { [IMAGE]: { canvas_file_id: 770 } } })),
      [],
    );
    assert.deepEqual(types(embedding({ files: {} })), []);
  });

  it('says nothing about a type whose body Canvas never receives', () => {
    // A `file` wrapper is markdown, so the gather collects what its stub
    // embeds — but push sends the binary its `file_ref` names and never the
    // stub. Plan an update here and the executor uploads nothing, the row keeps
    // the old hash, and the item is planned again on every run for ever.
    for (const canvasType of ['file', 'quiz', 'external_url', 'sub_header']) {
      assert.deepEqual(
        types(embedding({ canvasType })),
        [],
        `planned an update for a ${canvasType}`,
      );
    }
  });

  it('pushes an assignment and a discussion on the same evidence', () => {
    for (const canvasType of ['assignment', 'discussion']) {
      assert.deepEqual(
        types(embedding({ canvasType })),
        ['update-canvas-item'],
        `${canvasType} bodies embed images too`,
      );
    }
  });
});

describe('plan: pruning', () => {
  it('deletes nothing by default, on either side', () => {
    const result = plan({
      base: { modules: { [FOLDER]: bMod([A, B]) } },
      local: { modules: [lMod(FOLDER, [A])] },
      canvas: { modules: [cMod([B])] },
      policy: {},
    });

    assert.deepEqual(types(result), []);
    assert.equal(result.orphans.canvas.length, 1);
    assert.equal(result.orphans.canvas[0].itemPath, B);
    assert.equal(result.orphans.local.length, 1);
    assert.equal(result.orphans.local[0].itemPath, A);
  });

  it('prunes only the side it was asked about', () => {
    const course = {
      base: { modules: { [FOLDER]: bMod([A, B]) } },
      local: { modules: [lMod(FOLDER, [A])] },
      canvas: { modules: [cMod([B])] },
    };

    assert.deepEqual(
      types(plan({ ...course, policy: { pruneCanvas: true } })),
      ['delete-canvas-item'],
    );
    assert.deepEqual(types(plan({ ...course, policy: { pruneLocal: true } })), [
      'delete-local-item',
    ]);
  });

  it('reports a module gone from one side as one orphan, not a list of them', () => {
    const result = plan({
      base: { modules: { [FOLDER]: bMod([A, B]) } },
      local: { modules: [] },
      canvas: { modules: [cMod([A, B])] },
      policy: { pruneCanvas: true },
    });

    assert.deepEqual(
      types(result),
      ['delete-canvas-module'],
      'deleting the module takes its items with it',
    );
    const module = result.orphans.canvas.find((o) => o.kind === 'module');
    assert.equal(module.canvasModuleId, 100);
    assert.equal(module.itemCount, 2);
    assert.equal(module.pruned, true);
    for (const item of result.orphans.canvas.filter((o) => o.kind === 'item')) {
      assert.equal(item.coveredByModule, true);
      assert.equal(item.pruned, true);
    }
  });

  it('will not delete a module that still holds Canvas-side changes', () => {
    const result = plan({
      base: { modules: { [FOLDER]: bMod([A, B]) } },
      local: { modules: [] },
      canvas: {
        modules: [cMod([A, B], { items: { [B]: { canvasHash: 'x' } } })],
      },
      policy: { pruneCanvas: true },
    });

    assert.deepEqual(types(result), []);
    assert.equal(result.decisions.length, 1);
    const module = result.orphans.canvas.find((o) => o.kind === 'module');
    assert.equal(module.pruned, false);
    assert.match(module.reason, /need a decision first/);
  });

  it('will not delete a local folder holding uncommitted changes', () => {
    const result = plan({
      base: { modules: { [FOLDER]: bMod([A, B]) } },
      local: {
        modules: [lMod(FOLDER, [A, B], { items: { [B]: { dirty: true } } })],
      },
      canvas: { modules: [] },
      policy: { pruneLocal: true },
    });

    assert.deepEqual(types(result), []);
    const module = result.orphans.local.find((o) => o.kind === 'module');
    assert.equal(module.pruned, false);
    assert.equal(result.skipped[0].reason, 'git-dirty');
    assert.equal(result.skipped[0].action, 'delete-local-module');
  });

  it('deletes a local folder that is clean, so the guard is not a wall', () => {
    // The fence, and the one that matters most: nothing in this file used to
    // assert that this delete ever happens, so a guard that refused every
    // module for ever would have passed the whole suite.
    const result = plan({
      base: { modules: { [FOLDER]: bMod([A, B]) } },
      local: { modules: [lMod(FOLDER, [A, B])] },
      canvas: { modules: [] },
      policy: { pruneLocal: true },
    });

    assert.deepEqual(types(result), ['delete-local-module']);
    assert.deepEqual(result.skipped, []);
    const module = result.orphans.local.find((o) => o.kind === 'module');
    assert.equal(module.pruned, true);
  });

  it('will not delete a folder whose only dirty file the scanner never saw', () => {
    // The defect. `delete-local-module` is a recursive `rmSync`, but the guard
    // could only ask the items `scanCourse` returned — and the scanner skips
    // every `_`-prefixed folder, so an untracked `_files/diagram.png` produces
    // no item and had nothing to speak for it. The folder was pruned with the
    // image inside it and `skipped` was empty.
    //
    // `gatherLocal` now answers for the folder itself, which is what the delete
    // removes. Every item here is clean, exactly as it is on disk.
    const result = plan({
      base: { modules: { [FOLDER]: bMod([A, B]) } },
      local: { modules: [lMod(FOLDER, [A, B], { dirty: true })] },
      canvas: { modules: [] },
      policy: { pruneLocal: true },
    });

    assert.deepEqual(types(result), []);
    const module = result.orphans.local.find((o) => o.kind === 'module');
    assert.equal(module.pruned, false);
    assert.equal(result.skipped.length, 1);
    assert.equal(result.skipped[0].kind, 'module');
    assert.equal(result.skipped[0].reason, 'git-dirty');
    assert.equal(result.skipped[0].action, 'delete-local-module');
    assert.equal(result.skipped[0].moduleFolder, FOLDER);
    assert.match(result.skipped[0].remedy, /Commit or stash/);
  });

  it('withholds that folder too when the policy forbids local writes', () => {
    // The folder flag goes through the same `writeLands` check the item flags
    // do, rather than around it: a skip carries a remedy and fails the run, and
    // one raised over a delete the command was never going to make is a repair
    // notice for nothing.
    const result = plan({
      base: { modules: { [FOLDER]: bMod([A, B]) } },
      local: { modules: [lMod(FOLDER, [A, B], { dirty: true })] },
      canvas: { modules: [] },
      policy: { write: { canvas: true, local: false }, pruneLocal: true },
    });

    assert.deepEqual(types(result), []);
    assert.deepEqual(result.skipped, []);
    assert.equal(result.withheld.length, 1);
    assert.equal(result.withheld[0].type, 'delete-local-module');
  });

  it('still will not, on a run that writes locally and nowhere else', () => {
    // `pull --prune-local` does delete this folder, so the guard is the only
    // thing between it and the uncommitted work inside it. The mirror of the
    // case below, and the half a blanket exemption would quietly break.
    const result = plan({
      base: { modules: { [FOLDER]: bMod([A, B]) } },
      local: {
        modules: [lMod(FOLDER, [A, B], { items: { [B]: { dirty: true } } })],
      },
      canvas: { modules: [] },
      policy: { write: { canvas: false, local: true }, pruneLocal: true },
    });

    assert.deepEqual(types(result), []);
    assert.equal(result.skipped[0].reason, 'git-dirty');
    assert.equal(result.skipped[0].action, 'delete-local-module');
  });

  it('withholds rather than skips the delete a policy already forbids', () => {
    // The module-level twin of the item-level case in `plan: the git guard`,
    // and it went without the check for the same reason `guardDirty` did: a
    // skip carries a remedy and fails the run, over a folder the run was never
    // going to touch. No shipped command reaches this today — `push` is the one
    // that forbids local writes and it never sets `pruneLocal`, so the branch
    // above it returns first — which is exactly why the invariant needs pinning
    // rather than leaving to the flag surface to keep true.
    const result = plan({
      base: { modules: { [FOLDER]: bMod([A, B]) } },
      local: {
        modules: [lMod(FOLDER, [A, B], { items: { [B]: { dirty: true } } })],
      },
      canvas: { modules: [] },
      policy: { write: { canvas: true, local: false }, pruneLocal: true },
    });

    assert.deepEqual(types(result), []);
    assert.deepEqual(result.skipped, []);
    assert.equal(result.withheld.length, 1);
    assert.equal(result.withheld[0].type, 'delete-local-module');
    assert.equal(result.withheld[0].reason, 'write-policy');
  });

  it('drops the base module once both sides are gone', () => {
    const result = plan({
      base: { modules: { [FOLDER]: bMod([]) } },
      local: { modules: [] },
      canvas: { modules: [] },
      policy: {},
    });

    assert.deepEqual(types(result), ['drop-base-module']);
  });
});

describe('plan: an unreadable Canvas module is a wall', () => {
  // What `gatherCanvas` hands over when `listModuleItems` failed for one
  // module: the module's identity, the failure, and no item list at all. An
  // empty list would be a claim about what the module holds, and that claim is
  // exactly what could not be read — the planner must not tell "unreadable"
  // and "everything in it was deleted on Canvas" apart by guessing.
  const FAILURE =
    'Canvas API GET /api/v1/courses/1/modules/100/items failed with status 403: {}';

  function unreadableMod(extra = {}) {
    return {
      canvasModuleId: extra.canvasModuleId ?? 100,
      name: extra.name ?? 'Introduction',
      position: extra.position ?? 1,
      suggestedFolder: extra.suggestedFolder ?? FOLDER,
      unreadable: FAILURE,
    };
  }

  /** The one skipped entry the wall owes the report, and nothing else in it. */
  function assertWalled(result, moduleFolder = FOLDER) {
    assert.equal(result.skipped.length, 1);
    const skip = result.skipped[0];
    assert.equal(skip.kind, 'module');
    assert.equal(skip.reason, 'canvas-unreadable');
    assert.equal(skip.moduleFolder, moduleFolder);
    assert.equal(skip.action, null);
    assert.match(skip.remedy, /403/);
    assert.match(skip.remedy, /Run again/);
    return skip;
  }

  it('derives nothing from the module, and exactly one skip says why', () => {
    // Local and base agree; only the Canvas side is missing. Before the wall,
    // the missing side read as "every item deleted on Canvas": two local
    // orphans, ready to become prune candidates.
    const result = plan({
      base: { modules: { [FOLDER]: bMod([A, B]) } },
      local: { modules: [lMod(FOLDER, [A, B])] },
      canvas: { modules: [unreadableMod()] },
      policy: {},
    });

    assert.deepEqual(types(result), []);
    assert.deepEqual(result.orphans.canvas, []);
    assert.deepEqual(result.orphans.local, []);
    assert.deepEqual(result.decisions, []);
    assertWalled(result);
  });

  it('offers no prune-local candidate for items it cannot see the far side of', () => {
    // The defect that motivated the wall: with the module dropped from the
    // gather, `sync --prune-local` offered to recursively delete the local
    // folder of a module that still exists on Canvas.
    const result = plan({
      base: { modules: { [FOLDER]: bMod([A, B]) } },
      local: { modules: [lMod(FOLDER, [A, B])] },
      canvas: { modules: [unreadableMod()] },
      policy: { pruneLocal: true },
    });

    assert.deepEqual(types(result), []);
    assert.deepEqual(result.orphans.local, []);
    assertWalled(result);
  });

  it('offers no prune-canvas candidate when the local folder is gone', () => {
    // The folder was deleted here, and the Canvas side could not be listed.
    // Deleting the Canvas module would act on the very contents this run
    // could not read.
    const result = plan({
      base: { modules: { [FOLDER]: bMod([A, B]) } },
      local: { modules: [] },
      canvas: { modules: [unreadableMod()] },
      policy: { pruneCanvas: true },
    });

    assert.deepEqual(types(result), []);
    assert.deepEqual(result.orphans.canvas, []);
    assertWalled(result);
  });

  it('creates nothing on Canvas for its items under a push-shaped policy', () => {
    // B is new locally. Its Canvas twin may well exist — the items were not
    // listed, not absent — so pushing it would create a duplicate beside an
    // object this run simply could not see.
    const result = plan({
      base: { modules: { [FOLDER]: bMod([A]) } },
      local: { modules: [lMod(FOLDER, [A, B])] },
      canvas: { modules: [unreadableMod()] },
      policy: {
        write: { canvas: true, local: false },
        conflict: 'local',
        adopt: 'local',
      },
    });

    assert.deepEqual(types(result), []);
    assert.deepEqual(result.withheld, []);
    assertWalled(result);
  });

  it('parks a local edit inside the folder rather than pushing blind', () => {
    const result = plan({
      base: { modules: { [FOLDER]: bMod([A]) } },
      local: {
        modules: [
          lMod(FOLDER, [A], { items: { [A]: { localHash: `edited:${A}` } } }),
        ],
      },
      canvas: { modules: [unreadableMod()] },
      policy: {},
    });

    assert.deepEqual(types(result), []);
    assertWalled(result);
  });

  it('walls a module the state has never seen: no local folder, no adoption', () => {
    // Canvas-only and unknown to us, under a pull-shaped policy that would
    // otherwise create the folder and adopt its way through the contents.
    const result = plan({
      base: { modules: {} },
      local: { modules: [] },
      canvas: {
        modules: [
          unreadableMod({
            canvasModuleId: 300,
            name: 'Extra',
            position: 3,
            suggestedFolder: '03-extra',
          }),
        ],
      },
      policy: {
        write: { canvas: false, local: true },
        conflict: 'canvas',
        adopt: 'canvas',
      },
    });

    assert.deepEqual(types(result), []);
    assert.deepEqual(result.withheld, []);
    assertWalled(result, '03-extra');
  });

  it('leaves every readable module to proceed exactly as before', () => {
    const X = '02-basics/01-x.md';
    const result = plan({
      base: {
        modules: {
          [FOLDER]: bMod([A]),
          '02-basics': bMod([X], {
            canvasModuleId: 200,
            name: 'Basics',
            position: 2,
          }),
        },
      },
      local: {
        modules: [
          lMod(FOLDER, [A], { items: { [A]: { localHash: `edited:${A}` } } }),
          lMod('02-basics', [X], {
            name: 'Basics',
            position: 2,
            items: { [X]: { localHash: `edited:${X}` } },
          }),
        ],
      },
      canvas: {
        modules: [
          unreadableMod(),
          cMod([X], { canvasModuleId: 200, name: 'Basics', position: 2 }),
        ],
      },
      policy: {},
    });

    // The readable module's edit is pushed as it always was; the walled one
    // contributes its skip and nothing else.
    assert.deepEqual(types(result), ['update-canvas-item']);
    assert.equal(only(result, 'update-canvas-item').itemPath, X);
    assertWalled(result);
  });

  it('parks a rename out of the folder instead of duplicating or deleting', () => {
    // A's file was moved by hand into the readable module. Re-keying the row
    // would strand it in a context whose Canvas match is missing — the walled
    // module's items were never listed — where it reads as deleted on Canvas;
    // refusing the pair outright would create the moved file as a second
    // Canvas copy. Both ends are parked instead, and the module's own skip is
    // the account.
    const MOVED = '02-basics/05-moved.md';
    const result = plan({
      base: {
        modules: {
          [FOLDER]: bMod([A]),
          '02-basics': bMod([], {
            canvasModuleId: 200,
            name: 'Basics',
            position: 2,
          }),
        },
      },
      local: {
        modules: [
          lMod(FOLDER, []),
          lMod('02-basics', [MOVED], {
            name: 'Basics',
            position: 2,
            items: { [MOVED]: { localHash: `L:${A}` } },
          }),
        ],
      },
      canvas: {
        modules: [
          unreadableMod(),
          cMod([], { canvasModuleId: 200, name: 'Basics', position: 2 }),
        ],
      },
      policy: { pruneLocal: true },
    });

    assert.deepEqual(types(result), []);
    assert.deepEqual(result.pending.renames, [], 'parked, not asked about');
    assert.deepEqual(result.orphans.local, []);
    assert.deepEqual(result.orphans.canvas, []);
    assertWalled(result);
  });

  it('keeps the embedded-file sweep off rows keyed under the fenced folder', () => {
    // The local folder is gone and the Canvas side unlisted, so "nothing
    // embeds this any more" cannot be concluded for its binaries: the
    // unlisted pages may be exactly what embeds them. A row in a readable
    // module is swept as normal, so the fence is a fence and not a wall
    // around the whole sweep.
    const result = plan({
      base: {
        modules: { [FOLDER]: bMod([]) },
        files: {
          '01-intro/_files/logo.png': { canvas_file_id: 900, sha256: 'aa' },
          '02-basics/_files/old.png': { canvas_file_id: 901, sha256: 'bb' },
        },
      },
      local: { modules: [], embedded: { refs: new Set(), complete: true } },
      canvas: { modules: [unreadableMod()] },
      policy: { pruneCanvas: true },
    });

    assert.deepEqual(types(result), ['delete-canvas-file']);
    assert.equal(only(result, 'delete-canvas-file').canvasFileId, 901);
    const files = result.orphans.canvas.filter((o) => o.kind === 'file');
    assert.equal(files.length, 1);
    assert.equal(files[0].canvasFileId, 901);
    assertWalled(result);
  });

  it('lets the flag win even when an item list is handed in beside it', () => {
    // `gatherCanvas` never produces both, but the planner is a pure function
    // over caller-built data, and this is the shape where items behind the
    // flag would leak past the wall: X's base row is keyed in the *readable*
    // module, and its Canvas item is handed in inside the flagged one. The
    // course-wide matching runs before any context exists to be walled, so
    // without the forcing in `normaliseCanvas` the row matches that item and
    // a `move-canvas-item` is emitted to drag it back — a decision built
    // entirely on data the flag says was never read. With the forcing, the
    // row matches nothing: X is listed as a local orphan (the residual every
    // id-unmatched row gets, prune-gated as always) and no action touches it.
    const X = '02-basics/01-x.md';
    const result = plan({
      base: {
        modules: {
          '02-basics': bMod([X], {
            canvasModuleId: 200,
            name: 'Basics',
            position: 2,
          }),
        },
      },
      local: {
        modules: [lMod('02-basics', [X], { name: 'Basics', position: 2 })],
      },
      canvas: {
        modules: [
          { ...cMod([X], { suggestedFolder: FOLDER }), unreadable: FAILURE },
          cMod([], { canvasModuleId: 200, name: 'Basics', position: 2 }),
        ],
      },
      policy: {},
    });

    assert.deepEqual(types(result), []);
    assert.equal(result.orphans.local.length, 1);
    assert.equal(result.orphans.local[0].itemPath, X);
    assertWalled(result);
  });
});

describe('plan: the action list is in execution order', () => {
  it('puts creates before the reorder that names them', () => {
    const D = '01-intro/04-d.md';
    const result = plan({
      base: { modules: { [FOLDER]: bMod([A, B, C]) } },
      local: { modules: [lMod(FOLDER, [A, C, B, D])] },
      canvas: { modules: [cMod([A, B, C])] },
      policy: {},
    });

    assert.deepEqual(types(result), [
      'create-canvas-item',
      'reorder-canvas-module',
    ]);
  });

  it('puts deletes after everything else', () => {
    const result = plan({
      base: { modules: { [FOLDER]: bMod([A, B]) } },
      local: { modules: [lMod(FOLDER, [A, C])] },
      canvas: { modules: [cMod([A, B])] },
      policy: { pruneCanvas: true },
    });

    assert.deepEqual(types(result), [
      'create-canvas-item',
      'delete-canvas-item',
    ]);
  });

  it('puts a module create before the items inside it', () => {
    const result = plan({
      base: { modules: {} },
      local: { modules: [lMod('09-new', ['09-new/01-a.md'], { name: 'New' })] },
      canvas: { modules: [] },
      policy: {},
    });

    assert.deepEqual(types(result), [
      'create-canvas-module',
      'create-canvas-item',
    ]);
  });

  it('never emits an action type the rank table does not know', () => {
    const result = plan({
      ...ordered({ local: [B, A, C], canvas: [A, B, C] }),
      policy: {},
    });

    for (const action of result.actions) {
      assert.ok(
        Object.hasOwn(ACTION_RANK, action.type),
        `${action.type} has no rank`,
      );
    }
  });
});

describe('plan: modules', () => {
  it('pushes a local rename of the module name', () => {
    const result = plan({
      base: { modules: { [FOLDER]: bMod([PATH]) } },
      local: { modules: [lMod(FOLDER, [PATH], { name: 'Getting started' })] },
      canvas: { modules: [cMod([PATH])] },
      policy: {},
    });

    assert.deepEqual(types(result), ['update-canvas-module']);
    assert.equal(only(result, 'update-canvas-module').name, 'Getting started');
  });

  it('writes a Canvas rename into the local label, never the folder', () => {
    const result = plan({
      base: { modules: { [FOLDER]: bMod([PATH]) } },
      local: { modules: [lMod(FOLDER, [PATH])] },
      canvas: { modules: [cMod([PATH], { name: 'Kick-off' })] },
      policy: {},
    });

    assert.deepEqual(types(result), ['update-local-module']);
    const action = only(result, 'update-local-module');
    assert.equal(action.folder, FOLDER, 'the folder is the key, so it stays');
    assert.equal(action.name, 'Kick-off');
  });

  it('resolves a rename on both sides through the conflict policy', () => {
    const course = {
      base: { modules: { [FOLDER]: bMod([PATH]) } },
      local: { modules: [lMod(FOLDER, [PATH], { name: 'Getting started' })] },
      canvas: { modules: [cMod([PATH], { name: 'Kick-off' })] },
    };

    const canvasWins = plan({ ...course, policy: { conflict: 'canvas' } });
    assert.deepEqual(types(canvasWins), ['update-local-module']);
    assert.equal(canvasWins.conflicts[0].kind, 'module');
    assert.equal(canvasWins.conflicts[0].winner, 'canvas');

    const asked = plan({ ...course, policy: { conflict: 'ask' } });
    assert.deepEqual(types(asked), []);
    assert.equal(asked.pending.conflicts[0].kind, 'module');
  });

  it('says why newest cannot time a rename, rather than blaming Canvas', () => {
    // Local wins, as it always did. What it may not say is that Canvas "gave no
    // usable timestamp": a module name is timestamped on neither side, so there
    // was none to give, and the item wording sends the author looking for a
    // Canvas fault that is not there.
    const result = plan({
      base: { modules: { [FOLDER]: bMod([PATH]) } },
      local: { modules: [lMod(FOLDER, [PATH], { name: 'Getting started' })] },
      canvas: { modules: [cMod([PATH], { name: 'Kick-off' })] },
      policy: { conflict: 'newest' },
    });

    assert.deepEqual(types(result), ['update-canvas-module']);
    assert.equal(result.conflicts[0].kind, 'module');
    assert.equal(result.conflicts[0].winner, 'local');
    assert.equal(
      result.conflicts[0].reason,
      'newest: a module name carries no timestamp on either side, so neither ' +
        'can prove it is newer',
    );
  });

  it('ignores a Canvas position, which counts in another space entirely', () => {
    // Folders numbered 10, 20, 30 are positions 10, 20 and 30 locally and
    // 1, 2 and 3 on Canvas. Comparing them would report a change every run.
    const result = plan({
      base: { modules: { [FOLDER]: bMod([PATH], { position: 10 }) } },
      local: { modules: [lMod(FOLDER, [PATH], { position: 10 })] },
      canvas: { modules: [cMod([PATH], { position: 1 })] },
      policy: {},
    });

    assert.deepEqual(types(result), []);
  });

  it('carries the local slot on the write, not the state’s and not Canvas’s', () => {
    // `_category_.json` holds the Docusaurus sidebar position, and locally that
    // is the folder's numeric prefix — what `scanCourse` reads back out of it
    // and what `renameModule` writes into it. The executor used to take it from
    // the state row instead, and a row with no `position` sent the module to
    // the top of the sidebar on `?? 0`.
    const result = plan({
      base: { modules: { [FOLDER]: bMod([PATH]) } },
      local: { modules: [lMod(FOLDER, [PATH])] },
      canvas: { modules: [cMod([PATH], { name: 'Kick-off', position: 7 })] },
      policy: {},
    });

    assert.equal(only(result, 'update-local-module').position, 1);
  });

  it('refuses the rename when _category_.json holds uncommitted work', () => {
    const result = plan({
      base: { modules: { [FOLDER]: bMod([PATH]) } },
      local: { modules: [lMod(FOLDER, [PATH], { categoryDirty: true })] },
      canvas: { modules: [cMod([PATH], { name: 'Kick-off' })] },
      policy: {},
    });

    assert.deepEqual(types(result), [], 'the label is the file’s own content');
    assert.deepEqual(
      result.skipped.map((skip) => [
        skip.kind,
        skip.reason,
        skip.moduleFolder,
        skip.action,
      ]),
      [['module', 'git-dirty', FOLDER, 'update-local-module']],
    );
    assert.match(result.skipped[0].remedy, /_category_\.json/);
    assert.match(result.skipped[0].remedy, /Commit or stash/);
  });

  it('still relabels a module whose dirt is anywhere else in it', () => {
    // The fence. `gitDirtyPaths` adds every ancestor of a dirty path, so the
    // folder flag is true for one uncommitted lesson anywhere underneath; a
    // guard reading that would wall off every metadata update for a module the
    // author is working in, and every test above would still pass.
    const result = plan({
      base: { modules: { [FOLDER]: bMod([PATH]) } },
      local: {
        modules: [
          lMod(FOLDER, [PATH], {
            dirty: true,
            items: { [PATH]: { dirty: true } },
          }),
        ],
      },
      canvas: { modules: [cMod([PATH], { name: 'Kick-off' })] },
      policy: {},
    });

    assert.deepEqual(types(result), ['update-local-module']);
    assert.deepEqual(result.skipped, []);
  });

  it('does not settle the conflict it refused to write', () => {
    // Worse than the silent overwrite: the entry used to say Canvas won and
    // that the losing version is in git, when the losing version was the
    // uncommitted file the write had just destroyed.
    const result = plan({
      base: { modules: { [FOLDER]: bMod([PATH]) } },
      local: {
        modules: [
          lMod(FOLDER, [PATH], {
            name: 'Getting started',
            categoryDirty: true,
          }),
        ],
      },
      canvas: { modules: [cMod([PATH], { name: 'Kick-off' })] },
      policy: { conflict: 'canvas' },
    });

    assert.deepEqual(types(result), []);
    assert.equal(result.conflicts[0].winner, 'canvas');
    assert.equal(result.conflicts[0].applied, false);
    assert.equal(result.skipped[0].reason, 'git-dirty');
    assert.equal(
      result.conflicts[0].refusal,
      'git-dirty',
      'the module-level guard has to be named on its conflict too, or the ' +
        'report sends the author back to `sync` over an uncommitted file',
    );
  });

  it('withholds rather than skips on a run that never writes locally', () => {
    // `writeLands`: under `push` the action is suppressed by policy anyway, so
    // a skip would tell the author to repair a write the command was never
    // going to make — and fail the run over it.
    const result = plan({
      base: { modules: { [FOLDER]: bMod([PATH]) } },
      local: { modules: [lMod(FOLDER, [PATH], { categoryDirty: true })] },
      canvas: { modules: [cMod([PATH], { name: 'Kick-off' })] },
      policy: { write: { local: false, canvas: true } },
    });

    assert.deepEqual(result.skipped, []);
    assert.deepEqual(
      result.withheld.map((entry) => entry.type),
      ['update-local-module'],
    );
  });

  // -------------------------------------------------------------------------
  // Two Canvas modules that want the same folder
  // -------------------------------------------------------------------------

  const LATER = '01-intro/02-later.md';

  /** Two unclaimed Canvas modules deriving the one folder name. */
  function twoWantingOneFolder() {
    return {
      base: { modules: {} },
      local: { modules: [] },
      canvas: {
        modules: [
          cMod([PATH], {
            canvasModuleId: 100,
            suggestedFolder: FOLDER,
          }),
          cMod([LATER], {
            canvasModuleId: 200,
            name: 'Introduction',
            suggestedFolder: FOLDER,
          }),
        ],
      },
    };
  }

  it('refuses the Canvas module whose folder name is already taken', () => {
    // A module's folder is its name and its position, so two Canvas modules
    // agreeing on both derive the same one, and only the first can have it.
    // The second reached `buildModuleContexts` as a context with `folder:
    // null`, and everything downstream planned against that null.
    const result = plan({ ...twoWantingOneFolder(), policy: {} });

    assert.deepEqual(types(result), [
      'create-local-module',
      'create-local-item',
    ]);
    assert.deepEqual(
      result.actions.filter((action) => action.folder === null),
      [],
      'nothing may be planned for a module with no folder to plan it in',
    );
    assert.deepEqual(
      result.skipped.map((skip) => [
        skip.kind,
        skip.reason,
        skip.moduleFolder,
        skip.action,
      ]),
      [['module', 'folder-taken', FOLDER, 'create-local-module']],
    );
    assert.match(result.skipped[0].remedy, /already has that folder/);
    assert.match(result.skipped[0].remedy, /Rename or renumber one of them/);
  });

  it('does not lose the second module’s page into the first one’s folder', () => {
    // The half that made this more than a bad message. `create-local-module`
    // threw on its null folder and was caught per action, but the
    // `create-local-item` ranked behind it carried the item's *real*
    // `suggestedPath` — so the run went on to write that page into the folder
    // the other module had claimed, and recorded its row there.
    const result = plan({ ...twoWantingOneFolder(), policy: {} });

    assert.deepEqual(
      result.actions
        .filter((action) => action.type === 'create-local-item')
        .map((action) => action.itemPath),
      [PATH],
      `${LATER} belongs to no folder this run can write`,
    );
  });

  it('says nothing about it under push, which was never going to pull it', () => {
    // `writeLands`: push writes nothing locally, so nothing can throw and
    // nothing can land in the wrong place. A skip here would fail the run over
    // a Canvas-side name clash the command was never going to act on.
    //
    // What push withholds is the *other* module's create — the one that did
    // get the folder. Nothing at all is recorded for the refused module, which
    // is a real change from before the refusal existed: its create and its
    // item used to be withheld, `folder: null` and all.
    const result = plan({
      ...twoWantingOneFolder(),
      policy: { write: { canvas: true, local: false } },
    });

    assert.deepEqual(result.skipped, []);
    assert.deepEqual(types(result), []);
    assert.deepEqual(
      result.withheld.map((entry) => [entry.type, entry.canvasModuleId]),
      [
        ['create-local-module', 100],
        ['create-local-item', 100],
      ],
      'push may only withhold work for the module that has a folder',
    );
  });

  it('reports it under status, which exists to say what sync would do', () => {
    // The one refusal here that is not about a write. Two Canvas modules
    // deriving one folder name is a fact about the course: `sync` refuses it
    // and exits 1, `sync --dry-run` over the same course exits 1, and a
    // `status` that stayed silent would preview a run it does not resemble.
    // `status` has nowhere else to put it either — with both write flags off,
    // everything it can say is in the report.
    const result = plan({
      ...twoWantingOneFolder(),
      policy: { write: { canvas: false, local: false } },
    });

    assert.deepEqual(types(result), [], 'status still plans no write');
    assert.deepEqual(
      result.skipped.map((skip) => [
        skip.kind,
        skip.reason,
        skip.moduleFolder,
        skip.canvasModuleId,
      ]),
      [['module', 'folder-taken', FOLDER, 200]],
    );
    assert.match(result.skipped[0].remedy, /Rename or renumber one of them/);
  });
});

describe('plan: -m confines the whole run', () => {
  const course = {
    base: {
      modules: {
        [FOLDER]: bMod([PATH]),
        '02-basics': bMod(['02-basics/01-loops.md'], {
          canvasModuleId: 200,
          name: 'Basics',
          position: 2,
        }),
      },
    },
    local: {
      modules: [
        lMod(FOLDER, [PATH], { items: { [PATH]: { localHash: 'edited' } } }),
        lMod('02-basics', [], { name: 'Basics', position: 2 }),
      ],
    },
    canvas: {
      modules: [
        cMod([PATH]),
        cMod(['02-basics/01-loops.md'], {
          canvasModuleId: 200,
          name: 'Basics',
          position: 2,
        }),
      ],
    },
  };

  it('plans both modules when nothing is named', () => {
    const result = plan({ ...course, policy: {} });

    assert.deepEqual(types(result), ['update-canvas-item']);
    assert.equal(result.orphans.canvas.length, 1);
  });

  it('plans only the module named, report sections included', () => {
    const result = plan({ ...course, policy: { modules: [FOLDER] } });

    assert.deepEqual(types(result), ['update-canvas-item']);
    assert.deepEqual(
      result.orphans.canvas,
      [],
      'the other module is out of scope, orphans and all',
    );
  });

  it('plans only the other one when that is what was named', () => {
    const result = plan({ ...course, policy: { modules: ['02-basics'] } });

    assert.deepEqual(types(result), []);
    assert.equal(result.orphans.canvas.length, 1);
    assert.equal(result.orphans.canvas[0].moduleFolder, '02-basics');
  });

  it('leaves a Canvas-only module out, having no folder to match on', () => {
    const result = plan({
      base: { modules: {} },
      local: { modules: [lMod(FOLDER, [PATH])] },
      canvas: {
        modules: [
          cMod(['09-extra/01-x.md'], { canvasModuleId: 900, name: 'Extra' }),
        ],
      },
      policy: { modules: [FOLDER] },
    });

    assert.deepEqual(types(result), [
      'create-canvas-module',
      'create-canvas-item',
    ]);
  });
});

describe('plan: a whole course at once', () => {
  it('reconciles a realistic mix in one pass', () => {
    const INTRO_A = '01-intro/01-a.md';
    const INTRO_B = '01-intro/02-b.md';
    const INTRO_C = '01-intro/03-c.md';
    const BASICS_A = '02-basics/01-loops.md';
    const BASICS_B = '02-basics/02-arrays.md';
    const GONE = '03-old/01-legacy.md';
    const NEW = '04-new/01-first.md';

    const result = plan({
      base: {
        modules: {
          '01-intro': bMod([INTRO_A, INTRO_B, INTRO_C]),
          '02-basics': bMod([BASICS_A, BASICS_B], {
            canvasModuleId: 200,
            name: 'Basics',
            position: 2,
          }),
          '03-old': bMod([GONE], {
            canvasModuleId: 300,
            name: 'Old',
            position: 3,
          }),
        },
      },
      local: {
        modules: [
          // A edited here, B edited on both sides, C reordered to the front.
          lMod('01-intro', [INTRO_C, INTRO_A, INTRO_B], {
            items: {
              [INTRO_A]: { localHash: 'edited' },
              [INTRO_B]: { localHash: 'edited' },
            },
          }),
          // One item deleted locally, one untouched.
          lMod('02-basics', [BASICS_A], { name: 'Basics', position: 2 }),
          // A module whose Canvas side is gone.
          lMod('03-old', [GONE], { name: 'Old', position: 3 }),
          // A module that is new here.
          lMod('04-new', [NEW], { name: 'New', position: 4 }),
        ],
      },
      canvas: {
        modules: [
          cMod([INTRO_A, INTRO_B, INTRO_C], {
            items: {
              [INTRO_B]: { canvasHash: 'edited' },
              [INTRO_C]: { canvasHash: 'edited' },
            },
          }),
          cMod([BASICS_A, BASICS_B], {
            canvasModuleId: 200,
            name: 'Basics',
            position: 2,
          }),
          // The module the state calls 03-old is gone from Canvas entirely.
        ],
      },
      policy: { conflict: 'local', order: 'ask' },
    });

    assert.deepEqual(types(result), [
      'create-canvas-module',
      'create-canvas-item',
      'update-canvas-item',
      'update-canvas-item',
      'update-local-item',
      'reorder-canvas-module',
    ]);

    // A: local only. B: both, and the policy pinned local. C: Canvas only.
    assert.deepEqual(
      result.actions
        .filter((a) => a.type.endsWith('-item') && a.itemPath)
        .map((a) => [a.type, a.itemPath]),
      [
        ['create-canvas-item', NEW],
        ['update-canvas-item', INTRO_A],
        ['update-canvas-item', INTRO_B],
        ['update-local-item', INTRO_C],
      ],
    );
    assert.equal(result.conflicts.length, 1);
    assert.equal(result.conflicts[0].itemPath, INTRO_B);
    assert.equal(result.conflicts[0].winner, 'local');

    // 02-basics lost an item locally; 03-old lost its whole module on Canvas.
    assert.deepEqual(
      result.orphans.canvas.map((o) => o.itemPath ?? o.moduleFolder),
      [BASICS_B],
    );
    assert.deepEqual(
      result.orphans.local.map((o) => o.itemPath ?? o.moduleFolder),
      [GONE, '03-old'],
    );
    assert.equal(
      result.actions.filter((a) => a.type.startsWith('delete')).length,
      0,
      'and not one delete, because neither prune flag was given',
    );

    // Only 01-intro reordered, and only on one side, so it is settled silently.
    assert.equal(result.ordering.length, 1);
    assert.equal(result.ordering[0].folder, '01-intro');
    assert.equal(result.ordering[0].winner, 'local');
    assert.deepEqual(result.pending.order, []);

    assert.equal(result.collision, null);
    assert.deepEqual(result.decisions, []);
    assert.deepEqual(result.skipped, []);
    assert.deepEqual(result.unrecognised, []);
    assert.deepEqual(result.withheld, []);
  });

  it('copes with being handed nothing at all', () => {
    const empty = {
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

    assert.deepEqual(plan(), empty);
    assert.deepEqual(plan({}), empty);
  });
});

describe('plan: reference types', () => {
  const QUIZ = '01-intro/05-quiz.md';

  it('matches a quiz on its module item id, not a content id', () => {
    const result = plan({
      base: {
        modules: {
          [FOLDER]: bMod([QUIZ], {
            rows: {
              [QUIZ]: {
                canvas_type: 'quiz',
                canvas_id: null,
                page_url: null,
              },
            },
          }),
        },
      },
      local: {
        modules: [
          lMod(FOLDER, [QUIZ], {
            items: { [QUIZ]: { canvasType: 'quiz' } },
          }),
        ],
      },
      canvas: {
        modules: [
          cMod([QUIZ], {
            items: {
              [QUIZ]: {
                canvasType: 'quiz',
                rawType: 'Quiz',
                canvasId: null,
                pageUrl: null,
              },
            },
          }),
        ],
      },
      policy: {},
    });

    assert.deepEqual(types(result), []);
    assert.deepEqual(result.orphans, { canvas: [], local: [] });
  });

  it('refuses to push a local file whose type no longer matches Canvas', () => {
    const result = plan({
      ...single({
        localFields: { localHash: 'edited', canvasType: 'assignment' },
      }),
      policy: {},
    });

    assert.deepEqual(types(result), []);
    assert.equal(result.skipped[0].reason, 'type-changed');
    assert.match(
      result.skipped[0].remedy,
      /page on Canvas but its frontmatter/,
    );
  });

  it('still refuses it under push, where that write is a real one', () => {
    // The half that has to survive: push is the command the refusal is for, and
    // a fix that stopped recording the skip everywhere would take it out of the
    // one place it belongs.
    const result = plan({
      ...single({
        localFields: { localHash: 'edited', canvasType: 'assignment' },
      }),
      policy: { write: { canvas: true, local: false }, adopt: 'local' },
    });

    assert.deepEqual(types(result), []);
    assert.equal(result.skipped[0].reason, 'type-changed');
    assert.equal(result.skipped[0].action, 'update-canvas-item');
  });

  it('withholds rather than refuses it under pull', () => {
    // Pull writes to no Canvas object, so this update was never going to
    // happen. A skip would tell the author to repair a write pull does not
    // make, with a remedy about deleting and re-adding the item, and it would
    // fail the run. The same rule `guardDirty` follows for the other direction.
    const result = plan({
      ...single({
        localFields: { localHash: 'edited', canvasType: 'assignment' },
      }),
      policy: { write: { canvas: false, local: true }, conflict: 'canvas' },
    });

    assert.deepEqual(types(result), []);
    assert.deepEqual(result.skipped, []);
    assert.equal(result.withheld.length, 1);
    assert.equal(result.withheld[0].type, 'update-canvas-item');
    assert.equal(result.withheld[0].reason, 'write-policy');
  });
});

// ---------------------------------------------------------------------------
// Embedded binaries nothing points at any more
// ---------------------------------------------------------------------------

/**
 * The sweep over `state.files`, and the two fences that keep it from running on
 * a partial view of the course.
 *
 * A row under `state.files` records the Canvas file behind one embedded binary,
 * keyed by the path a markdown item points at. Rename the binary and fix the
 * `![](…)` and the run uploads the bytes again under the new path: Canvas keeps
 * two copies and the state keeps a row for a path that no longer exists.
 *
 * Deciding a row is dead means proving that **no markdown item anywhere in
 * `course/`** names it, so the tests that matter here are the ones where the
 * proof is missing. Both of them are worth more than the happy path: get either
 * wrong and the tool deletes live images out of a live course.
 */
describe('plan: embedded binaries nothing points at any more', () => {
  const LOGO = '01-intro/_files/logo.png';
  const BRAND = '01-intro/_files/brand.png';

  /** A course of one unchanged page, plus whatever the state and the tree say. */
  function withFiles(files, embedded) {
    return {
      ...single(),
      base: { modules: { [FOLDER]: bMod([PATH]) }, files },
      local: { modules: [lMod(FOLDER, [PATH])], embedded },
    };
  }

  /** What `gatherLocal` hands over: the whole tree's references, and proof of it. */
  function seen(...refs) {
    return { refs: new Set(refs), complete: true };
  }

  function row(id) {
    return {
      canvas_file_id: id,
      canvas_url: `/files/${id}/preview`,
      sha256: 'x',
    };
  }

  it('reports a row nothing embeds any more, and deletes nothing for it', () => {
    const result = plan({
      ...withFiles({ [LOGO]: row(500), [BRAND]: row(501) }, seen(BRAND)),
      policy: {},
    });

    assert.deepEqual(types(result), [], 'a plain sync deletes nothing');
    assert.equal(result.orphans.canvas.length, 1);
    const orphan = result.orphans.canvas[0];
    assert.equal(orphan.kind, 'file');
    assert.equal(orphan.itemPath, LOGO);
    assert.equal(orphan.title, 'logo.png');
    assert.equal(orphan.canvasFileId, 500);
    assert.equal(orphan.pruned, false);
  });

  it('deletes it under --prune-canvas, and leaves the live one alone', () => {
    const result = plan({
      ...withFiles({ [LOGO]: row(500), [BRAND]: row(501) }, seen(BRAND)),
      policy: { pruneCanvas: true },
    });

    assert.deepEqual(types(result), ['delete-canvas-file']);
    const action = only(result, 'delete-canvas-file');
    assert.equal(action.itemPath, LOGO);
    assert.equal(action.canvasFileId, 500);
    assert.equal(result.orphans.canvas[0].pruned, true);
  });

  it('sweeps nothing at all under -m, however few modules it names', () => {
    // The set handed in is deliberately complete — every call site scans the
    // whole tree whatever `-m` says — so this is not the planner protecting
    // itself from a partial view. It is `-m` meaning what it means everywhere
    // else in this file: the author named the modules this run may touch, and a
    // Canvas file is not exempt from that. Naming the very module the row lives
    // in changes nothing, because a binary can be embedded from anywhere.
    const result = plan({
      ...withFiles({ [LOGO]: row(500) }, seen(BRAND)),
      policy: { pruneCanvas: true, modules: [FOLDER] },
    });

    assert.deepEqual(types(result), [], 'a scoped run must delete nothing');
    assert.deepEqual(
      result.orphans.canvas,
      [],
      'a scoped run cannot even call it an orphan',
    );
  });

  it('sweeps nothing when the gather could not read the tree whole', () => {
    // One unreadable markdown item is one item whose images are invisible, so
    // `complete` is the licence and it is default-deny. The absent case is the
    // one that matters most: every hand-built `local` in this file omits
    // `embedded` entirely, and so would any caller written before the flag.
    for (const embedded of [
      { refs: new Set(), complete: false },
      { refs: new Set() },
      undefined,
    ]) {
      const result = plan({
        ...withFiles({ [LOGO]: row(500) }, embedded),
        policy: { pruneCanvas: true },
      });
      assert.deepEqual(
        types(result),
        [],
        `swept with embedded=${JSON.stringify(embedded)}`,
      );
      assert.deepEqual(result.orphans.canvas, []);
    }
  });

  it('leaves a binary another item still embeds alone', () => {
    // The reference this run happened to look at went away; another page's did
    // not. Only a set built from the whole tree can tell the difference, which
    // is why the set is built in the gather and not in the executor.
    const result = plan({
      ...withFiles({ [LOGO]: row(500) }, seen(LOGO)),
      policy: { pruneCanvas: true },
    });

    assert.deepEqual(types(result), []);
    assert.deepEqual(result.orphans.canvas, []);
  });

  it('withholds the delete rather than losing it under status', () => {
    const result = plan({
      ...withFiles({ [LOGO]: row(500) }, seen()),
      policy: { write: { canvas: false, local: false }, pruneCanvas: true },
    });

    assert.deepEqual(types(result), []);
    assert.equal(result.orphans.canvas.length, 1);
    assert.equal(result.orphans.canvas[0].pruned, false);
    assert.equal(result.withheld.length, 1);
    assert.equal(result.withheld[0].type, 'delete-canvas-file');
    assert.equal(result.withheld[0].reason, 'write-policy');
  });
});

describe('plan: a file item recorded under the 1.5.1 fingerprint', () => {
  // The 1.5.2 migration bridge. 1.5.1 hashed a file's `updated_at`, 1.5.2
  // hashes its `modified_at`, so every stored file `canvas_hash` differs from
  // the live one after the update. `gatherCanvas` hands over what 1.5.1 would
  // have recorded as `legacyCanvasHash`, and a row that still matches it is
  // unchanged on Canvas. Here `legacy` is that hash and `C:new` the live one.
  const FILE = '01-intro/01-handbook.md';
  const RENAMED_FILE = '01-intro/01-guide.md';

  function legacy({
    local = true,
    localPath = FILE,
    localFields = {},
    canvasFields = {},
    rowFields = {},
  } = {}) {
    return {
      base: {
        modules: {
          [FOLDER]: bMod([FILE], {
            rows: {
              [FILE]: {
                canvas_type: 'file',
                page_url: null,
                canvas_hash: 'legacy',
                ...rowFields,
              },
            },
          }),
        },
      },
      local: {
        modules: [
          lMod(FOLDER, local ? [localPath] : [], {
            items: { [localPath]: { canvasType: 'file', ...localFields } },
          }),
        ],
      },
      canvas: {
        modules: [
          cMod([FILE], {
            items: {
              [FILE]: {
                canvasType: 'file',
                rawType: 'File',
                pageUrl: null,
                canvasHash: 'C:new',
                legacyCanvasHash: 'legacy',
                ...canvasFields,
              },
            },
          }),
        ],
      },
    };
  }

  const PUSH = { write: { canvas: true, local: false }, conflict: 'local' };
  const PULL = { write: { canvas: false, local: true }, conflict: 'canvas' };
  const STATUS = { write: { canvas: false, local: false } };

  it('reads as unchanged on Canvas, and records the new hash and nothing else', () => {
    const result = plan({ ...legacy(), policy: {} });

    assert.deepEqual(types(result), ['refresh-base-hash']);
    assert.deepEqual(only(result, 'refresh-base-hash'), {
      type: 'refresh-base-hash',
      folder: FOLDER,
      itemPath: FILE,
      legacyHash: 'legacy',
      canvasHash: 'C:new',
      canvasUpdatedAt: CANVAS_TIME,
    });
    assert.deepEqual(result.withheld, []);
    assert.deepEqual(result.conflicts, []);
    assert.deepEqual(result.decisions, []);
    assert.deepEqual(result.skipped, []);
  });

  it('records it under push and pull as well, and under status not at all', () => {
    // Bookkeeping, not a write to either side: the policy that pins a
    // direction must not withhold it, or a course that only ever pushes keeps
    // its 1.5.1 rows until the next publish click turns them into changes.
    for (const policy of [PUSH, PULL]) {
      const result = plan({ ...legacy(), policy });
      assert.deepEqual(types(result), ['refresh-base-hash']);
      assert.deepEqual(result.withheld, []);
    }

    const status = plan({ ...legacy(), policy: STATUS });
    assert.deepEqual(types(status), []);
    assert.deepEqual(
      status.withheld.map((action) => action.type),
      ['refresh-base-hash'],
    );
  });

  it('pushes a local change as an ordinary update, with no conflict', () => {
    const result = plan({
      ...legacy({ localFields: { localHash: 'edited' } }),
      policy: { conflict: 'ask' },
    });

    assert.deepEqual(types(result), [
      'update-canvas-item',
      'refresh-base-hash',
    ]);
    assert.equal(
      only(result, 'update-canvas-item').contentUnchanged,
      undefined,
    );
    assert.deepEqual(result.pending.conflicts, []);
    assert.deepEqual(result.conflicts, []);
  });

  it('plans the title-only update beside it when only the title moved', () => {
    const result = plan({
      ...legacy({ localFields: { title: 'Course handbook' } }),
      policy: {},
    });

    assert.deepEqual(types(result), [
      'update-canvas-item',
      'refresh-base-hash',
    ]);
    assert.equal(only(result, 'update-canvas-item').contentUnchanged, true);
  });

  it('carries the refresh to the path a rename re-keyed the row to', () => {
    const result = plan({
      ...legacy({
        localPath: RENAMED_FILE,
        localFields: { localHash: `L:${FILE}`, title: titleOf(FILE) },
      }),
      policy: {},
    });

    assert.deepEqual(types(result), ['rekey-base', 'refresh-base-hash']);
    assert.equal(only(result, 'refresh-base-hash').itemPath, RENAMED_FILE);
  });

  it('makes a file item deleted here an ordinary orphan, not a decision', () => {
    const result = plan({ ...legacy({ local: false }), policy: PUSH });

    assert.deepEqual(result.decisions, []);
    assert.equal(result.orphans.canvas.length, 1);
    assert.equal(result.orphans.canvas[0].itemPath, FILE);
    assert.equal(result.orphans.canvas[0].pruned, false);
    // The row stays, so it is brought up to date.
    assert.deepEqual(types(result), ['refresh-base-hash']);
  });

  it('prunes that orphan under --prune-canvas, and refreshes no row it deletes', () => {
    const result = plan({
      ...legacy({ local: false }),
      policy: { ...PUSH, pruneCanvas: true },
    });

    assert.deepEqual(result.decisions, []);
    assert.equal(result.orphans.canvas[0].pruned, true);
    assert.deepEqual(types(result), ['delete-canvas-item']);
  });

  it('reads a row the old formula no longer matches as changed, as before', () => {
    // A file Canvas locked or unlocked since 1.5.1 recorded the row: its
    // `updated_at` moved, so the bridge cannot vouch for it. That is the
    // defect being fixed, met one last time, not a hazard of the update.
    const result = plan({
      ...legacy({ canvasFields: { legacyCanvasHash: 'legacy-but-locked' } }),
      policy: {},
    });

    assert.deepEqual(types(result), ['update-local-item']);
  });

  it('leaves a row recorded on 1.5.2 to the ordinary comparison', () => {
    const unchanged = plan({
      ...legacy({ rowFields: { canvas_hash: 'C:new' } }),
      policy: {},
    });
    assert.deepEqual(types(unchanged), []);

    const changed = plan({
      ...legacy({ rowFields: { canvas_hash: 'C:older' } }),
      policy: {},
    });
    assert.deepEqual(types(changed), ['update-local-item']);
  });

  it('applies to a file row and nothing else', () => {
    // `gatherCanvas` gives no other type a legacy hash; this is the planner
    // refusing to take one on trust if a caller ever did.
    const result = plan({
      ...legacy({
        rowFields: { canvas_type: 'page', page_url: 'page-1-1' },
        localFields: { canvasType: 'page' },
        canvasFields: {
          canvasType: 'page',
          rawType: 'Page',
          pageUrl: 'page-1-1',
        },
      }),
      policy: {},
    });

    assert.deepEqual(types(result), ['update-local-item']);
  });
});
