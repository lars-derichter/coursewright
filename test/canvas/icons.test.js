const { describe, it, mock, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { mockCanvas, silence } = require('../helpers/canvas-mock');

process.env.CANVAS_API_URL = 'https://canvas.example.com';
process.env.CANVAS_API_TOKEN = 'test-token-123';

const { ensureIcons } = require('../../lib/canvas/icons');
const { ICON_FILES } = require('../../lib/convert/alert-icons');
const { loadTheme, themeFingerprint } = require('../../lib/config/theme');

const COURSE_ID = 4242;
const ICON_TYPES = Object.keys(ICON_FILES);
const FIRST_FILE_ID = 900;

afterEach(() => mock.restoreAll());

/**
 * The two hops a Canvas file upload takes, per icon: the grant, then the form
 * post to the URL the grant named. One id per icon, counting up from
 * FIRST_FILE_ID in the order `ensureIcons` walks them.
 */
function uploadRoutes() {
  const routes = [];
  ICON_TYPES.forEach((type, index) => {
    routes.push({
      method: 'POST',
      path: `/courses/${COURSE_ID}/files`,
      body: {
        upload_url: `https://canvas.example.com/upload/${type}`,
        upload_params: {},
      },
    });
    routes.push({
      method: 'POST',
      path: `/upload/${type}`,
      body: { id: FIRST_FILE_ID + index, display_name: ICON_FILES[type] },
    });
  });
  return routes;
}

/** Upload every icon under one `CANVAS_API_URL`, and hand back the rows. */
async function uploadedIcons(apiUrl) {
  return (await uploadRun(apiUrl)).icons;
}

/** The same run, with the recorded requests as well as the rows. */
async function uploadRun(apiUrl) {
  const original = process.env.CANVAS_API_URL;
  process.env.CANVAS_API_URL = apiUrl;
  try {
    silence();
    const calls = mockCanvas(uploadRoutes());
    const syncData = { icons: {} };
    await ensureIcons(COURSE_ID, syncData);
    return { icons: syncData.icons, calls };
  } finally {
    process.env.CANVAS_API_URL = original;
  }
}

describe('ensureIcons', () => {
  const PREVIEW = `https://canvas.example.com/courses/${COURSE_ID}/files/${FIRST_FILE_ID}/preview`;

  // `preview_url` is stored, and it is what Canvas HTML points every alert
  // icon's <img> at, so a slash too many is not cosmetic: it is written into
  // the sync file and into every page pushed afterwards. `.env` written by
  // `init` cannot produce these forms; one typed or pasted by hand can, and two
  // of the five below — the bare trailing slash, and the doubled slash in front
  // of the suffix — did produce one before `normaliseBaseUrl` became the trim
  // used here.
  for (const written of [
    'https://canvas.example.com',
    'https://canvas.example.com/',
    'https://canvas.example.com/api/v1',
    'https://canvas.example.com/api/v1/',
    'https://canvas.example.com//api/v1',
  ]) {
    it(`builds one clean preview URL from CANVAS_API_URL=${written}`, async () => {
      const icons = await uploadedIcons(written);
      assert.equal(icons.note.preview_url, PREVIEW);
    });
  }

  it('uploads each icon under its own name', async () => {
    // Canvas matches `on_duplicate: overwrite` on the name it is given, and
    // `uploadFile` takes that name off the path. A temp filename made unique
    // per run — `course-icon-<pid>-info.svg` — therefore only ever matched a
    // run that drew the same pid: every other one added six more files to
    // `/course-icons` instead of replacing the six that were there, and left
    // the pid in the author's own Files area. The uniqueness belongs to the
    // directory, which is why this asserts on the name Canvas is handed.
    const { calls } = await uploadRun('https://canvas.example.com');
    const grants = calls.filter(
      (call) =>
        call.method === 'POST' && call.url.includes('/files') && call.body,
    );
    assert.deepEqual(
      grants.map((call) => call.body.name),
      ICON_TYPES.map((type) => ICON_FILES[type]),
    );
  });

  describe('an icon the state already records', () => {
    // A row outlives its file. `reset-canvas` deletes `/course-icons` with
    // everything else, and an author can delete the folder by hand, and either
    // way the row still names a file id under the current theme. Trusting the
    // row alone sent every page that push rendered up with an `<img>` pointing
    // at a dead file, while `status` reported the course in sync.
    const RECORDED_ID = 500;
    const fingerprint = themeFingerprint(loadTheme());

    /** Every icon recorded under the current theme, one id each. */
    function recordedState() {
      const icons = {};
      ICON_TYPES.forEach((type, index) => {
        icons[type] = {
          canvas_file_id: RECORDED_ID + index,
          preview_url: `https://canvas.example.com/recorded/${type}`,
          theme: fingerprint,
        };
      });
      return { icons };
    }

    /** One existence check per icon; `answers` overrides a type's status. */
    function checkRoutes(answers = {}) {
      return ICON_TYPES.map((type, index) => ({
        method: 'GET',
        path: `/api/v1/files/${RECORDED_ID + index}`,
        status: answers[type] || 200,
        body: answers[type]
          ? { errors: [{ message: 'nope' }] }
          : { id: RECORDED_ID + index },
      }));
    }

    function uploads(calls) {
      return calls.filter((call) => call.method === 'POST');
    }

    it('uploads it again when Canvas answers 404, and records the new file', async () => {
      const out = silence();
      const NEW_ID = 950;
      const calls = mockCanvas([
        ...checkRoutes({ note: 404 }),
        {
          method: 'POST',
          path: `/courses/${COURSE_ID}/files`,
          body: {
            upload_url: 'https://canvas.example.com/upload/note',
            upload_params: {},
          },
        },
        {
          method: 'POST',
          path: '/upload/note',
          body: { id: NEW_ID, display_name: ICON_FILES.note },
        },
      ]);
      const syncData = recordedState();

      await ensureIcons(COURSE_ID, syncData);

      assert.deepEqual(syncData.icons.note, {
        canvas_file_id: NEW_ID,
        preview_url: `https://canvas.example.com/courses/${COURSE_ID}/files/${NEW_ID}/preview`,
        theme: fingerprint,
      });
      const grants = uploads(calls).filter((call) =>
        call.url.endsWith(`/courses/${COURSE_ID}/files`),
      );
      assert.deepEqual(
        grants.map((call) => call.body.name),
        [ICON_FILES.note],
        'only the missing icon goes up again',
      );
      for (const type of ICON_TYPES.filter((type) => type !== 'note')) {
        assert.deepEqual(syncData.icons[type], recordedState().icons[type]);
      }
      const said = out.log.mock.calls
        .map((call) => call.arguments.join(' '))
        .join('\n');
      assert.match(
        said,
        new RegExp(
          `${ICON_FILES.note} is gone from Canvas \\(id ${RECORDED_ID + ICON_TYPES.indexOf('note')}\\)`,
        ),
      );
    });

    it('makes no upload when Canvas still has every file', async () => {
      silence();
      const calls = mockCanvas(checkRoutes());
      const syncData = recordedState();

      await ensureIcons(COURSE_ID, syncData);

      assert.deepEqual(uploads(calls), []);
      assert.deepEqual(syncData, recordedState());
    });

    it('keeps the row and warns when the check fails for another reason', async () => {
      // A check that cannot answer must not block a push that worked before
      // it existed, so anything but a 404 leaves the row as it was.
      const out = silence();
      const calls = mockCanvas(checkRoutes({ note: 401 }));
      const syncData = recordedState();

      await ensureIcons(COURSE_ID, syncData);

      assert.deepEqual(uploads(calls), []);
      assert.deepEqual(syncData, recordedState());
      const warned = out.warn.mock.calls
        .map((call) => call.arguments.join(' '))
        .join('\n');
      assert.match(warned, new RegExp(`cannot check ${ICON_FILES.note}`));
      assert.match(warned, /401/);
    });
  });

  it('records a preview URL for every icon', async () => {
    const icons = await uploadedIcons('https://canvas.example.com/');
    assert.deepEqual(Object.keys(icons), ICON_TYPES);
    for (const [index, type] of ICON_TYPES.entries()) {
      assert.equal(
        icons[type].preview_url,
        `https://canvas.example.com/courses/${COURSE_ID}/files/${FIRST_FILE_ID + index}/preview`,
      );
    }
  });
});
