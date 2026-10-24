const fs = require('fs');
const os = require('os');
const path = require('path');
const log = require('../../cli/logger');
const { CanvasApiError, normaliseBaseUrl } = require('./client');
const { filePreviewPath, getFile, uploadFile } = require('./files');
const { ICON_FILES, readIconSvg } = require('../convert/alert-icons');
const { loadTheme, themeFingerprint } = require('../config/theme');

/**
 * Ensure all alert icons are uploaded to Canvas, painted in the theme's colours.
 *
 * Checks syncData.icons for each type and uploads any icon that is missing,
 * was uploaded under a different theme, or is recorded but no longer exists in
 * Canvas. Existence is verified with one GET per recorded icon, because a row
 * outlives its file: `reset-canvas` and a hand-deleted `/course-icons` both
 * leave the id in place. Uploaded file IDs, preview URLs and the theme
 * fingerprint are stored in syncData.icons.
 *
 * @param {string|number} courseId
 * @param {object} syncData - The sync data object (mutated in place).
 */
async function ensureIcons(courseId, syncData) {
  if (!syncData.icons) {
    syncData.icons = {};
  }

  // `preview_url` is stored absolute, so the site root goes in front of the
  // course-relative path `filePreviewPath` returns. Normalised because that path
  // opens with a slash: a `CANVAS_API_URL` ending in one — or carrying an
  // `/api/v1` suffix — would otherwise be baked into every icon's `<img src>` as
  // `https://host//courses/…`.
  const baseUrl = normaliseBaseUrl(process.env.CANVAS_API_URL);
  const theme = loadTheme();
  const fingerprint = themeFingerprint(theme);

  // The *directory* is what carries the run's uniqueness, never the filename.
  // `uploadFile` takes the Canvas name off the path it is handed, and Canvas
  // matches `on_duplicate: overwrite` on that name, so a name made unique per
  // run — `course-icon-<pid>-info.svg`, as this once was — could only ever
  // match a run that drew the same pid. Every other run uploaded six new files
  // and left the previous six in place, still referenced by every page not
  // pushed since, under names that were debris in the author's Files area.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'course-icons-'));

  try {
    for (const [type, filename] of Object.entries(ICON_FILES)) {
      const current = syncData.icons[type];
      if (current && current.canvas_file_id && current.theme === fingerprint) {
        // Recorded in the current theme's colours; only a 404 sends it to the
        // upload below. Any other failure keeps the row, as before this check
        // existed: a check that cannot answer must not block a push that would
        // otherwise work, and the client has already retried 429s and 5xx.
        try {
          await getFile(current.canvas_file_id);
          continue;
        } catch (err) {
          if (!(err instanceof CanvasApiError && err.status === 404)) {
            log.warn(
              `[icons] Warning: cannot check ${filename} on Canvas ` +
                `(id ${current.canvas_file_id}): ${err.message}`,
            );
            continue;
          }
          log.info(
            `[icons] ${filename} is gone from Canvas ` +
              `(id ${current.canvas_file_id}); uploading it again.`,
          );
        }
      }

      let svg;
      try {
        svg = readIconSvg(type, theme.alerts[type].fg);
      } catch (err) {
        log.warn(
          `[icons] Warning: cannot read icon for "${type}": ${err.message}`,
        );
        continue;
      }

      // Canvas renders the icon as an <img>, so the colour has to be baked into
      // the file. Upload a coloured copy from a temp file rather than editing
      // the source SVG, which stays theme-neutral.
      const tmpPath = path.join(tmpDir, filename);
      fs.writeFileSync(tmpPath, svg, 'utf8');

      log.info(`[icons] Uploading ${filename} to Canvas...`);
      const result = await uploadFile(courseId, tmpPath, {
        parentFolderPath: '/course-icons',
        onDuplicate: 'overwrite',
      });

      const fileId = result.id;
      syncData.icons[type] = {
        canvas_file_id: fileId,
        preview_url: `${baseUrl}${filePreviewPath(courseId, fileId)}`,
        theme: fingerprint,
      };

      log.info(`[icons] Uploaded ${filename} (id: ${fileId})`);
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Build an iconUrls map from sync data for use with markdownToHtml.
 *
 * @param {object} syncData
 * @returns {object} Map of alert type to Canvas preview URL.
 */
function getIconUrls(syncData) {
  const urls = {};
  if (syncData.icons) {
    for (const [type, data] of Object.entries(syncData.icons)) {
      if (data.preview_url) {
        urls[type] = data.preview_url;
      }
    }
  }
  return urls;
}

module.exports = { ensureIcons, getIconUrls };
