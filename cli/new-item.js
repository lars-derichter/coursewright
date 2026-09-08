const fs = require('fs');
const path = require('path');
const { prompt, pad, toSlug, createRL, COURSE_DIR } = require('./module-utils');
const {
  getItems,
  printItems,
  selectModule,
  selectTargetDir,
} = require('./item-utils');
const { renumberUp } = require('./renumber');
const { writeMarkdown } = require('../lib/convert/format-markdown');
const { serializeFrontmatter } = require('../lib/convert/frontmatter');
const { recordRenames } = require('./sync-renames');

const VALID_TYPES = [
  'page',
  'assignment',
  'discussion',
  'url',
  'subsection',
  'file',
];

/** What an assignment is worth when nothing usable says otherwise. */
const DEFAULT_POINTS = 100;

/**
 * How a number of points is written: digits, and then at most one decimal point
 * with digits on both sides of it.
 */
const POINTS = /^\d+(\.\d+)?$/;

/**
 * `typed` with the zeros that carry nothing taken off, so that it can be held
 * against what `String(Number(typed))` prints. Leading zeros go, and so do
 * trailing zeros past the decimal point: neither survives the trip through a
 * number, and neither changes which number was meant.
 *
 * Only ever called on a value `POINTS` has already matched, so there is always
 * at least one digit in front of the point and the stripping cannot leave an
 * empty string behind.
 */
function withoutIdleZeros(typed) {
  const [whole, fraction = ''] = typed.split('.');
  const kept = fraction.replace(/0+$/, '');
  return whole.replace(/^0+(?=\d)/, '') + (kept ? `.${kept}` : '');
}

/**
 * The points a `--points` flag or a typed answer asks for, or null when it asks
 * for nothing a number can be read out of whole.
 *
 * `parseInt` used to be this, and `parseInt` takes a bite out of anything it is
 * handed: `abc` came back NaN, and NaN is not null, so it reached the
 * frontmatter as `points_possible: .nan` and went to Canvas from there. `2.5`
 * came back 2 and `1e3` came back 1. `--points -5` came back minus five, which
 * commander hands through as a value rather than reading as a flag. Every one
 * of those writes a number the author never asked for into a file that reads as
 * deliberate, which is worse than writing the default: a wrong number nobody
 * chose looks exactly like a right one.
 *
 * So the rule is a plain decimal and nothing else, and the caller falls back to
 * `DEFAULT_POINTS` out loud on anything else. A fraction is a real number of
 * points: Canvas takes `points_possible: 2.5`, and `lib/sync/canvas-write.js`
 * sends whatever the frontmatter holds, so refusing one here would be this tool
 * disagreeing with itself over a value it carries perfectly well. Zero is a
 * real number of points for the same reason — that file goes out of its way to
 * send `points_possible: 0` rather than drop it — and how fine a fraction may
 * be is Canvas's business to round in its gradebook rather than this reader's
 * to cut off.
 *
 * What is refused is refused for being a guess about intent, never for being a
 * fraction. A sign, an exponent, a hex literal, a numeric separator, a decimal
 * point with nothing on one side of it: each is either not a number of points
 * at all or not the number it looks like, and the minus is the one that
 * matters, because nothing is worth minus five points.
 *
 * The last line is the guard that used to be `Number.isSafeInteger`, widened to
 * the fractions it now has to cover: what comes back has to print as the digits
 * that went in. That is what stops `9007199254740993` from being written out as
 * ...992, and `0.0000001` from being written out as `1e-7`.
 *
 * Which puts the edge where `String` stops writing a number out in full rather
 * than where the arithmetic stops being exact. A one with twenty zeros after it
 * is accepted and a one with twenty-one is refused, because the second prints
 * as `1e+21`; 2^53 exactly is accepted, although it is past the safe integers,
 * because it prints as itself. That is on purpose. What the guard protects is
 * the file saying what the author typed, and a value that prints as itself does
 * that no matter how large it is — while `1e+21` in the frontmatter is a number
 * nobody wrote there. Nothing in this range is a real number of points either
 * way, so the line is drawn where it can be stated exactly.
 *
 * `validatePoints` in the VS Code extension states this same rule at its input
 * box, and the two are stated twice on purpose: an installed extension has no
 * `node_modules` and no `cli/` to reach into, which is why that file holds a
 * copy of everything it needs. `test/helpers/points-cases.js` is the table both
 * of them are held to, so the copy cannot quietly stop matching this.
 */
function readPoints(value) {
  const typed = String(value ?? '').trim();
  if (!POINTS.test(typed)) return null;
  const points = Number(typed);
  return withoutIdleZeros(typed) === String(points) ? points : null;
}

/**
 * `readPoints`, plus the line that says a value was not used. Shared by the
 * flag and the prompt so the two cannot drift: both fall back to the same
 * number, and neither substitutes it in silence.
 */
function pointsOrDefault(value) {
  const points = readPoints(value);
  if (points !== null) return points;
  console.log(
    `[new-item] "${value}" is not a number of points ` +
      `(0 or more, 2.5 is fine). Using ${DEFAULT_POINTS}.`,
  );
  return DEFAULT_POINTS;
}

/**
 * Say that a `--points` value had nowhere to go, because `createEntry` writes
 * `points_possible` into an assignment and into nothing else.
 *
 * Both paths say it, in one place so they say it the same way. Saying nothing
 * would be the defect this whole guard exists to stop, one step further along:
 * the author asked for something the run did not do, and only the run knows. No
 * number is named, because none was written.
 */
function warnPointsUnused(value, type) {
  console.log(
    `[new-item] --points is for an assignment, so "${value}" was not used ` +
      `on this ${type}.`,
  );
}

function getNextPosition(items) {
  if (items.length === 0) return 1;
  return items[items.length - 1].prefix + 1;
}

/**
 * Prompt for a position until the input is a number between 1 and 99.
 */
async function promptPosition(rl, items) {
  while (true) {
    const positionStr = await prompt(
      rl,
      'Position',
      pad(getNextPosition(items)),
    );
    const position = parseInt(positionStr, 10);
    if (!isNaN(position) && position >= 1 && position <= 99) return position;
    console.log(
      '  Position must be a number between 1 and 99. Please try again.',
    );
  }
}

/**
 * Create the item on disk. Shared by the interactive and flag-driven paths.
 * Returns the created entry name.
 *
 * Async because the markdown goes out through `writeMarkdown`, which formats it
 * first: a file this tool writes must be the file `npm run format` would leave,
 * or the author's very next format run shows up as an edit they did not make.
 */
async function createEntry(
  targetDir,
  type,
  { name, position, url, points, filePath },
) {
  const items = getItems(targetDir);
  if (items.some((i) => i.prefix >= position)) {
    recordRenames([
      { fromDir: targetDir, renames: renumberUp(targetDir, items, position) },
    ]);
  }

  if (type === 'file') {
    const originalName = path.basename(filePath);
    const createdName = `${pad(position)}-${originalName}`;
    fs.copyFileSync(filePath, path.join(targetDir, createdName));
    return createdName;
  }

  if (type === 'subsection') {
    const createdName = `${pad(position)}-${toSlug(name)}`;
    const subPath = path.join(targetDir, createdName);
    fs.mkdirSync(subPath, { recursive: true });
    fs.writeFileSync(
      path.join(subPath, '_category_.json'),
      JSON.stringify({ label: name, position }, null, 2) + '\n',
      'utf8',
    );
    return createdName;
  }

  const frontmatterData = { title: name };
  if (type === 'assignment') {
    frontmatterData.canvas_type = 'assignment';
    frontmatterData.points_possible = points != null ? points : DEFAULT_POINTS;
    frontmatterData.submission_types = ['online_upload'];
  } else if (type === 'url') {
    frontmatterData.canvas_type = 'external_url';
    frontmatterData.external_url = url;
  } else if (type === 'discussion') {
    // A branch of its own rather than a fall-through, because the `else` below
    // writes a page for anything it does not recognise: a type added to
    // VALID_TYPES and left out here scaffolds a page under the name of
    // something else, and says nothing about it. The title is all it writes.
    // `discussion_type`, `require_initial_post` and the two dates are added by
    // hand afterwards, the way a page's own optional fields are.
    frontmatterData.canvas_type = 'discussion';
  } else {
    frontmatterData.canvas_type = 'page';
  }

  const createdName = `${pad(position)}-${toSlug(name)}.md`;
  // The frontmatter, and nothing under it. The title is the page heading in
  // every output: Canvas renders its own page name above the body, Docusaurus
  // synthesises an H1 from the title, and both exporters write it as the
  // per-page heading. A `# ${name}` line here would therefore show the title
  // twice, so deleting it was the first edit an author made in every new file,
  // and `npx course validate` now warns about a body that opens with one.
  //
  // serializeFrontmatter produces valid YAML for a title holding a colon, a
  // quote, an emoji, or anything else a name can be given, and the empty body
  // is the input `renderFrontmatterKey` in lib/convert/frontmatter.js already
  // relies on. What comes back ends in the blank line `matter.stringify` pads a
  // bodyless document with; `writeMarkdown` runs Prettier over it, which takes
  // that padding off again, so the file on disk ends at the closing `---`.
  const content = serializeFrontmatter(frontmatterData, '');
  await writeMarkdown(path.join(targetDir, createdName), content);
  return createdName;
}

async function newItem(options = {}) {
  // Non-interactive mode (VS Code): --module, --type, and --name/--file provided
  if (options.module && options.type) {
    const type = options.type.toLowerCase();
    if (!VALID_TYPES.includes(type)) {
      console.error(
        `[new-item] Error: Invalid type "${type}". Must be one of: ${VALID_TYPES.join(', ')}.`,
      );
      process.exit(1);
    }
    let targetDir = path.join(COURSE_DIR, options.module);
    if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) {
      console.error(`[new-item] Error: Module not found: ${options.module}`);
      process.exit(1);
    }
    if (options.subsection) {
      if (type === 'subsection') {
        console.error(
          '[new-item] Error: Subsections can only be created at module root level.',
        );
        process.exit(1);
      }
      targetDir = path.join(targetDir, options.subsection);
      if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) {
        console.error(
          `[new-item] Error: Subsection not found: ${options.subsection}`,
        );
        process.exit(1);
      }
    }

    let filePath = null;
    if (type === 'file') {
      if (!options.file || !fs.existsSync(options.file)) {
        console.error(
          '[new-item] Error: --file must point to an existing file.',
        );
        process.exit(1);
      }
      filePath = path.resolve(options.file);
    } else if (!options.name) {
      console.error('[new-item] Error: --name is required.');
      process.exit(1);
    }
    if (type === 'url') {
      try {
        new URL(options.url);
      } catch {
        console.error('[new-item] Error: --url must be a valid URL.');
        process.exit(1);
      }
    }

    const items = getItems(targetDir);
    const position = options.position
      ? parseInt(options.position, 10)
      : getNextPosition(items);
    if (isNaN(position) || position < 1 || position > 99) {
      console.error(
        '[new-item] Error: Position must be a number between 1 and 99.',
      );
      process.exit(1);
    }

    // `createEntry` writes `points_possible` into an assignment and into
    // nothing else, so `--points` anywhere else has nowhere to land. Reading it
    // before the type is known drew "Using 100." over a page that was written
    // without any points at all: a line about a fallback that never happened,
    // which is worse than saying nothing.
    if (options.points != null && type !== 'assignment') {
      warnPointsUnused(options.points, type);
    }

    const createdName = await createEntry(targetDir, type, {
      name: options.name,
      position,
      url: options.url,
      points:
        type === 'assignment' && options.points != null
          ? pointsOrDefault(options.points)
          : undefined,
      filePath,
    });
    console.log(
      `\n[new-item] Created ${createdName} in ${path.relative(process.cwd(), targetDir)}/`,
    );
    return;
  }

  const rl = createRL({ command: 'new-item', flags: '--module and --type' });

  console.log('[new-item] Create a new item in a module\n');

  const { modulePath } = await selectModule(rl);
  const targetDir = await selectTargetDir(rl, modulePath);
  const items = getItems(targetDir);
  printItems(items);

  let type;
  while (true) {
    const typeInput = await prompt(rl, `Item type (${VALID_TYPES.join('/')})`);
    type = typeInput.toLowerCase();
    if (!VALID_TYPES.includes(type)) {
      console.log(
        `  Invalid type. Must be one of: ${VALID_TYPES.join(', ')}. Please try again.`,
      );
      continue;
    }
    if (type === 'subsection' && targetDir !== modulePath) {
      console.log(
        '  Subsections can only be created at module root level. Please choose another type.',
      );
      continue;
    }
    break;
  }

  // `--points` on a run that still has questions to answer is an answer to one
  // of them, given early. It only means anything to an assignment, so it is
  // said here rather than left to fall silently off the end of a page.
  if (options.points != null && type !== 'assignment') {
    warnPointsUnused(options.points, type);
  }

  let name = null;
  let url = null;
  let points = null;
  let filePath = null;

  if (type === 'file') {
    while (true) {
      filePath = await prompt(rl, 'Path to file');
      if (filePath && fs.existsSync(filePath)) break;
      console.log('  File not found. Please try again.');
    }
  } else {
    while (true) {
      name = await prompt(
        rl,
        type === 'subsection' ? 'Subsection name' : 'Item name',
      );
      if (name) break;
      console.log('  Name is required. Please try again.');
    }

    if (type === 'assignment') {
      // A `--points` on an otherwise interactive run is offered back as the
      // answer to confirm, rather than ignored the way it used to be or
      // announced with a second message. It goes through the same reader first,
      // so an unusable one falls back to 100 in the same words the flag-driven
      // path uses, and what sits at the prompt is what that path would have
      // written. An answer typed over it wins, which is what a default is for.
      const offered =
        options.points != null
          ? pointsOrDefault(options.points)
          : DEFAULT_POINTS;
      const pointsStr = await prompt(rl, 'Points possible', String(offered));
      points = pointsOrDefault(pointsStr);
    } else if (type === 'url') {
      while (true) {
        url = await prompt(rl, 'URL');
        if (!url) {
          console.log('  URL is required. Please try again.');
          continue;
        }
        try {
          new URL(url);
          break;
        } catch {
          console.log(`  "${url}" is not a valid URL. Please try again.`);
        }
      }
    }
  }

  const position = await promptPosition(rl, items);
  rl.close();

  const createdName = await createEntry(targetDir, type, {
    name,
    position,
    url,
    points,
    filePath,
  });

  console.log(
    `\n[new-item] Created ${createdName} in ${path.relative(process.cwd(), targetDir)}/`,
  );
}

module.exports = newItem;
module.exports._createEntry = createEntry;
module.exports._promptPosition = promptPosition;
module.exports._readPoints = readPoints;
