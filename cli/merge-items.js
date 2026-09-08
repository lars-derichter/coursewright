const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');
const { prompt, createRL } = require('./module-utils');
const {
  getItems,
  printItems,
  selectModule,
  selectTargetDir,
} = require('./item-utils');
const { renumberSequential } = require('./renumber');
const { writeMarkdown } = require('../lib/convert/format-markdown');
const { serializeFrontmatter } = require('../lib/convert/frontmatter');
const { displayTitle } = require('../lib/convert/course-scanner');
const { dropRowsRenumberedOver, recordRenames } = require('./sync-renames');

/**
 * The blank lines at either end of a body, gone. What matters when two bodies
 * are joined is where the text starts and stops, not how each file was padded.
 * Indentation on the first line survives, so a body opening with an indented
 * code block still opens with one.
 */
function trimBlankLines(body) {
  return body.replace(/^(?:[ \t]*\n)+/, '').replace(/\s+$/, '');
}

/**
 * Core merge logic: append the source body under a heading naming the source,
 * delete the source, renumber.
 *
 * The heading is the seam. The source's own title used to travel along inside
 * its body as an H1 and marked where the merged-in material began; with the
 * title living in frontmatter and no H1 in a page body, that marker goes with
 * the deleted file and the two pages' prose runs together. So the merge writes
 * the source's title in as a level-2 heading: level 1 is the page heading,
 * which comes from the target's frontmatter, so a section inside the page is
 * `##`, the level the old H1 was shifted to in a whole-course export anyway.
 * The title comes from the source's frontmatter, or from its filename when it
 * carries none (`displayTitle`, the same fallback the scanner uses).
 *
 * Either body may be empty, since a scaffolded page is frontmatter and nothing
 * else. An empty section is dropped rather than padded out: an empty target
 * yields the heading first, and an empty source yields the heading with nothing
 * under it, which says the page was merged in and had no content, rather than
 * losing its name silently.
 *
 * Async because the merged file goes out through `writeMarkdown`, which formats
 * it first. Joining two bodies is exactly the moment stray blank lines and an
 * unwrapped paragraph appear, and leaving them would show up as an edit in the
 * author's next `npm run format`.
 *
 * @param {string} targetPath - Absolute path to the target file (keeps frontmatter).
 * @param {string} sourcePath - Absolute path to the source file (appended under its title, then deleted).
 * @param {string} targetDir  - Directory containing both files.
 * @param {object} [options]
 * @param {string} [options.courseDir] - Injection point for tests.
 * @param {string} [options.file]      - Injection point for tests.
 */
async function _mergeFiles(targetPath, sourcePath, targetDir, options = {}) {
  const { courseDir, file } = options;
  const targetRaw = fs.readFileSync(targetPath, 'utf8');
  const sourceRaw = fs.readFileSync(sourcePath, 'utf8');

  const targetParsed = matter(targetRaw);
  const sourceParsed = matter(sourceRaw);

  const sourceTitle =
    sourceParsed.data.title || displayTitle(path.basename(sourcePath, '.md'));

  // Target body, the source's title as a section heading, source body, with
  // one blank line between whichever of the three there are. The empty string
  // a nameless file would leave behind is dropped by the same filter, because
  // `##` on its own is a heading with nothing in it.
  const merged = [
    trimBlankLines(targetParsed.content),
    sourceTitle ? `## ${sourceTitle}` : '',
    trimBlankLines(sourceParsed.content),
  ]
    .filter((section) => section !== '')
    .join('\n\n');

  // Write merged content back to target (keeps target's frontmatter)
  const result = serializeFrontmatter(targetParsed.data, merged);
  await writeMarkdown(targetPath, result);
  console.log(`[merge-items] Merged content into ${path.basename(targetPath)}`);

  // The source file goes; the row keyed by its path stays. A merge leaves the
  // Canvas page behind it untouched and live, and that row is the only record
  // that it is the author's to delete: without one the planner pairs the page
  // with no local file and no base, and writes it back into `course/` as a new
  // item — undoing the merge on the next sync — while `--prune-canvas`, whose
  // candidates are base rows, has nothing to offer. Kept, the page is reported
  // under `Orphaned on Canvas` and a prune can remove it.

  // Delete source file
  fs.unlinkSync(sourcePath);
  console.log(`[merge-items] Deleted ${path.basename(sourcePath)}`);

  // Renumber remaining items. A merge closes the gap the source left, so it
  // can slide a sibling sharing that slug onto the source's own path — the
  // same collision `delete-item` has, and settled the same way, before
  // `recordRenames` resolves it the wrong way round.
  const renames = renumberSequential(targetDir, getItems);
  dropRowsRenumberedOver(
    [
      {
        fromDir: targetDir,
        deleted: path.basename(sourcePath),
        renames,
      },
    ],
    { tag: 'merge-items', courseDir, file },
  );
  recordRenames([{ fromDir: targetDir, renames }], { courseDir, file });
  if (renames.length > 0) {
    console.log('[merge-items] Renumbered remaining items:');
    for (const r of renames) {
      console.log(`  ${r.from} -> ${r.to}`);
    }
  }
}

async function mergeItems(options) {
  const opts = options || {};

  // Non-interactive mode (VS Code): --source and --target provided; requires
  // --yes since there is no prompt to confirm, and a merge deletes the source.
  if (opts.source && opts.target) {
    if (!opts.yes) {
      console.error(
        '[merge-items] Error: --source and --target require --yes to confirm ' +
          'deleting the source.',
      );
      process.exit(1);
    }
    const sourcePath = path.resolve(opts.source);
    const targetPath = path.resolve(opts.target);

    if (!fs.existsSync(sourcePath)) {
      console.error(
        `[merge-items] Error: Source file not found: ${sourcePath}`,
      );
      process.exit(1);
    }
    if (!fs.existsSync(targetPath)) {
      console.error(
        `[merge-items] Error: Target file not found: ${targetPath}`,
      );
      process.exit(1);
    }
    if (sourcePath === targetPath) {
      console.error(
        '[merge-items] Error: Source and target must be different files.',
      );
      process.exit(1);
    }
    if (
      path.extname(sourcePath) !== '.md' ||
      path.extname(targetPath) !== '.md'
    ) {
      console.error(
        '[merge-items] Error: Both files must be markdown (.md) files.',
      );
      process.exit(1);
    }

    const targetDir = path.dirname(targetPath);
    await _mergeFiles(targetPath, sourcePath, targetDir);
    return;
  }

  // Interactive mode
  const rl = createRL({
    command: 'merge-items',
    flags: '--source, --target and --yes',
  });

  console.log('[merge-items] Merge two items in a module\n');

  const { modulePath } = await selectModule(rl);
  const targetDir = await selectTargetDir(rl, modulePath);
  const items = getItems(targetDir);

  if (items.length < 2) {
    rl.close();
    console.log('[merge-items] Need at least two items to merge.');
    return;
  }

  printItems(items);

  const targetStr = await prompt(
    rl,
    'Target item (keeps frontmatter, receives content) (number)',
  );
  const targetPrefix = parseInt(targetStr, 10);
  const targetItem = items.find((i) => i.prefix === targetPrefix);

  if (!targetItem) {
    rl.close();
    console.error(
      `[merge-items] Error: No item found with number ${targetStr}.`,
    );
    process.exit(1);
  }
  if (targetItem.isDirectory || path.extname(targetItem.name) !== '.md') {
    rl.close();
    console.error('[merge-items] Error: Target must be a markdown (.md) file.');
    process.exit(1);
  }

  const sourceStr = await prompt(
    rl,
    'Source item (appended under its title, then deleted) (number)',
  );
  const sourcePrefix = parseInt(sourceStr, 10);
  const sourceItem = items.find((i) => i.prefix === sourcePrefix);

  if (!sourceItem) {
    rl.close();
    console.error(
      `[merge-items] Error: No item found with number ${sourceStr}.`,
    );
    process.exit(1);
  }
  if (sourceItem.isDirectory || path.extname(sourceItem.name) !== '.md') {
    rl.close();
    console.error('[merge-items] Error: Source must be a markdown (.md) file.');
    process.exit(1);
  }
  if (sourcePrefix === targetPrefix) {
    rl.close();
    console.error(
      '[merge-items] Error: Source and target must be different items.',
    );
    process.exit(1);
  }

  const confirm = await prompt(
    rl,
    `Merge ${sourceItem.name} into ${targetItem.name}? (y/N)`,
    'N',
  );
  rl.close();

  if (confirm.toLowerCase() !== 'y') {
    console.log('[merge-items] Cancelled.');
    return;
  }

  const targetPath = path.join(targetDir, targetItem.name);
  const sourcePath = path.join(targetDir, sourceItem.name);

  await _mergeFiles(targetPath, sourcePath, targetDir);
}

module.exports = mergeItems;
module.exports._mergeFiles = _mergeFiles;
