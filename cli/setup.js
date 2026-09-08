/**
 * `npx course setup` — the first-run wizard for a new course.
 *
 * Asks its questions in dependency order: the course language comes first,
 * because it picks which README, course-context and writing-style template the
 * later questions copy. Writes course.config.yml, installs the language-matched
 * templates, and offers the two clean-ups a fresh course needs — removing the
 * built-in tutorial module, and connecting Canvas.
 *
 * `npx course init` keeps its own job, the Canvas credentials, and this command
 * offers to run it at the end.
 *
 * course.config.yml is edited line by line rather than through js-yaml: a
 * load/dump round trip would drop every comment in the file, including the
 * commented-out `labels:` override block that documents the whole surface.
 */

const fs = require('fs');
const path = require('path');

const { PROJECT_ROOT } = require('./project-root');
const { prompt, createRL } = require('./module-utils');
const log = require('./logger');
const {
  loadCourseConfig,
  _clearCache,
} = require('../lib/config/course-config');
const { parseFrontmatter } = require('../lib/convert/frontmatter');

const CONFIG_FILE = path.join(PROJECT_ROOT, 'course.config.yml');
const TEMPLATES_DIR = path.join(PROJECT_ROOT, 'templates');
const THEMES_DIR = path.join(PROJECT_ROOT, 'src', 'css', 'themes');
const EXPORT_STYLES_DIR = path.join(PROJECT_ROOT, 'export-styles');
const README_FILE = path.join(PROJECT_ROOT, 'README.md');
const WRITING_STYLE_FILE = path.join(
  PROJECT_ROOT,
  'context',
  'writing-style.md',
);
const COURSE_CONTEXT_FILE = path.join(
  PROJECT_ROOT,
  'context',
  'course-context.md',
);
const COURSE_INDEX_FILE = path.join(PROJECT_ROOT, 'course', 'index.md');
const TUTORIAL_MODULE = path.join(PROJECT_ROOT, 'course', '01-getting-started');

/**
 * How the shipped `course/index.md` names itself. Upstream that file is the
 * project's own landing page, since this repo publishes its `course/` to GitHub
 * Pages, so a course that still carries it is publishing a pitch for the tooling
 * to its students and setup should offer to replace it.
 *
 * Two forms carry that name. Since the page body lost its `# Title`, the name is
 * the frontmatter `title`; before that it was the body's H1. Both stay
 * recognised because `course/` is a protected directory in
 * `update-from-upstream.sh`: a course project that pulls this CLI keeps the
 * `course/index.md` it already had, so the older file is exactly the one that
 * still needs the offer.
 */
const TOOLING_INDEX_TITLE = 'Write Your Course in Markdown';

/** Where the tutorial module stays readable after a course deletes its copy. */
const TUTORIAL_UPSTREAM_URL =
  'https://github.com/lars-derichter/coursewright/tree/main/course/01-getting-started';

/** The live copy of that module: the upstream project's own site. */
const TUTORIAL_SITE_URL = 'https://coursewright.md/';

/** Label-set languages, from lib/config/labels.js. */
const LANGUAGES = [
  { id: 'en', label: 'English' },
  { id: 'nl', label: 'Nederlands' },
];

/** The writing-style baselines in templates/, and what each one prescribes. */
const WRITING_STYLES = [
  { id: 'en', label: 'English, UK spelling' },
  { id: 'en-us', label: 'English, US spelling' },
  { id: 'nl-be', label: 'Nederlands, Vlaamse variant' },
  { id: 'nl', label: 'Nederlands, variant Nederland' },
];

/** The H1 of the tooling's own README, which a course replaces. The old
 * project name stays recognised so a clone from before the rename still
 * gets the replacement offer after pulling the update. */
const TOOLING_README_TITLES = ['Coursewright', 'Canvas Course Builder'];

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests)
// ---------------------------------------------------------------------------

/**
 * Quote a scalar when plain YAML would misread it — a colon, a hash, a leading
 * or trailing space, or a word YAML reads as a boolean or null.
 */
function yamlScalar(value) {
  const s = String(value);
  const plain =
    s !== '' &&
    /^[A-Za-z0-9][A-Za-z0-9 ._/-]*$/.test(s) &&
    !/\s$/.test(s) &&
    !/^(y|n|yes|no|true|false|on|off|null)$/i.test(s);
  if (plain) return s;
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Set a top-level scalar key, keeping the file's comments and layout.
 *
 * Replaces the key where it is already set, uncomments it where it ships
 * commented out (`# tagline: ...`), and appends it otherwise. The commented
 * form deliberately only matches a top-level `# key:` with at most one space,
 * so it never picks up an indented key inside the commented `labels:` block.
 */
function setScalar(source, key, value) {
  const rendered = `${key}: ${yamlScalar(value)}`;

  const active = new RegExp(`^([ \\t]*)${key}:[^\\n]*$`, 'm');
  if (active.test(source)) {
    return source.replace(active, (_match, indent) => `${indent}${rendered}`);
  }

  const commented = new RegExp(`^#[ \\t]?${key}:[^\\n]*$`, 'm');
  if (commented.test(source)) {
    return source.replace(commented, rendered);
  }

  return `${source.replace(/\n*$/, '')}\n\n${rendered}\n`;
}

/**
 * Set `style:` inside the `export:` block, creating either as needed.
 */
function setExportStyle(source, value) {
  const rendered = `style: ${yamlScalar(value)}`;
  const lines = source.split('\n');
  const start = lines.findIndex((line) => /^export:[ \t]*$/.test(line));

  if (start === -1) {
    return `${source.replace(/\n*$/, '')}\n\nexport:\n  ${rendered}\n`;
  }

  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\s*$/.test(line)) break; // a blank line ends the block
    if (/^\s*#/.test(line)) continue;
    if (!/^[ \t]+/.test(line)) break; // back to column 0: block ended
    const match = line.match(/^([ \t]+)style:[^\n]*$/);
    if (match) {
      lines[i] = `${match[1]}${rendered}`;
      return lines.join('\n');
    }
  }

  lines.splice(start + 1, 0, `  ${rendered}`);
  return lines.join('\n');
}

/**
 * Apply the answered values to course.config.yml's contents. Keys left
 * undefined are not touched.
 */
function rewriteCourseConfig(source, values = {}) {
  let out = source;
  if (values.language !== undefined)
    out = setScalar(out, 'language', values.language);
  if (values.title !== undefined) out = setScalar(out, 'title', values.title);
  if (values.tagline !== undefined)
    out = setScalar(out, 'tagline', values.tagline);
  if (values.theme !== undefined) out = setScalar(out, 'theme', values.theme);
  if (values.exportStyle !== undefined)
    out = setExportStyle(out, values.exportStyle);
  return out;
}

/**
 * The template filename for a destination, given the chosen language (or, for
 * the writing style guide, the chosen baseline variant).
 */
function templateFor(kind, variant) {
  switch (kind) {
    case 'readme':
      return `README-course-${variant}.md`;
    case 'course-context':
      return `course-context-${variant}.md`;
    case 'course-index':
      return `course-index-${variant}.md`;
    case 'writing-style':
      return `writing-style-${variant}.md`;
    default:
      throw new Error(`Unknown template kind: ${kind}`);
  }
}

/**
 * The part of a shipped document below its leading tip block: everything from
 * the first `## ` heading onwards. A template in templates/ differs from its
 * installed counterpart only in that tip — the template's says "copy me over
 * X and delete this tip" — so comparing bodies is what separates a file the
 * author has filled in from one still holding shipped content.
 */
function bodyOf(text) {
  if (text == null) return null;
  const index = text.search(/^## /m);
  return index === -1 ? text : text.slice(index);
}

/**
 * True when a destination still holds shipped content and can be overwritten
 * without losing anything: it is absent, or matches one of the templates it
 * could have been copied from.
 */
function isPristine(destContent, shippedContents) {
  if (destContent == null) return true;
  const dest = normaliseForCompare(destContent);
  return shippedContents.some(
    (shipped) => normaliseForCompare(shipped) === dest,
  );
}

/**
 * Reduce a document to a comparable word stream.
 *
 * A template and its installed copy live in different folders, so every
 * relative path between them differs — in link targets and in the backticked
 * paths naming them — and Prettier then rewraps the surrounding prose at a
 * different point. None of that is the author's work, so paths collapse to
 * their basename and runs of whitespace to one space. External URLs and
 * in-page anchors are left alone.
 */
function normaliseForCompare(text) {
  return text
    .replace(/\]\(([^)\s]+)\)/g, (match, target) =>
      /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#')
        ? match
        : `](${target.split('/').pop()})`,
    )
    .replace(
      /`([^`\s]*\/[^`\s]*)`/g,
      (_match, p) => `\`${p.split('/').pop()}\``,
    )
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * True when README.md is still the tooling's own README rather than a course's.
 */
function isToolingReadme(content) {
  if (content == null) return true;
  const heading = content.match(/^#\s+(.+)$/m);
  return Boolean(heading) && TOOLING_README_TITLES.includes(heading[1].trim());
}

/**
 * True when course/index.md is still the tooling's own landing page rather than
 * a course home.
 *
 * The frontmatter title answers it for the current file, the body's H1 for the
 * copy an older course project still has. A frontmatter block YAML cannot read
 * is not an answer either way, so it falls through to the heading rather than
 * throwing: the caller only wants to know whether it may overwrite the file.
 */
function isToolingIndex(content) {
  if (content == null) return true;
  try {
    const { data } = parseFrontmatter(content);
    if (
      typeof data.title === 'string' &&
      data.title.trim().startsWith(TOOLING_INDEX_TITLE)
    ) {
      return true;
    }
  } catch {
    // Unparseable frontmatter: the H1 below is all there is to go on.
  }
  const heading = content.match(/^#\s+(.+)$/m);
  return Boolean(heading) && heading[1].trim().startsWith(TOOLING_INDEX_TITLE);
}

/**
 * The closing "what's next" list, in the order a new course needs them.
 */
function nextSteps({ canvasConnected = false, removedTutorial = false } = {}) {
  const steps = ['npm start — preview the site and check the look'];
  if (removedTutorial) {
    steps.push('npx course new-module — create your first module');
  }
  steps.push(
    '/course-context-init — fill in the course design context (AI assistants)',
  );
  steps.push(
    canvasConnected
      ? 'npx course push — publish to Canvas'
      : 'npx course init — connect Canvas when you are ready',
  );
  return steps;
}

// ---------------------------------------------------------------------------
// Prompting
// ---------------------------------------------------------------------------

async function confirm(rl, question, defaultYes) {
  const hint = defaultYes ? '[Y/n]' : '[y/N]';
  const answer = (await prompt(rl, `${question} ${hint}`)).toLowerCase();
  if (!answer) return defaultYes;
  return answer === 'y' || answer === 'yes';
}

async function choose(rl, question, choices, defaultValue) {
  log.info(`\n${question}`);
  for (const [index, choice] of choices.entries()) {
    const label = choice.label ? ` — ${choice.label}` : '';
    const current = choice.id === defaultValue ? '  (current)' : '';
    log.info(`  ${index + 1}) ${choice.id}${label}${current}`);
  }
  for (;;) {
    const answer = await prompt(rl, 'Choice', defaultValue);
    const byNumber = choices[Number(answer) - 1];
    if (byNumber) return byNumber.id;
    if (choices.some((choice) => choice.id === answer)) return answer;
    log.warn(`  "${answer}" is not one of the choices.`);
  }
}

/**
 * Ask a choice question, unless there is nothing to choose from — a missing
 * themes or export-styles directory is not worth an unanswerable prompt.
 */
async function chooseOrKeep(rl, question, choices, currentValue) {
  if (choices.length === 0) return currentValue;
  return choose(rl, question, choices, currentValue);
}

// ---------------------------------------------------------------------------
// Filesystem helpers
// ---------------------------------------------------------------------------

function readIfPresent(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function listNames(dir, { directories = false } = {}) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) =>
        directories ? entry.isDirectory() : entry.name.endsWith('.css'),
      )
      .map((entry) => entry.name.replace(/\.css$/, ''))
      .sort();
  } catch {
    return [];
  }
}

/** Read every template that a destination could legitimately already hold. */
function shippedVariants(kind, variants) {
  return variants
    .map((variant) =>
      readIfPresent(path.join(TEMPLATES_DIR, templateFor(kind, variant))),
    )
    .filter((content) => content != null);
}

/**
 * Copy a template over its destination, unless that would overwrite the
 * author's own work without saying so. Returns true when the file was written.
 */
async function installTemplate(rl, options) {
  const { template, dest, label, pristine, interactive } = options;
  const src = path.join(TEMPLATES_DIR, template);
  const rel = path.relative(PROJECT_ROOT, dest);

  if (!fs.existsSync(src)) {
    log.warn(`[setup] Template ${template} is missing — left ${rel} alone.`);
    return false;
  }

  if (!pristine) {
    if (!interactive) {
      log.warn(`[setup] ${rel} has your own edits — left it alone.`);
      return false;
    }
    const overwrite = await confirm(
      rl,
      `${rel} has your own edits. Replace it with the ${label} template?`,
      false,
    );
    if (!overwrite) return false;
  }

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  log.info(`[setup] Wrote ${rel}`);
  return true;
}

// ---------------------------------------------------------------------------
// The command
// ---------------------------------------------------------------------------

/**
 * Turn a `copy`/`keep` flag into a boolean, leaving it undefined when the flag
 * was not passed so the caller falls back to asking.
 */
function wantsCopy(value, kind) {
  if (value === undefined) return undefined;
  if (value === 'copy') return true;
  if (value === 'keep') return false;
  log.error(`[setup] Error: --${kind} takes "copy" or "keep", not "${value}".`);
  process.exit(1);
}

async function setup(options = {}) {
  const interactive = !options.yes && Boolean(process.stdin.isTTY);
  const rl = interactive ? createRL() : null;

  const source = readIfPresent(CONFIG_FILE);
  if (source == null) {
    log.error(`[setup] Error: ${CONFIG_FILE} is missing.`);
    process.exit(1);
  }

  const wantReadmeFlag = wantsCopy(options.readme, 'readme');
  const wantIndexFlag = wantsCopy(options.courseHome, 'course-home');
  const wantContextFlag = wantsCopy(options.courseContext, 'course-context');
  const styleFlag =
    options.writingStyle === 'keep' ? null : options.writingStyle;
  let removeTutorialFlag;
  if (options.tutorial !== undefined) {
    if (options.tutorial !== 'remove' && options.tutorial !== 'keep') {
      log.error(
        `[setup] Error: --tutorial takes "keep" or "remove", not "${options.tutorial}".`,
      );
      process.exit(1);
    }
    removeTutorialFlag = options.tutorial === 'remove';
  }

  const current = loadCourseConfig();

  log.info('[setup] Course setup');
  log.info(
    '[setup] Sets up course.config.yml, your README, the course context and the\n' +
      '[setup] writing style guide. Run it again any time to change an answer.\n',
  );

  try {
    // 1. Language — asked first: it picks the templates for questions 4 to 6.
    const language = interactive
      ? await choose(
          rl,
          'Language of the course, for every generated student-facing label:',
          LANGUAGES,
          options.language || current.language,
        )
      : options.language || current.language;

    // 2. Course name.
    const title = interactive
      ? await prompt(rl, '\nCourse name', options.title || current.title)
      : options.title || current.title;

    // 3. Tagline — optional, so an empty answer stays empty.
    const tagline = interactive
      ? await prompt(
          rl,
          'One-line descriptor (programme, year, semester; optional)',
          options.tagline || current.tagline,
        )
      : options.tagline !== undefined
        ? options.tagline
        : current.tagline;

    // 4. The course README.
    const readmeContent = readIfPresent(README_FILE);
    const readmePristine =
      isToolingReadme(readmeContent) ||
      isPristine(readmeContent, shippedVariants('readme', ['en', 'nl']));
    const wantReadme =
      wantReadmeFlag !== undefined
        ? wantReadmeFlag
        : interactive
          ? await confirm(
              rl,
              `\nReplace README.md with the ${language} course README template?`,
              readmePristine,
            )
          : false;
    if (wantReadme) {
      await installTemplate(rl, {
        template: templateFor('readme', language),
        dest: README_FILE,
        label: 'course README',
        pristine: readmePristine,
        interactive,
      });
    }

    // 4b. The course home page. Upstream this file sells the tooling, because
    //     this repo publishes its own course/ as the project site. A real
    //     course wants a course home there instead.
    const indexContent = readIfPresent(COURSE_INDEX_FILE);
    const indexPristine =
      isToolingIndex(indexContent) ||
      isPristine(indexContent, shippedVariants('course-index', ['en', 'nl']));
    const wantIndex =
      wantIndexFlag !== undefined
        ? wantIndexFlag
        : interactive
          ? await confirm(
              rl,
              `\nReplace the course home page (course/index.md) with the ${language} template?`,
              indexPristine,
            )
          : false;
    if (wantIndex) {
      await installTemplate(rl, {
        template: templateFor('course-index', language),
        dest: COURSE_INDEX_FILE,
        label: 'course home',
        pristine: indexPristine,
        interactive,
      });
    }

    // 5. The course context — what the course is, for the lesson skills and for
    //    anyone who needs the reasoning behind it.
    const contextContent = readIfPresent(COURSE_CONTEXT_FILE);
    const contextPristine = isPristine(
      bodyOf(contextContent),
      shippedVariants('course-context', ['en', 'nl']).map(bodyOf),
    );
    const wantContext =
      wantContextFlag !== undefined
        ? wantContextFlag
        : interactive
          ? await confirm(
              rl,
              `\nInstall the ${language} course-context template?`,
              contextPristine,
            )
          : false;
    if (wantContext) {
      await installTemplate(rl, {
        template: templateFor('course-context', language),
        dest: COURSE_CONTEXT_FILE,
        label: 'course context',
        pristine: contextPristine,
        interactive,
      });
    }

    // 6. The writing style guide.
    const styleContent = readIfPresent(WRITING_STYLE_FILE);
    const stylePristine = isPristine(
      bodyOf(styleContent),
      shippedVariants(
        'writing-style',
        WRITING_STYLES.map((style) => style.id),
      ).map(bodyOf),
    );
    let writingStyle = styleFlag;
    if (writingStyle === undefined && interactive) {
      const wantStyle = await confirm(
        rl,
        '\nInstall a writing style guide baseline?',
        stylePristine,
      );
      writingStyle = wantStyle
        ? await choose(
            rl,
            'Which baseline? Each one is a complete guide, written in the language it prescribes:',
            WRITING_STYLES,
            language,
          )
        : null;
    }
    if (writingStyle) {
      await installTemplate(rl, {
        template: templateFor('writing-style', writingStyle),
        dest: WRITING_STYLE_FILE,
        label: 'writing style',
        pristine: stylePristine,
        interactive,
      });
    }

    // 7. Colour theme.
    const themes = listNames(THEMES_DIR).map((id) => ({ id }));
    const theme = interactive
      ? await chooseOrKeep(
          rl,
          'Colour theme — the preview site, Canvas pages and PDF exports all read it:',
          themes,
          options.theme || current.theme,
        )
      : options.theme || current.theme;

    // 8. Export style.
    const styles = listNames(EXPORT_STYLES_DIR, { directories: true }).map(
      (id) => ({ id }),
    );
    const exportStyle = interactive
      ? await chooseOrKeep(
          rl,
          'Export style — PDF and DOCX typography, margins and cover:',
          styles,
          options.exportStyle || current.export.style,
        )
      : options.exportStyle || current.export.style;

    // Write the configuration. An empty tagline is only written out when there
    // is an existing one to clear, so a course without one keeps the key
    // commented out as it ships.
    const writeTagline = Boolean(tagline) || Boolean(current.tagline);
    const updated = rewriteCourseConfig(source, {
      language,
      title,
      tagline: writeTagline ? tagline : undefined,
      theme,
      exportStyle,
    });
    if (updated !== source) {
      fs.writeFileSync(CONFIG_FILE, updated, 'utf8');
      log.info(`\n[setup] Wrote ${path.relative(PROJECT_ROOT, CONFIG_FILE)}`);
    } else {
      log.info('\n[setup] course.config.yml already matched your answers.');
    }

    // Read it back, so a bad value surfaces here rather than at build time.
    _clearCache();
    const resolved = loadCourseConfig();
    log.info(
      `[setup]   title: ${resolved.title} | language: ${resolved.language} | ` +
        `theme: ${resolved.theme} | export style: ${resolved.export.style}`,
    );

    // 9. The built-in tutorial module.
    let removedTutorial = false;
    const tutorialPresent = fs.existsSync(TUTORIAL_MODULE);
    if (tutorialPresent) {
      let removeTutorial = removeTutorialFlag;
      if (removeTutorial === undefined && interactive) {
        log.info(
          '\n[setup] course/01-getting-started/ is the built-in tutorial module: a' +
            '\n[setup] friendly walkthrough of the project, and a worked example of every' +
            '\n[setup] content type a course can create on its own. It is part of your' +
            '\n[setup] course folder, so `npx course push` would publish it to your' +
            '\n[setup] students. Deleting it locally costs nothing: it stays readable at' +
            `\n[setup]   ${TUTORIAL_SITE_URL}` +
            '\n[setup] and in the upstream repository at' +
            `\n[setup]   ${TUTORIAL_UPSTREAM_URL}`,
        );
        removeTutorial = await confirm(
          rl,
          'Remove the tutorial module from your course?',
          false,
        );
      }
      if (removeTutorial) {
        fs.rmSync(TUTORIAL_MODULE, { recursive: true, force: true });
        log.info('[setup] Removed course/01-getting-started/');
        removedTutorial = true;
      }
    }

    // 10. Canvas credentials — only interactively, since `init` prompts.
    let canvasConnected = false;
    if (interactive && options.canvas !== false) {
      const wantCanvas = await confirm(
        rl,
        '\nConnect Canvas now? You need the API URL, an access token and the course ID.',
        false,
      );
      if (wantCanvas) {
        if (rl) rl.close();
        await require('./init')();
        canvasConnected = true;
      }
    }

    log.info('\n[setup] Done. Next:');
    for (const step of nextSteps({ canvasConnected, removedTutorial })) {
      log.info(`  ${step}`);
    }
  } finally {
    if (rl) rl.close();
  }
}

module.exports = setup;
module.exports.rewriteCourseConfig = rewriteCourseConfig;
module.exports.setScalar = setScalar;
module.exports.setExportStyle = setExportStyle;
module.exports.yamlScalar = yamlScalar;
module.exports.templateFor = templateFor;
module.exports.isPristine = isPristine;
module.exports.bodyOf = bodyOf;
module.exports.isToolingReadme = isToolingReadme;
module.exports.isToolingIndex = isToolingIndex;
module.exports.nextSteps = nextSteps;
