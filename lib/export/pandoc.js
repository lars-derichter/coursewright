const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * Font directories Microsoft Office ships, per platform.
 *
 * On macOS, Office keeps its typefaces inside the application bundles instead
 * of installing them system-wide, so Typst never sees them: a Mac with Word
 * has Century Gothic, but `typst fonts` does not list it. On Windows, Office
 * installs into C:\Windows\Fonts, which Typst already scans, so there is
 * nothing to add there.
 */
const OFFICE_FONT_DIRS = {
  darwin: [
    '/Applications/Microsoft Word.app/Contents/Resources/DFonts',
    '/Applications/Microsoft PowerPoint.app/Contents/Resources/DFonts',
    '/Library/Fonts/Microsoft',
  ],
};

/**
 * Build the list of directories Typst should search for fonts, most specific
 * first: the style's own `fonts/`, then Office's, then whatever the user
 * already had in TYPST_FONT_PATHS.
 *
 * Which family actually wins is decided by the fallback chain in the style's
 * template.typ, so this order only breaks ties between identically named
 * families.
 *
 * @param {string|null} [fontsDir] - The selected style's fonts directory.
 * @param {object} [opts]
 * @param {string} [opts.platform] - Defaults to process.platform.
 * @param {(p: string) => boolean} [opts.exists] - Defaults to fs.existsSync.
 * @param {string} [opts.existing] - Defaults to process.env.TYPST_FONT_PATHS.
 * @returns {string[]} Directories, in search order. May be empty.
 */
function typstFontPaths(fontsDir, opts = {}) {
  const {
    platform = process.platform,
    exists = fs.existsSync,
    existing = process.env.TYPST_FONT_PATHS,
  } = opts;

  const dirs = [];
  if (fontsDir) dirs.push(fontsDir);
  for (const dir of OFFICE_FONT_DIRS[platform] || []) {
    if (exists(dir)) dirs.push(dir);
  }
  if (existing) dirs.push(...existing.split(path.delimiter).filter(Boolean));

  return dirs;
}

/**
 * Build the pandoc argument list for one export run.
 *
 * @param {object} opts
 * @param {string} opts.input - Path to the combined markdown file.
 * @param {string} opts.output - Path to the output PDF/DOCX.
 * @param {string} opts.format - 'pdf' or 'docx'.
 * @param {string} opts.filter - Path to the Lua filter.
 * @param {string} [opts.defaultsFile] - Path to a pandoc defaults YAML file.
 * @param {string} [opts.template] - Path to the Typst template (PDF only).
 * @param {string} [opts.referenceDoc] - Path to reference.docx (DOCX only).
 * @param {string} [opts.resourcePath] - Directory pandoc resolves assets from.
 * @param {object} [opts.variables] - Extra `-V key=value` pandoc variables.
 * @param {boolean} [opts.toc] - Whether to emit a table of contents.
 * @param {boolean} [opts.numberSections] - Number the headings. Pandoc numbers
 *   DOCX headings itself and hands Typst a `section-numbering` pattern that
 *   template.typ turns into heading numbering, so one flag serves both.
 * @param {string} [opts.logo] - Absolute path to the cover logo (PDF only).
 * @returns {string[]} Argument vector for pandoc.
 */
function buildPandocArgs(opts) {
  const {
    input,
    output,
    format,
    filter,
    defaultsFile,
    template,
    referenceDoc,
    resourcePath,
    variables = {},
    toc,
    numberSections,
    logo,
  } = opts;

  const args = ['-f', 'markdown', input, '-o', output, '--standalone'];

  if (defaultsFile) args.push('--defaults', defaultsFile);
  if (filter) args.push('--lua-filter', filter);
  if (toc) args.push('--toc');
  // After --defaults: the command line wins over `number-sections: false` there.
  if (numberSections) args.push('--number-sections');

  if (format === 'pdf') {
    args.push('--pdf-engine', 'typst');
    if (template) args.push('--template', template);
    if (logo) {
      // Pandoc compiles the generated .typ from a temp dir; Typst rejects
      // absolute paths outside its project root, so widen the root to /.
      args.push('-V', `logo=${logo}`);
      args.push('--pdf-engine-opt=--root=/');
    }
  } else if (format === 'docx') {
    if (referenceDoc) args.push('--reference-doc', referenceDoc);
  }

  if (resourcePath) args.push('--resource-path', resourcePath);

  for (const [key, value] of Object.entries(variables)) {
    args.push('-V', `${key}=${value}`);
  }

  return args;
}

/**
 * Run pandoc, inheriting stderr so its diagnostics reach the user. Rejects
 * with a readable error on non-zero exit.
 *
 * @param {object} opts - Same shape as buildPandocArgs.
 * @returns {Promise<void>}
 */
function runPandoc(opts) {
  const args = buildPandocArgs(opts);
  const env = { ...process.env };
  if (opts.format === 'pdf') {
    // Let Typst find the fonts shipped with the style, plus the ones Office
    // hides inside its application bundles on macOS.
    const fontPaths = typstFontPaths(opts.fontsDir);
    if (fontPaths.length) env.TYPST_FONT_PATHS = fontPaths.join(path.delimiter);
  }
  return new Promise((resolve, reject) => {
    const child = spawn('pandoc', args, {
      stdio: ['ignore', 'inherit', 'inherit'],
      env,
    });
    child.on('error', (err) => {
      reject(new Error(`Failed to start pandoc: ${err.message}`));
    });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`pandoc exited with code ${code}.`));
    });
  });
}

module.exports = { buildPandocArgs, runPandoc, typstFontPaths };
