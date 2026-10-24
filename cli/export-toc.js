const fs = require('fs');
const path = require('path');

const log = require('./logger');
const { PROJECT_ROOT } = require('./project-root');
const { COURSE_DIR, resolveModuleSelectors } = require('./module-utils');
const { scanCourse } = require('../lib/convert/course-scanner');
const { generateToc } = require('../lib/export/toc');
const { loadCourseConfig } = require('../lib/config/course-config');

const EXPORTS_DIR = path.join(PROJECT_ROOT, 'exports');

/**
 * Write a TOC file listing course items, for the two-step TOC export flow:
 * generate the file, delete the lines you do not want, then run
 * `npx course export --toc <file>`.
 */
async function exportTocCmd(options = {}) {
  let modules = scanCourse(COURSE_DIR);
  if (options.module) {
    let folders;
    try {
      folders = resolveModuleSelectors(
        options.module,
        modules.map((m) => m.folderName),
      );
    } catch (err) {
      log.error(`[export-toc] ${err.message}`);
      process.exit(1);
    }
    modules = modules.filter((m) => folders.includes(m.folderName));
  }

  const { title, tagline } = loadCourseConfig();
  const body = generateToc(modules, {
    flagged: options.flagged,
    title: options.title || title,
    subtitle: options.subtitle || tagline,
  });

  const output = options.output || path.join(EXPORTS_DIR, 'toc.md');
  // dirname rather than EXPORTS_DIR: -o may point at a folder that does not
  // exist yet, such as a fresh sources/study-packs/.
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, body, 'utf8');

  const rel = path.relative(process.cwd(), output);
  log.info(`[export-toc] Wrote ${rel}`);
  log.info('[export-toc] Delete the lines you do not want, then run:');
  log.info(`[export-toc]   npx course export --toc ${rel}`);
}

module.exports = exportTocCmd;
