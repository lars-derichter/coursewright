const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  CANVAS_FINGERPRINT_FIELDS,
  canvasFingerprint,
  canvasPayload,
  canvasTimestamp,
  hashBinaryFile,
  hashLocalFile,
  hashText,
  legacyFileFingerprint,
  needsContentFetch,
} = require('../../lib/sync/fingerprint');

/**
 * The fields each type's payload must hold, sorted, written out by hand rather
 * than read from `CANVAS_FINGERPRINT_FIELDS`. Deriving them from the table would
 * make this test agree with whatever the table says, which is the one thing it
 * is here to catch: a field silently added to, or dropped from, a fingerprint.
 */
const EXPECTED_FIELDS = {
  page: ['body', 'content_title', 'indent', 'title'],
  assignment: [
    'content_title',
    'description',
    'due_at',
    'indent',
    'lock_at',
    'points_possible',
    'published',
    'submission_types',
    'title',
    'unlock_at',
  ],
  discussion: [
    'content_title',
    'delayed_post_at',
    'discussion_type',
    'indent',
    'lock_at',
    'message',
    'published',
    'require_initial_post',
    'title',
  ],
  quiz: ['indent', 'title'],
  sub_header: ['indent', 'title'],
  external_url: ['external_url', 'indent', 'new_tab', 'title'],
  external_tool: ['external_url', 'indent', 'new_tab', 'title'],
  file: ['content_title', 'indent', 'modified_at', 'size', 'title'],
};

const TYPES = Object.keys(EXPECTED_FIELDS);

/** The types with an object behind the module item, and what it calls its name. */
const CONTENT_TITLE_KEY = {
  page: 'title',
  assignment: 'name',
  discussion: 'title',
  file: 'display_name',
};

const CONTENT_TYPES = Object.keys(CONTENT_TITLE_KEY);
const REFERENCE_TYPES = TYPES.filter((t) => !CONTENT_TITLE_KEY[t]);

/** The fields read from the module item rather than from the content object. */
const ITEM_FIELDS = ['title', 'indent', 'external_url', 'new_tab'];

/** A module item and its content object, populated for every type. */
function sources(overrides = {}) {
  const item = {
    id: 5678,
    title: 'Welcome',
    indent: 1,
    position: 3,
    type: 'Page',
    external_url: 'https://example.org/tool',
    new_tab: true,
    ...overrides.item,
  };
  const content = {
    id: 1234,
    title: 'Welcome page',
    name: 'Welcome assignment',
    display_name: 'welcome.pdf',
    body: '<p>Hello</p>',
    description: '<p>Do the thing</p>',
    message: '<p>Discuss</p>',
    points_possible: 20,
    submission_types: ['online_upload'],
    due_at: '2026-01-01T10:00:00Z',
    unlock_at: '2025-12-01T10:00:00Z',
    lock_at: '2026-02-01T10:00:00Z',
    delayed_post_at: '2025-12-15T10:00:00Z',
    published: true,
    discussion_type: 'threaded',
    require_initial_post: false,
    updated_at: '2026-01-05T10:00:00Z',
    modified_at: '2026-01-04T10:00:00Z',
    locked: false,
    size: 4096,
    ...overrides.content,
  };
  return { item, content };
}

/** A value that differs from the one `sources` puts in that field. */
const CHANGED_VALUES = {
  title: 'Welcome, again',
  indent: 2,
  body: '<p>Hello again</p>',
  description: '<p>Do the other thing</p>',
  message: '<p>Discuss something else</p>',
  points_possible: 25,
  submission_types: ['online_text_entry'],
  due_at: '2026-01-02T10:00:00Z',
  unlock_at: '2025-12-02T10:00:00Z',
  lock_at: '2026-02-02T10:00:00Z',
  delayed_post_at: '2025-12-16T10:00:00Z',
  published: false,
  discussion_type: 'side_comment',
  require_initial_post: true,
  external_url: 'https://example.org/other',
  new_tab: false,
  modified_at: '2026-01-04T11:00:00Z',
  size: 8192,
};

/**
 * The overrides that give one owned field a different value. `content_title` is
 * the only field whose Canvas key is not its own name, so it is the only one
 * that needs the type to work out what to override.
 */
function change(canvasType, field) {
  if (field === 'content_title') {
    return {
      content: { [CONTENT_TITLE_KEY[canvasType]]: 'Renamed in Canvas' },
    };
  }
  const side = ITEM_FIELDS.includes(field) ? 'item' : 'content';
  return { [side]: { [field]: CHANGED_VALUES[field] } };
}

describe('hashText', () => {
  it('is stable and distinguishes different content', () => {
    assert.equal(hashText('hello\n'), hashText('hello\n'));
    assert.notEqual(hashText('hello\n'), hashText('goodbye\n'));
    assert.match(hashText('hello\n'), /^[0-9a-f]{64}$/);
  });

  it('reads CRLF and a lone CR as the same line ending as LF', () => {
    const lf = hashText('one\ntwo\nthree\n');
    assert.equal(hashText('one\r\ntwo\r\nthree\r\n'), lf);
    assert.equal(hashText('one\rtwo\rthree\r'), lf);
    assert.equal(hashText('one\r\ntwo\nthree\r'), lf);
  });

  it('ignores a leading BOM, and only a leading one', () => {
    assert.equal(hashText('﻿hello\n'), hashText('hello\n'));
    assert.notEqual(hashText('hello﻿\n'), hashText('hello\n'));
  });

  it('treats a nullish input as the empty string', () => {
    assert.equal(hashText(undefined), hashText(''));
    assert.equal(hashText(null), hashText(''));
  });

  it('keeps trailing whitespace and the final newline', () => {
    // Adding or removing either is a real edit to the file, and a hash that hid
    // it would leave local reading as unchanged while Canvas never sees it.
    assert.notEqual(hashText('hello'), hashText('hello\n'));
    assert.notEqual(hashText('hello\n'), hashText('hello\n\n'));
    assert.notEqual(hashText('hello  \n'), hashText('hello\n'));
  });
});

describe('hashLocalFile and hashBinaryFile', () => {
  let dir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-fingerprint-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /** Write a file exactly as given, UTF-8, and hand back the path. */
  function write(name, contents) {
    const filePath = path.join(dir, name);
    fs.writeFileSync(filePath, contents, 'utf8');
    return filePath;
  }

  it('hashes a CRLF file the same as its LF twin', () => {
    const lf = write('lf.md', '# Title\n\nBody\n');
    const crlf = write('crlf.md', '# Title\r\n\r\nBody\r\n');
    const cr = write('cr.md', '# Title\r\rBody\r');

    assert.equal(hashLocalFile(crlf), hashLocalFile(lf));
    assert.equal(hashLocalFile(cr), hashLocalFile(lf));
  });

  it('ignores a BOM but not a dropped trailing newline', () => {
    const plain = write('plain.md', '# Title\n');
    const bom = write('bom.md', '﻿# Title\n');
    const noNewline = write('no-newline.md', '# Title');

    assert.equal(hashLocalFile(bom), hashLocalFile(plain));
    assert.notEqual(hashLocalFile(noNewline), hashLocalFile(plain));
  });

  it('agrees with hashText over the same bytes', () => {
    const filePath = write('same.md', '# Title\r\n\r\nBody\r\n');
    assert.equal(hashLocalFile(filePath), hashText('# Title\n\nBody\n'));
  });

  it('does not normalise a binary: CRLF and LF hash differently', () => {
    // The whole point of the second function. A 0x0d inside a PNG is data, and
    // rewriting it would produce a hash no uploaded file ever matches.
    const crlf = write('crlf.bin', 'one\r\ntwo\r\n');
    const lf = write('lf.bin', 'one\ntwo\n');

    assert.notEqual(hashBinaryFile(crlf), hashBinaryFile(lf));
    assert.equal(hashBinaryFile(lf), hashLocalFile(lf));
  });

  it('does not strip a BOM from a binary either', () => {
    const bom = write('bom.bin', '﻿PNG');
    const plain = write('plain.bin', 'PNG');
    assert.notEqual(hashBinaryFile(bom), hashBinaryFile(plain));
  });
});

describe('canvasPayload field tables', () => {
  for (const canvasType of TYPES) {
    it(`holds exactly the fields ${canvasType} owns, and no more`, () => {
      const payload = canvasPayload(sources(), canvasType);
      assert.deepEqual(
        Object.keys(payload).sort(),
        EXPECTED_FIELDS[canvasType],
      );
    });

    it(`exports the same list for ${canvasType} as it hashes`, () => {
      assert.deepEqual(
        [...CANVAS_FINGERPRINT_FIELDS[canvasType]].sort(),
        EXPECTED_FIELDS[canvasType],
      );
    });
  }

  it('never hashes position, canvas_id or canvas_type', () => {
    for (const fields of Object.values(CANVAS_FINGERPRINT_FIELDS)) {
      assert.equal(fields.includes('position'), false);
      assert.equal(fields.includes('canvas_id'), false);
      assert.equal(fields.includes('canvas_type'), false);
    }
  });
});

describe('canvasFingerprint and position', () => {
  it('does not change when an item moves within its module', () => {
    // The exclusion that matters most. Hash the position and moving one item up
    // renumbers every item below it, marks them all as changed on Canvas, and
    // the next sync pulls the whole module over the author's local copies.
    for (const canvasType of TYPES) {
      const before = canvasFingerprint(sources(), canvasType);
      const after = canvasFingerprint(
        sources({ item: { position: 99 } }),
        canvasType,
      );
      assert.equal(after, before, `position moved the hash for ${canvasType}`);
    }
  });
});

describe('canvasFingerprint and identity', () => {
  it('does not change when the Canvas ids do', () => {
    // A re-adopted item is matched to another Canvas object; that is identity
    // changing, not content, and it must not read as a remote edit.
    for (const canvasType of TYPES) {
      const before = canvasFingerprint(sources(), canvasType);
      const after = canvasFingerprint(
        sources({
          item: { id: 999, content_id: 999, canvas_type: 'page' },
          content: { id: 888, canvas_id: 888, page_id: 777, url: 'other' },
        }),
        canvasType,
      );
      assert.equal(after, before, `identity moved the hash for ${canvasType}`);
    }
  });

  it('ignores fields Canvas owns but this tool does not manage', () => {
    const before = canvasFingerprint(sources(), 'page');
    const after = canvasFingerprint(
      sources({
        content: {
          updated_at: '2030-01-01T00:00:00Z',
          last_edited_by: { id: 7 },
          editing_roles: 'teachers',
          published: false,
        },
      }),
      'page',
    );
    assert.equal(after, before);
  });
});

describe('canvasFingerprint and key order', () => {
  it('is the same whichever order the API filled the object in', () => {
    const a = {
      item: { title: 'Welcome', indent: 1 },
      content: { body: '<p>Hi</p>', description: '<p>Do</p>' },
    };
    const b = {
      content: { description: '<p>Do</p>', body: '<p>Hi</p>' },
      item: { indent: 1, title: 'Welcome' },
    };
    assert.equal(
      canvasFingerprint(b, 'page'),
      canvasFingerprint(a, 'page'),
      'key insertion order changed the hash',
    );
  });

  it('is the same for a nested object built in another order', () => {
    const a = { item: { title: 'A', indent: 0 }, content: {} };
    const b = { item: { indent: 0, title: 'A' }, content: {} };
    assert.equal(canvasFingerprint(b, 'quiz'), canvasFingerprint(a, 'quiz'));
  });
});

describe('canvasPayload normalisation', () => {
  it('re-emits a date, so two spellings of one instant agree', () => {
    const short = canvasPayload(
      { item: {}, content: { due_at: '2026-01-01T10:00:00Z' } },
      'assignment',
    );
    const long = canvasPayload(
      { item: {}, content: { due_at: '2026-01-01T10:00:00.000Z' } },
      'assignment',
    );
    assert.equal(short.due_at, '2026-01-01T10:00:00.000Z');
    assert.equal(long.due_at, short.due_at);
  });

  it('keeps an unparseable date instead of throwing', () => {
    const payload = canvasPayload(
      { item: {}, content: { due_at: 'whenever' } },
      'assignment',
    );
    assert.equal(payload.due_at, 'whenever');
    assert.doesNotThrow(() =>
      canvasFingerprint(
        { item: {}, content: { due_at: 'whenever' } },
        'assignment',
      ),
    );
  });

  it('reads an absent date, an undefined one and a null one alike', () => {
    const absent = canvasFingerprint({ item: {}, content: {} }, 'assignment');
    const undef = canvasFingerprint(
      { item: {}, content: { due_at: undefined } },
      'assignment',
    );
    const nulled = canvasFingerprint(
      { item: {}, content: { due_at: null } },
      'assignment',
    );
    assert.equal(undef, absent);
    assert.equal(nulled, absent);
  });

  it('reads an absent body, a null one and an empty one alike', () => {
    const base = { item: { title: 'A', indent: 0 } };
    const absent = canvasFingerprint({ ...base, content: {} }, 'page');
    assert.equal(
      canvasFingerprint({ ...base, content: { body: undefined } }, 'page'),
      absent,
    );
    assert.equal(
      canvasFingerprint({ ...base, content: { body: null } }, 'page'),
      absent,
    );
    assert.equal(
      canvasFingerprint({ ...base, content: { body: '' } }, 'page'),
      absent,
    );
  });

  it('keeps "not set" and "set to false" apart for a boolean', () => {
    const unset = canvasFingerprint({ item: {}, content: {} }, 'assignment');
    const explicit = canvasFingerprint(
      { item: {}, content: { published: false } },
      'assignment',
    );
    assert.notEqual(explicit, unset);
    assert.equal(
      canvasPayload({ item: {}, content: {} }, 'assignment').published,
      null,
    );
    assert.equal(
      canvasPayload({ item: {}, content: { published: null } }, 'assignment')
        .published,
      null,
    );
  });

  it('coerces a boolean Canvas sent as a string', () => {
    // Boolean('false') is true, which would read an unpublished item as live.
    const payload = (published) =>
      canvasPayload({ item: {}, content: { published } }, 'assignment');
    assert.equal(payload('false').published, false);
    assert.equal(payload('true').published, true);
    assert.equal(payload(1).published, true);
    assert.equal(payload(0).published, false);
    assert.equal(payload(true).published, true);
  });

  it('treats submission_types as a set, without touching the caller array', () => {
    const forwards = ['online_upload', 'online_text_entry'];
    const backwards = ['online_text_entry', 'online_upload'];
    const hash = (submission_types) =>
      canvasFingerprint(
        { item: {}, content: { submission_types } },
        'assignment',
      );

    assert.equal(hash(backwards), hash(forwards));
    assert.deepEqual(forwards, ['online_upload', 'online_text_entry']);
    assert.deepEqual(backwards, ['online_text_entry', 'online_upload']);
  });

  it('registers a genuinely different set of submission types', () => {
    const hash = (submission_types) =>
      canvasFingerprint(
        { item: {}, content: { submission_types } },
        'assignment',
      );
    assert.notEqual(hash(['online_upload']), hash(['online_text_entry']));
    assert.notEqual(
      hash(['online_upload']),
      hash(['online_upload', 'online_text_entry']),
    );
  });

  it('reads an absent indent as 0', () => {
    const zero = canvasFingerprint(
      { item: { indent: 0 }, content: {} },
      'quiz',
    );
    assert.equal(
      canvasFingerprint({ item: { indent: undefined }, content: {} }, 'quiz'),
      zero,
    );
    assert.equal(canvasFingerprint({ item: {}, content: {} }, 'quiz'), zero);
    assert.equal(
      canvasPayload({ item: { indent: '2' }, content: {} }, 'quiz').indent,
      2,
    );
  });
});

describe('canvasFingerprint and real edits', () => {
  for (const canvasType of TYPES) {
    it(`moves when any field ${canvasType} owns changes`, () => {
      const base = canvasFingerprint(sources(), canvasType);
      for (const field of CANVAS_FINGERPRINT_FIELDS[canvasType]) {
        const changed = canvasFingerprint(
          sources(change(canvasType, field)),
          canvasType,
        );
        assert.notEqual(
          changed,
          base,
          `${canvasType}.${field} changed without moving the hash`,
        );
      }
    });
  }

  it('gives two different types different hashes for the same item', () => {
    const item = { title: 'Same', indent: 0 };
    assert.notEqual(
      canvasFingerprint({ item, content: {} }, 'quiz'),
      canvasFingerprint({ item, content: {} }, 'page'),
    );
  });
});

describe('canvasFingerprint and the two titles', () => {
  for (const canvasType of CONTENT_TYPES) {
    it(`sees a ${canvasType} renamed on the content object`, () => {
      // Renaming the page or assignment itself moves the content's own name and
      // leaves the module item's label alone. Watch only the item and this edit
      // never registers, and the local file silently disagrees from then on.
      const base = canvasFingerprint(sources(), canvasType);
      const renamed = canvasFingerprint(
        sources({ content: { [CONTENT_TITLE_KEY[canvasType]]: 'Renamed' } }),
        canvasType,
      );
      assert.notEqual(renamed, base);
    });

    it(`sees a ${canvasType} relabelled on the module item`, () => {
      // The other direction, asserted separately: neither title may mask the
      // other, so both have to move the hash on their own.
      const base = canvasFingerprint(sources(), canvasType);
      const relabelled = canvasFingerprint(
        sources({ item: { title: 'Relabelled' } }),
        canvasType,
      );
      assert.notEqual(relabelled, base);
    });

    it(`reads the ${canvasType} name from the key Canvas uses for it`, () => {
      const payload = canvasPayload(sources(), canvasType);
      const content = sources().content;
      assert.equal(
        payload.content_title,
        content[CONTENT_TITLE_KEY[canvasType]],
      );
      assert.notEqual(payload.content_title, payload.title);
    });
  }

  it('reads an absent content title, a null one and an undefined one alike', () => {
    const item = { title: 'Welcome', indent: 0 };
    const absent = canvasFingerprint({ item, content: {} }, 'page');
    assert.equal(
      canvasFingerprint({ item, content: { title: undefined } }, 'page'),
      absent,
    );
    assert.equal(
      canvasFingerprint({ item, content: { title: null } }, 'page'),
      absent,
    );
    assert.equal(
      canvasPayload({ item, content: {} }, 'page').content_title,
      null,
    );
  });

  it('keeps an absent content title apart from an empty one', () => {
    // Unlike a body: an object Canvas returned no name for and one named '' are
    // not the same object.
    const item = { title: 'Welcome', indent: 0 };
    assert.notEqual(
      canvasFingerprint({ item, content: { title: '' } }, 'page'),
      canvasFingerprint({ item, content: {} }, 'page'),
    );
  });
});

describe('canvasFingerprint on reference types', () => {
  for (const canvasType of REFERENCE_TYPES) {
    it(`gives ${canvasType} no content title, having no content`, () => {
      const item = {
        title: 'Reference',
        indent: 0,
        external_url: 'https://example.org/',
        new_tab: true,
      };

      assert.equal(
        CANVAS_FINGERPRINT_FIELDS[canvasType].includes('content_title'),
        false,
      );

      let hash;
      assert.doesNotThrow(() => {
        hash = canvasFingerprint({ item }, canvasType);
      });
      assert.equal(
        Object.hasOwn(canvasPayload({ item }, canvasType), 'content_title'),
        false,
      );
      // A content object that arrived anyway changes nothing: there is no
      // second title to read off it.
      assert.equal(
        canvasFingerprint({ item, content: { title: 'Ignored' } }, canvasType),
        hash,
      );
    });
  }

  it('fingerprints an external URL from the module item alone', () => {
    const item = {
      title: 'Course site',
      indent: 0,
      external_url: 'https://example.org/',
      new_tab: true,
    };

    let hash;
    assert.doesNotThrow(() => {
      hash = canvasFingerprint({ item }, 'external_url');
    });
    assert.match(hash, /^[0-9a-f]{64}$/);
    assert.equal(
      hash,
      canvasFingerprint({ item, content: {} }, 'external_url'),
    );
    assert.deepEqual(canvasPayload({ item }, 'external_url'), {
      title: 'Course site',
      indent: 0,
      external_url: 'https://example.org/',
      new_tab: true,
    });
  });

  it('fingerprints a quiz from its module item, ignoring the quiz itself', () => {
    const item = { title: 'Test 1', indent: 0 };
    assert.equal(
      canvasFingerprint({ item, content: { question_count: 40 } }, 'quiz'),
      canvasFingerprint({ item }, 'quiz'),
    );
  });

  it('fingerprints a text header, which is a title and an indent and no more', () => {
    // Every subfolder inside a module folder becomes one of these, so a course
    // laid out the way this project documents is full of them. Leaving the type
    // out of the table made an ordinary module read as ununderstandable.
    const item = { title: 'Theory', indent: 0 };

    assert.deepEqual(canvasPayload({ item }, 'sub_header'), {
      title: 'Theory',
      indent: 0,
    });
    let hash;
    assert.doesNotThrow(() => {
      hash = canvasFingerprint({ item }, 'sub_header');
    });
    assert.notEqual(
      canvasFingerprint({ item: { ...item, title: 'Practice' } }, 'sub_header'),
      hash,
    );
    assert.notEqual(
      canvasFingerprint({ item: { ...item, indent: 1 } }, 'sub_header'),
      hash,
    );
  });
});

describe('canvasFingerprint on a file', () => {
  const item = { title: 'Slides', indent: 0 };
  /** What the upload response and every later `GET /files/:id` agree on. */
  const uploaded = {
    display_name: 'slides.pdf',
    size: 10,
    modified_at: '2026-10-01T09:00:00Z',
    updated_at: '2026-10-01T09:00:00Z',
    locked: false,
  };

  it('takes modified_at and size from the file object', () => {
    assert.deepEqual(canvasPayload({ item, content: uploaded }, 'file'), {
      title: 'Slides',
      indent: 0,
      content_title: 'slides.pdf',
      modified_at: '2026-10-01T09:00:00.000Z',
      size: 10,
    });
    assert.notEqual(
      canvasFingerprint({ item, content: { ...uploaded, size: 11 } }, 'file'),
      canvasFingerprint({ item, content: uploaded }, 'file'),
    );
  });

  it('does not move when Canvas locks and unlocks the file with its module', () => {
    // Measured on a Canvas sandbox: unpublishing the module locks the file and
    // moves its `updated_at`, publishing it again unlocks it and moves it once
    // more, and `modified_at` stays where the upload left it. With
    // `updated_at` in the hash, one publish click made every file item in the
    // module read as changed on Canvas, and the next pull downloaded each
    // binary again.
    const recorded = canvasFingerprint({ item, content: uploaded }, 'file');
    const locked = {
      ...uploaded,
      locked: true,
      updated_at: '2026-10-01T09:05:00Z',
    };
    const unlocked = {
      ...uploaded,
      locked: false,
      updated_at: '2026-10-01T09:06:00Z',
    };

    assert.equal(
      canvasFingerprint({ item, content: locked }, 'file'),
      recorded,
    );
    assert.equal(
      canvasFingerprint({ item, content: unlocked }, 'file'),
      recorded,
    );
  });

  it('moves when the file is replaced, even by one of the same size', () => {
    // A same-name upload with `on_duplicate=overwrite` keeps the file id and
    // moves `modified_at`. Size alone would miss this year's PDF whenever it
    // happened to weigh exactly what last year's did.
    const replaced = {
      ...uploaded,
      modified_at: '2026-10-02T09:00:00Z',
      updated_at: '2026-10-02T09:00:00Z',
    };
    assert.notEqual(
      canvasFingerprint({ item, content: replaced }, 'file'),
      canvasFingerprint({ item, content: uploaded }, 'file'),
    );
  });
});

describe('legacyFileFingerprint, the 1.5.2 migration bridge', () => {
  const item = { title: 'Slides', indent: 0 };
  const file = {
    display_name: 'slides.pdf',
    size: 10,
    modified_at: '2026-10-01T09:00:00Z',
    updated_at: '2026-10-01T09:00:00Z',
    locked: false,
  };

  it('reproduces the hash 1.5.1 recorded for a file item, exactly', () => {
    // The whole bridge rests on this: a row written by 1.5.1 has to match it
    // byte for byte, or every file item reads as changed on Canvas after the
    // update. The canonical JSON is the 1.5.1 payload written out, and the hex
    // is what 1.5.1's own `canvasFingerprint(sources, 'file')` returned for
    // these sources, computed against that release's code.
    const hash = legacyFileFingerprint({ item, content: file });
    assert.equal(
      hash,
      hashText(
        '{"content_title":"slides.pdf","indent":0,"size":10,"title":"Slides",' +
          '"updated_at":"2026-10-01T09:00:00.000Z"}',
      ),
    );
    assert.equal(
      hash,
      'eef497e9f210e7747c9f47ed7f729e2ea04bd3b7b54e454a394aa0968a49749c',
    );
  });

  it('normalises the way 1.5.1 did', () => {
    // A string indent read as a number, a missing name and size read as null,
    // and a date that will not parse kept verbatim: each of these is a row
    // 1.5.1 may have written, and a different spelling here would miss it.
    const hash = legacyFileFingerprint({
      item: { title: 'Slides', indent: '2' },
      content: { updated_at: 'not a date' },
    });
    assert.equal(
      hash,
      '4f9e97a8e8d286acd7e09d5f81d1a79f0e0250d6982a4fab0b937306c4dcdc44',
    );
  });

  it('moves with updated_at, which is why it was retired', () => {
    assert.notEqual(
      legacyFileFingerprint({
        item,
        content: { ...file, locked: true, updated_at: '2026-10-01T09:05:00Z' },
      }),
      legacyFileFingerprint({ item, content: file }),
    );
  });

  it('never equals the fingerprint that replaced it', () => {
    assert.notEqual(
      legacyFileFingerprint({ item, content: file }),
      canvasFingerprint({ item, content: file }, 'file'),
    );
  });
});

describe('canvasTimestamp', () => {
  it('times a file by modified_at, not by the updated_at a lock moves', () => {
    // The `newest` tiebreak reads this. A publish click after a real conflict
    // began must not make Canvas look newer than the binary it holds.
    assert.equal(
      canvasTimestamp(
        {
          modified_at: '2026-10-01T09:00:00Z',
          updated_at: '2026-10-01T09:05:00Z',
        },
        'file',
      ),
      '2026-10-01T09:00:00Z',
    );
  });

  it('falls back to updated_at for a file Canvas gave no modified_at', () => {
    assert.equal(
      canvasTimestamp({ updated_at: '2026-10-01T09:05:00Z' }, 'file'),
      '2026-10-01T09:05:00Z',
    );
    assert.equal(
      canvasTimestamp(
        { modified_at: null, updated_at: '2026-10-01T09:05:00Z' },
        'file',
      ),
      '2026-10-01T09:05:00Z',
    );
  });

  it('times every other type by updated_at', () => {
    // A page has to keep it: the pre-filter in `gatherCanvas` compares the
    // stored value against the page list's `updated_at`.
    const content = {
      modified_at: '2026-10-01T09:00:00Z',
      updated_at: '2026-10-01T09:05:00Z',
    };
    for (const canvasType of ['page', 'assignment', 'discussion']) {
      assert.equal(
        canvasTimestamp(content, canvasType),
        '2026-10-01T09:05:00Z',
        canvasType,
      );
    }
  });

  it('answers null when there is no object, or no timestamp on it', () => {
    assert.equal(canvasTimestamp(null, 'file'), null);
    assert.equal(canvasTimestamp(undefined, 'page'), null);
    assert.equal(canvasTimestamp({}, 'file'), null);
    assert.equal(canvasTimestamp({}, 'assignment'), null);
  });
});

describe('unknown types', () => {
  it('refuses to fingerprint one rather than hashing half of it', () => {
    assert.throws(
      () => canvasFingerprint({ item: { title: 'Mystery' } }, 'wiki_gadget'),
      (err) => {
        assert.match(err.message, /"wiki_gadget"/);
        assert.match(err.message, /reported and skipped/);
        return true;
      },
    );
    // The table is keyed by the normalised type, so Canvas's own spelling of a
    // type this version *does* know is still not one of its keys.
    assert.throws(
      () => canvasFingerprint({ item: {} }, 'SubHeader'),
      /Cannot fingerprint/,
    );
    assert.throws(
      () => canvasPayload({ item: {} }, undefined),
      /Cannot fingerprint/,
    );
  });

  it('is not fooled by a name Object.prototype happens to carry', () => {
    assert.throws(
      () => canvasPayload({ item: {} }, 'constructor'),
      /Cannot fingerprint/,
    );
  });

  it('needs a content fetch for a page and nothing else', () => {
    assert.equal(needsContentFetch('page'), true);
    for (const canvasType of TYPES.filter((t) => t !== 'page')) {
      assert.equal(needsContentFetch(canvasType), false);
    }
    assert.equal(needsContentFetch('SubHeader'), false);
    assert.equal(needsContentFetch(undefined), false);
  });
});
