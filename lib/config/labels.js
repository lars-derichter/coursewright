/**
 * Built-in label sets for all course-facing strings, per language.
 *
 * This module is pure data plus lookup helpers — no I/O. Consumers that need
 * a hard default (converters, remark plugins, glossary builder) import the
 * `en` constants from here directly; only code that should respect
 * course.config.yml goes through lib/config/course-config.js.
 */

const DEFAULT_LANGUAGE = 'en';

const LABEL_SETS = {
  en: {
    alerts: {
      note: 'Note',
      tip: 'Tip',
      important: 'Important',
      warning: 'Warning',
      caution: 'Caution',
      check: 'Check',
    },
    cards: {
      external_url: 'External link',
      file: 'File',
      quiz: 'Quiz',
      external_tool: 'External tool',
    },
    reference: {
      notice:
        'This item is managed in Canvas. Open it there to view or edit it. ' +
        'These course files only record where it appears in the module.',
      open: 'Open in Canvas',
    },
    export: {
      attachment: 'Attachment:',
      online: 'Online:',
      course_title: 'Course',
      selection_title: 'Selection',
    },
    pull: {
      untitled: 'Untitled',
    },
    glossary: {
      title: '📘 Glossary',
      intro:
        'This is the glossary as it stands after lesson {lesson}. It grows as ' +
        'the course progresses: each module shows the full list up to that ' +
        'point, in alphabetical order.',
      operators: 'Operators',
      terms: 'Terms',
    },
    site: {
      credit: 'Made with {coursewright}',
      license: 'Licensed under {license}',
    },
  },
  nl: {
    alerts: {
      note: 'Info',
      tip: 'Tip',
      important: 'Belangrijk',
      warning: 'Waarschuwing',
      caution: 'Opgelet',
      check: 'Check',
    },
    cards: {
      external_url: 'Externe link',
      file: 'Bestand',
      quiz: 'Quiz',
      external_tool: 'Externe tool',
    },
    reference: {
      notice:
        'Dit item wordt beheerd in Canvas. Open het daar om het te bekijken ' +
        'of te bewerken. Deze cursusbestanden houden alleen bij waar het in ' +
        'de module staat.',
      open: 'Openen in Canvas',
    },
    export: {
      attachment: 'Bijlage:',
      online: 'Online:',
      course_title: 'Cursus',
      selection_title: 'Selectie',
    },
    pull: {
      untitled: 'Zonder titel',
    },
    glossary: {
      title: '📘 Woordenlijst',
      intro:
        'Dit is de woordenlijst zoals ze er na les {lesson} uitziet. Ze ' +
        'groeit mee met de cursus: elke module toont de volledige lijst tot ' +
        'dat punt, in alfabetische volgorde.',
      operators: 'Operatoren',
      terms: 'Termen',
    },
    site: {
      credit: 'Gemaakt met {coursewright}',
      license: 'Gepubliceerd onder {license}',
    },
  },
};

function deepFreeze(obj) {
  for (const value of Object.values(obj)) {
    if (value && typeof value === 'object') deepFreeze(value);
  }
  return Object.freeze(obj);
}

deepFreeze(LABEL_SETS);

/**
 * Resolve the full labels object for a language, with optional per-label
 * overrides merged on top. Unknown languages fall back to the default set;
 * unknown override groups/keys and non-string values are silently ignored
 * (course-config.js reports them via validateOverrides before calling this).
 *
 * @param {string} [language] - Built-in set key ('en', 'nl').
 * @param {object} [overrides] - Partial { group: { key: string } } overrides.
 * @returns {object} A fresh, mutable copy — never the shared set itself.
 */
function getLabels(language, overrides) {
  const set = LABEL_SETS[language] || LABEL_SETS[DEFAULT_LANGUAGE];
  const labels = {};
  for (const [group, entries] of Object.entries(set)) {
    labels[group] = { ...entries };
    const groupOverrides = overrides && overrides[group];
    if (!groupOverrides || typeof groupOverrides !== 'object') continue;
    for (const [key, value] of Object.entries(groupOverrides)) {
      if (key in entries && typeof value === 'string') {
        labels[group][key] = value;
      }
    }
  }
  return labels;
}

/**
 * Report override entries that getLabels would ignore: unknown groups,
 * unknown keys within a group, and non-string values.
 *
 * @param {object} [overrides]
 * @returns {string[]} Human-readable problem descriptions ('group.key' paths).
 */
function validateOverrides(overrides) {
  const problems = [];
  if (!overrides) return problems;
  if (typeof overrides !== 'object' || Array.isArray(overrides)) {
    return ['labels must be a mapping of groups to label overrides'];
  }
  const shape = LABEL_SETS[DEFAULT_LANGUAGE];
  for (const [group, entries] of Object.entries(overrides)) {
    if (!(group in shape)) {
      problems.push(`unknown label group "${group}"`);
      continue;
    }
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) {
      problems.push(`label group "${group}" must be a mapping`);
      continue;
    }
    for (const [key, value] of Object.entries(entries)) {
      if (!(key in shape[group])) {
        problems.push(`unknown label "${group}.${key}"`);
      } else if (typeof value !== 'string') {
        problems.push(`label "${group}.${key}" must be a string`);
      }
    }
  }
  return problems;
}

/**
 * Derive a filename-safe slug from a (possibly accented) label.
 * 'Cursus' -> 'cursus', 'Résumé du cours' -> 'resume-du-cours'.
 */
function slugify(label) {
  return String(label)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

module.exports = {
  DEFAULT_LANGUAGE,
  LABEL_SETS,
  getLabels,
  validateOverrides,
  slugify,
};
