#!/usr/bin/env node
'use strict';

/**
 * Check, diff and splice study packs: the compact pack a course ships against
 * the raw export it was condensed from. A recipe is the pack's TOC file in
 * sources/study-packs/. Its frontmatter names the compact pack (`compact:`, a
 * path from the repository root) and the page-title prefixes whose sections
 * stay verbatim (`verbatim:`, a flow list), and the raw export lives next to
 * it at raw/<recipe basename>.md.
 *
 *   node .agents/skills/study-pack-build/scripts/pack-tool.js changed <recipe> <old-raw>
 *   node .agents/skills/study-pack-build/scripts/pack-tool.js check <recipe> [--section "<H1 title>"]
 *   node .agents/skills/study-pack-build/scripts/pack-tool.js section <file> "<H1 title>"
 *   node .agents/skills/study-pack-build/scripts/pack-tool.js splice <recipe> <section.md>
 *
 * changed lists the H1 sections of the raw export that differ from an older
 * copy of it, so a re-run condenses only those. check proves the compact pack
 * keeps the raw's structure: the header, every H1 and H2 in order, every
 * fenced code block, the verbatim sections, and no leftover markup; it exits 1
 * on any failure. section prints one H1 section of a file. splice puts a
 * condensed section into the compact pack at the raw's position and refreshes
 * the header from the raw. Node built-ins only: the skill folder has no
 * node_modules.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');

/** Markup the markdown export never emits, so its presence means a hand slipped. */
const LEFTOVERS = [
  [':::', 'fenced div'],
  ['{#', 'heading attribute'],
  ['<!--', 'HTML comment'],
];
/** A link the export would have unlinked: anything but an absolute URL. */
const LOCAL_LINK = /\]\((?!https?:\/\/|\/\/|mailto:)[^)\s]+\)/;
const DATE_LINE = /^\d{4}-\d{2}-\d{2}$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
/** Inline-code spans worth a warning when they vanish: a name, not a number. */
const TERM = /`([^`\n]+)`/g;

// --- Recipe -----------------------------------------------------------------

function unquote(s) {
  const q = /^(["'])([\s\S]*)\1$/.exec(s);
  if (!q) return s;
  return q[1] === '"' ? q[2].replace(/\\"/g, '"') : q[2].replace(/''/g, "'");
}

/** A YAML subset: a quoted or bare scalar, or a flow list of them. */
function parseScalar(raw) {
  const s = raw.trim();
  if (s.startsWith('[') && s.endsWith(']')) {
    const items = [];
    const re = /"((?:[^"\\]|\\.)*)"|'((?:[^']|'')*)'|([^,\s][^,]*)/g;
    let m;
    while ((m = re.exec(s.slice(1, -1)))) {
      items.push(
        m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3].trim(),
      );
    }
    return items;
  }
  return unquote(s);
}

/** Strip U+FE0F so an emoji matches with or without its variation selector. */
function stripVs(s) {
  return s.replace(/️/g, '');
}

function readRecipe(file) {
  const text = fs.readFileSync(file, 'utf8');
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!fm) throw new Error(`${file}: no frontmatter block.`);
  const data = {};
  for (const line of fm[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (kv) data[kv[1]] = parseScalar(kv[2]);
  }
  if (typeof data.compact !== 'string' || !data.compact) {
    throw new Error(
      `${file}: the frontmatter needs "compact: <path of the condensed pack>".`,
    );
  }
  const name = path.basename(file).replace(/(\.toc)?\.md$/, '');
  return {
    file,
    name,
    compact: path.resolve(ROOT, data.compact),
    raw: path.resolve(path.dirname(file), 'raw', `${name}.md`),
    verbatim: (Array.isArray(data.verbatim) ? data.verbatim : []).map(stripVs),
  };
}

// --- Markdown structure -----------------------------------------------------

function readLines(file) {
  return fs.readFileSync(file, 'utf8').split(/\r?\n/);
}

/**
 * One pass over the fences: which lines sit inside one, and every block's
 * body. A block's key trims the outer whitespace and blank lines, so a moved
 * block still matches, and keeps the inner indentation.
 */
function scanFences(lines) {
  const inFence = new Array(lines.length).fill(false);
  const blocks = [];
  let open = null;
  let buf = [];
  let start = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = FENCE.exec(lines[i]);
    if (open) {
      inFence[i] = true;
      const closes =
        m &&
        m[1][0] === open[0] &&
        m[1].length >= open.length &&
        lines[i].trim() === m[1];
      if (closes) {
        const body = buf.join('\n').trim();
        blocks.push({ line: start + 1, first: body.split('\n')[0], key: body });
        open = null;
        buf = [];
      } else {
        buf.push(lines[i]);
      }
    } else if (m) {
      inFence[i] = true;
      open = m[1];
      start = i;
    }
  }
  return { inFence, blocks };
}

/** Split on headings of exactly `level`, outside fences. The first entry is
 *  whatever precedes the first heading, with a null title. */
function splitSections(lines, level) {
  const { inFence } = scanFences(lines);
  const re = new RegExp(`^#{${level}} +(.*\\S)\\s*$`);
  const starts = [{ title: null, start: 0 }];
  for (let i = 0; i < lines.length; i++) {
    if (inFence[i]) continue;
    const m = re.exec(lines[i]);
    if (m) starts.push({ title: m[1], start: i });
  }
  return starts.map((s, i) => {
    const end = i + 1 < starts.length ? starts[i + 1].start : lines.length;
    return {
      title: s.title,
      start: s.start,
      end,
      lines: lines.slice(s.start, end),
    };
  });
}

/** A pack: the first H1 section is the header (title, subtitle, date), the
 *  rest are the modules. Anything before the first H1 counts as the header. */
function parsePack(lines) {
  const parts = splitSections(lines, 1);
  const preamble = parts[0].lines.some((l) => l.trim());
  const sections = preamble ? parts : parts.slice(1);
  if (sections.length === 0) return { header: null, sections: [] };
  return { header: sections[0], sections: sections.slice(1) };
}

function normalise(lines) {
  return lines.join(' ').replace(/\s+/g, ' ').trim();
}

function hashSection(section, { dropDate = false } = {}) {
  const lines = dropDate
    ? section.lines.filter((l) => !DATE_LINE.test(l.trim()))
    : section.lines;
  return crypto.createHash('sha1').update(lines.join('\n')).digest('hex');
}

function bytes(lines) {
  return Buffer.byteLength(lines.join('\n'), 'utf8');
}

function sameTitle(a, b) {
  return stripVs(a).trim() === stripVs(b).trim();
}

/** Pair sections by title, first unpaired match wins, so a duplicate title
 *  pairs in order and a renamed one shows up as missing plus extra. */
function pairSections(left, right) {
  const taken = new Set();
  const pairs = [];
  for (const l of left) {
    const idx = right.findIndex(
      (r, i) => !taken.has(i) && sameTitle(r.title, l.title),
    );
    if (idx >= 0) taken.add(idx);
    pairs.push({
      left: l,
      right: idx >= 0 ? right[idx] : null,
      rightIndex: idx,
    });
  }
  const extra = right.filter((_, i) => !taken.has(i));
  return { pairs, extra };
}

// --- changed ----------------------------------------------------------------

function changed(recipe, oldRawFile) {
  const fresh = parsePack(readLines(recipe.raw));
  const old = fs.existsSync(oldRawFile)
    ? parsePack(readLines(oldRawFile))
    : { header: null, sections: [] };
  const entries = [];
  const { pairs, extra } = pairSections(fresh.sections, old.sections);
  let lastOld = -1;
  for (const { left, right, rightIndex } of pairs) {
    if (!right) {
      entries.push({ status: 'added', title: left.title });
      continue;
    }
    const same = hashSection(left) === hashSection(right);
    const moved = rightIndex < lastOld;
    lastOld = Math.max(lastOld, rightIndex);
    if (!same) entries.push({ status: 'changed', title: left.title });
    else if (moved) entries.push({ status: 'moved', title: left.title });
  }
  for (const s of extra) entries.push({ status: 'removed', title: s.title });

  let header = 'unchanged';
  if (!old.header) header = 'new';
  else if (!fresh.header) header = 'changed';
  else if (hashSection(fresh.header) !== hashSection(old.header)) {
    header =
      hashSection(fresh.header, { dropDate: true }) ===
      hashSection(old.header, { dropDate: true })
        ? 'date only'
        : 'changed';
  }
  const count = entries.filter((e) => e.status !== 'moved').length;
  return { entries, header, changed: count, total: fresh.sections.length };
}

// --- check ------------------------------------------------------------------

function stripInlineCode(line) {
  return line.replace(/`[^`]*`/g, '');
}

function isVerbatim(title, prefixes) {
  const t = stripVs(title).trim();
  return prefixes.some((p) => t.startsWith(p));
}

function firstDifference(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const from = Math.max(0, i - 20);
  return `near "${a.slice(from, i + 30)}"`;
}

function terms(lines, inFence) {
  const found = new Set();
  lines.forEach((line, i) => {
    if (inFence[i]) return;
    let m;
    while ((m = TERM.exec(line))) {
      const t = m[1].trim();
      if (t.length >= 2 && /[A-Za-z]/.test(t)) found.add(t);
    }
  });
  return found;
}

function checkSection(rawSec, compactSec, recipe, out) {
  const where = `in "${rawSec.title}"`;
  const rawH2 = splitSections(rawSec.lines, 2);
  const comH2 = splitSections(compactSec.lines, 2);
  const { pairs, extra } = pairSections(rawH2.slice(1), comH2.slice(1));
  let lastIdx = -1;
  let outOfOrder = false;
  for (const { left, right, rightIndex } of pairs) {
    if (!right) {
      out.fail('heading', 'missing', `H2 "${left.title}" ${where}`);
      continue;
    }
    if (rightIndex < lastIdx) outOfOrder = true;
    lastIdx = Math.max(lastIdx, rightIndex);
    if (isVerbatim(left.title, recipe.verbatim)) {
      const a = normalise(left.lines);
      const b = normalise(right.lines);
      if (a !== b) {
        out.fail(
          'verbatim',
          'differs',
          `"${left.title}" ${where}, ${firstDifference(a, b)}`,
        );
      }
    }
  }
  for (const s of extra)
    out.fail('heading', 'extra', `H2 "${s.title}" ${where}`);
  if (outOfOrder)
    out.fail('heading', 'order', `H2 sequence ${where} differs from the raw`);

  const rawScan = scanFences(rawSec.lines);
  const comScan = scanFences(compactSec.lines);
  const counts = new Map();
  for (const b of rawScan.blocks)
    counts.set(b.key, (counts.get(b.key) || 0) + 1);
  for (const b of comScan.blocks) {
    const n = counts.get(b.key) || 0;
    if (n === 0) out.fail('code', 'extra', `${where}: ${b.first}`);
    else counts.set(b.key, n - 1);
  }
  for (const b of rawScan.blocks) {
    const n = counts.get(b.key);
    if (n > 0) {
      out.fail('code', 'missing', `${where}: ${b.first}`);
      counts.set(b.key, n - 1);
    }
  }

  const compactText = compactSec.lines.join('\n');
  for (const t of terms(rawSec.lines, rawScan.inFence)) {
    if (!compactText.includes(t))
      out.warn('term', 'dropped', `${where}: \`${t}\``);
  }

  const rb = bytes(rawSec.lines);
  const cb = bytes(compactSec.lines);
  out.info(
    'section',
    'ratio',
    `${(cb / rb).toFixed(2)}  ${rb} -> ${cb}  ${rawSec.title}`,
  );
}

function check(recipe, { section: only = null } = {}) {
  const out = {
    lines: [],
    failures: 0,
    warnings: 0,
    fail(tag, status, msg) {
      this.failures++;
      this.lines.push({ tag, status, msg });
    },
    warn(tag, status, msg) {
      this.warnings++;
      this.lines.push({ tag, status, msg });
    },
    info(tag, status, msg) {
      this.lines.push({ tag, status, msg });
    },
  };
  if (!fs.existsSync(recipe.raw))
    throw new Error(`Raw export missing: ${recipe.raw}`);
  if (!fs.existsSync(recipe.compact)) {
    out.fail('compact', 'missing', recipe.compact);
    return out;
  }
  const rawLines = readLines(recipe.raw);
  const comLines = readLines(recipe.compact);
  const raw = parsePack(rawLines);
  const com = parsePack(comLines);

  if (!only) {
    const a = raw.header ? normalise(raw.header.lines) : '';
    const b = com.header ? normalise(com.header.lines) : '';
    if (a !== b) out.fail('header', 'differs', firstDifference(a, b));
  }

  let rawSections = raw.sections;
  if (only) {
    rawSections = raw.sections.filter((s) => sameTitle(s.title, only));
    if (rawSections.length === 0) {
      throw new Error(`No H1 section "${only}" in ${recipe.raw}.`);
    }
  }
  const { pairs, extra } = pairSections(rawSections, com.sections);
  let lastIdx = -1;
  let outOfOrder = false;
  for (const { left, right, rightIndex } of pairs) {
    if (!right) {
      out.fail('heading', 'missing', `H1 "${left.title}"`);
      continue;
    }
    if (rightIndex < lastIdx) outOfOrder = true;
    lastIdx = Math.max(lastIdx, rightIndex);
    checkSection(left, right, recipe, out);
  }
  if (!only) {
    for (const s of extra) out.fail('heading', 'extra', `H1 "${s.title}"`);
    if (outOfOrder)
      out.fail('heading', 'order', 'H1 sequence differs from the raw');
  }

  const { inFence } = scanFences(comLines);
  comLines.forEach((line, i) => {
    if (inFence[i]) return;
    const text = stripInlineCode(line);
    for (const [needle, what] of LEFTOVERS) {
      if (text.includes(needle))
        out.fail('leftover', `line ${i + 1}`, `${what} "${needle}"`);
    }
    if (text.includes(ROOT))
      out.fail('leftover', `line ${i + 1}`, 'absolute repository path');
    const link = LOCAL_LINK.exec(text);
    if (link) out.fail('leftover', `line ${i + 1}`, `local link ${link[0]}`);
  });

  out.rawBytes = bytes(rawLines);
  out.compactBytes = bytes(comLines);
  return out;
}

// --- section and splice -----------------------------------------------------

function findSection(file, title) {
  const pack = parsePack(readLines(file));
  const all = pack.header ? [pack.header, ...pack.sections] : pack.sections;
  const hit = all.find((s) => sameTitle(s.title, title));
  if (!hit) {
    const titles = all.map((s) => `  ${s.title}`).join('\n');
    throw new Error(
      `No H1 section "${title}" in ${file}. Sections:\n${titles}`,
    );
  }
  return hit;
}

function section(file, title) {
  return findSection(file, title).lines.join('\n').replace(/\s+$/, '') + '\n';
}

function block(lines) {
  return lines.join('\n').replace(/\s+$/, '') + '\n\n';
}

function splice(recipe, sectionFile) {
  const piece = readLines(sectionFile);
  const first = piece.find((l) => l.trim());
  const m = first && /^# +(.*\S)\s*$/.exec(first);
  if (!m)
    throw new Error(`${sectionFile}: the first line must be the section's H1.`);
  const title = m[1];
  const raw = parsePack(readLines(recipe.raw));
  const rawIndex = raw.sections.findIndex((s) => sameTitle(s.title, title));
  if (rawIndex < 0)
    throw new Error(`No H1 section "${title}" in ${recipe.raw}.`);

  const com = fs.existsSync(recipe.compact)
    ? parsePack(readLines(recipe.compact))
    : { header: null, sections: [] };
  const sections = com.sections.slice();
  const existing = sections.findIndex((s) => sameTitle(s.title, title));
  const entry = { title, lines: piece };
  let action;
  if (existing >= 0) {
    sections[existing] = entry;
    action = 'replaced';
  } else {
    // Insert after the nearest preceding raw section the compact already has.
    let at = 0;
    for (let i = rawIndex - 1; i >= 0; i--) {
      const j = sections.findIndex((s) =>
        sameTitle(s.title, raw.sections[i].title),
      );
      if (j >= 0) {
        at = j + 1;
        break;
      }
    }
    sections.splice(at, 0, entry);
    action = 'inserted';
  }
  const text =
    block(raw.header ? raw.header.lines : []) +
    sections.map((s) => block(s.lines)).join('');
  fs.mkdirSync(path.dirname(recipe.compact), { recursive: true });
  fs.writeFileSync(recipe.compact, text.replace(/\n+$/, '\n'));
  return { action, title };
}

/** Remove one H1 section from the compact pack (a raw section that went). */
function drop(recipe, title) {
  const com = parsePack(readLines(recipe.compact));
  const sections = com.sections.filter((s) => !sameTitle(s.title, title));
  if (sections.length === com.sections.length) {
    throw new Error(`No H1 section "${title}" in ${recipe.compact}.`);
  }
  const text =
    block(com.header ? com.header.lines : []) +
    sections.map((s) => block(s.lines)).join('');
  fs.writeFileSync(recipe.compact, text.replace(/\n+$/, '\n'));
  return { action: 'dropped', title };
}

// --- CLI --------------------------------------------------------------------

const USAGE = [
  'Usage:',
  '  pack-tool.js changed <recipe> <old-raw>',
  '  pack-tool.js check <recipe> [--section "<H1 title>"]',
  '  pack-tool.js section <file> "<H1 title>"',
  '  pack-tool.js splice <recipe> <section.md>',
  '  pack-tool.js drop <recipe> "<H1 title>"',
].join('\n');

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const positional = [];
  const opts = {};
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--section') {
      opts.section = rest[++i];
      if (!opts.section)
        throw new Error(`--section needs an H1 title.\n${USAGE}`);
    } else if (rest[i].startsWith('--')) {
      throw new Error(`Unrecognised option "${rest[i]}".\n${USAGE}`);
    } else {
      positional.push(rest[i]);
    }
  }
  const arity = { changed: 2, check: 1, section: 2, splice: 2, drop: 2 };
  if (!(command in arity))
    throw new Error(`Unrecognised command "${command || ''}".\n${USAGE}`);
  if (positional.length !== arity[command]) {
    throw new Error(
      `${command} takes ${arity[command]} argument(s).\n${USAGE}`,
    );
  }
  return { command, positional, opts };
}

function report(tag, status, message) {
  console.log(`${tag.padEnd(9)} ${status.padEnd(8)} ${message}`);
}

function main() {
  const { command, positional, opts } = parseArgs(process.argv.slice(2));
  if (command === 'section') {
    process.stdout.write(section(positional[0], positional[1]));
    return;
  }
  if (command === 'splice') {
    const r = splice(readRecipe(positional[0]), positional[1]);
    report('splice', r.action, `"${r.title}"`);
    return;
  }
  if (command === 'drop') {
    const r = drop(readRecipe(positional[0]), positional[1]);
    report('drop', r.action, `"${r.title}"`);
    return;
  }
  if (command === 'changed') {
    const r = changed(readRecipe(positional[0]), positional[1]);
    for (const e of r.entries) report('section', e.status, e.title);
    const headerNote = {
      new: 'no previous raw export',
      'date only': 'only the date line moved',
      changed: 'title or subtitle changed',
    };
    if (r.header !== 'unchanged')
      report('header', r.header, headerNote[r.header]);
    console.log(`\n${r.changed} of ${r.total} sections changed.`);
    return;
  }
  const r = check(readRecipe(positional[0]), opts);
  for (const l of r.lines) report(l.tag, l.status, l.msg);
  if (r.rawBytes) {
    const ratio = (r.compactBytes / r.rawBytes).toFixed(2);
    console.log(
      `raw ${r.rawBytes} B, compact ${r.compactBytes} B, ratio ${ratio}`,
    );
  }
  console.log(`\n${r.failures} failures, ${r.warnings} warnings.`);
  process.exitCode = r.failures ? 1 : 0;
}

module.exports = {
  readRecipe,
  splitSections,
  parsePack,
  scanFences,
  changed,
  check,
  section,
  splice,
  drop,
};

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  }
}
