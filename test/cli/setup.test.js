const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const yaml = require('js-yaml');

const {
  rewriteCourseConfig,
  setScalar,
  setBlockScalar,
  setExportStyle,
  canonicalLicense,
  footerNotice,
  yamlScalar,
  templateFor,
  isPristine,
  bodyOf,
  isToolingReadme,
  isToolingIndex,
  nextSteps,
} = require('../../cli/setup');
const {
  loadCourseConfig,
  _clearCache,
} = require('../../lib/config/course-config');

/** A trimmed stand-in for the shipped course.config.yml. */
const SHIPPED = `# Per-course settings: name, language, look, and label overrides.

# The name of this course.
title: Coursewright

# A one-line descriptor of the course. Optional.
# tagline: Bachelor 1, semester 2

# Colour and site typography.
theme: github

# PDF and DOCX layout.
export:
  style: generic

# Course-facing label language. Built-in sets: en, nl.
language: en

# labels:
#   glossary:
#     title: "📘 Terminology"
`;

describe('yamlScalar', () => {
  it('leaves a plain word unquoted', () => {
    assert.equal(yamlScalar('github'), 'github');
  });

  it('leaves a plain multi-word title unquoted', () => {
    assert.equal(
      yamlScalar('Programming Fundamentals'),
      'Programming Fundamentals',
    );
  });

  it('quotes a value containing a colon', () => {
    assert.equal(yamlScalar('Web: the basics'), '"Web: the basics"');
  });

  it('quotes a value containing a hash', () => {
    assert.equal(yamlScalar('C# for beginners'), '"C# for beginners"');
  });

  it('quotes a value YAML would read as a boolean', () => {
    assert.equal(yamlScalar('no'), '"no"');
  });

  it('quotes the empty string', () => {
    assert.equal(yamlScalar(''), '""');
  });

  it('escapes embedded quotes and backslashes', () => {
    assert.equal(yamlScalar('a "b" \\ c'), '"a \\"b\\" \\\\ c"');
  });
});

describe('setScalar', () => {
  it('replaces a key that is already set', () => {
    const out = setScalar(SHIPPED, 'theme', 'thomas-more');
    assert.match(out, /^theme: thomas-more$/m);
    assert.doesNotMatch(out, /^theme: github$/m);
  });

  it('uncomments a key that ships commented out', () => {
    const out = setScalar(SHIPPED, 'tagline', 'Bachelor 1, semester 2');
    assert.match(out, /^tagline: "Bachelor 1, semester 2"$/m);
    assert.doesNotMatch(out, /^# tagline:/m);
  });

  it('appends a key that is absent entirely', () => {
    const out = setScalar('title: X\n', 'language', 'nl');
    assert.match(out, /^language: nl$/m);
  });

  it('never touches an indented key inside the commented labels block', () => {
    const out = setScalar(SHIPPED, 'title', 'Programming Fundamentals');
    assert.match(out, /^# {5}title: "📘 Terminology"$/m);
    assert.match(out, /^title: Programming Fundamentals$/m);
  });

  it('never touches a nested key in an active labels block', () => {
    const source =
      'labels:\n  glossary:\n    title: Terminology\n\ntitle: Old Name\n';
    const out = setScalar(source, 'title', 'New Name');
    assert.match(out, /^ {4}title: Terminology$/m);
    assert.match(out, /^title: New Name$/m);
    assert.doesNotMatch(out, /Old Name/);
  });

  it('appends the key when only a nested key of that name is set', () => {
    const source = 'labels:\n  glossary:\n    title: Terminology\n';
    const out = setScalar(source, 'title', 'New Name');
    assert.match(out, /^ {4}title: Terminology$/m);
    assert.match(out, /^title: New Name$/m);
  });

  it('keeps every comment in the file', () => {
    const comments = (text) =>
      text.split('\n').filter((l) => l.startsWith('#'));
    const out = setScalar(SHIPPED, 'title', 'New Name');
    assert.deepEqual(comments(out), comments(SHIPPED));
  });

  it('is idempotent', () => {
    const once = setScalar(SHIPPED, 'language', 'nl');
    assert.equal(setScalar(once, 'language', 'nl'), once);
  });
});

describe('setExportStyle', () => {
  it('replaces style inside the export block', () => {
    const out = setExportStyle(SHIPPED, 'thomas-more');
    assert.match(out, /^export:\n {2}style: thomas-more$/m);
  });

  it('adds the block when export is absent', () => {
    const out = setExportStyle('title: X\n', 'generic');
    assert.match(out, /^export:\n {2}style: generic$/m);
  });

  it('adds style when the export block is empty', () => {
    const out = setExportStyle('export:\n\nlanguage: en\n', 'generic');
    assert.match(out, /^export:\n {2}style: generic$/m);
    assert.match(out, /^language: en$/m);
  });

  it('is idempotent', () => {
    const once = setExportStyle(SHIPPED, 'thomas-more');
    assert.equal(setExportStyle(once, 'thomas-more'), once);
  });
});

/** The footer block as course.config.yml ships it, with the commented labels
 *  that share its key names below. */
const WITH_FOOTER = `title: Coursewright

# PDF and DOCX layout.
export:
  style: generic
  # number_headings: true

# The footer under every page of the course website.
footer:
  # One line of markdown: links, a badge image, {year} for the current year.
  # Unset, it reads "Copyright © {year}"; an empty string shows no notice.
  # text: "© {year} Your Name, Your Institution"
  # A Creative Commons licence button. One of CC-BY-4.0, ..., or none.
  license: CC-BY-NC-SA-4.0
  # The "Made with Coursewright" link. false hides it.
  # credit: false

language: en

# labels:
#   site:
#     credit: "Built with {coursewright}"
#     license: "Shared under {license}"
`;

const NOTICE = '© {year} Jane Doe, [Example: University](https://example.edu)';

describe('setBlockScalar', () => {
  const comments = (text) =>
    text.split('\n').filter((l) => /^\s*#/.test(l) && !/# text:/.test(l));

  it('replaces a key the block already sets', () => {
    const out = setBlockScalar(WITH_FOOTER, 'footer', 'license', 'CC-BY-4.0');
    assert.match(out, /^ {2}license: CC-BY-4\.0$/m);
    assert.doesNotMatch(out, /CC-BY-NC-SA-4\.0$/m);
  });

  it('uncomments a key the block ships commented out', () => {
    const out = setBlockScalar(WITH_FOOTER, 'footer', 'text', 'Hi');
    assert.match(
      out,
      /^ {2}# Unset, it reads[^\n]*\n {2}text: Hi\n {2}# A Creative/m,
    );
    assert.doesNotMatch(out, /# text:/);
  });

  it('never touches a commented key outside the block', () => {
    const source = WITH_FOOTER.replace('  license: CC-BY-NC-SA-4.0\n', '');
    const out = setBlockScalar(source, 'footer', 'license', 'CC0-1.0');
    assert.match(out, /^footer:\n {2}license: CC0-1\.0$/m);
    assert.match(out, /^# {5}license: "Shared under \{license\}"$/m);
    assert.equal(yaml.load(out).labels, undefined);
  });

  it('keeps every other comment in the file', () => {
    const out = setBlockScalar(WITH_FOOTER, 'footer', 'text', NOTICE);
    assert.deepEqual(comments(out), comments(WITH_FOOTER));
  });

  it('adds the key as the first entry when the block lacks it', () => {
    const out = setBlockScalar(
      'footer:\n  credit: false\n',
      'footer',
      'text',
      'Hi',
    );
    assert.equal(out, 'footer:\n  text: Hi\n  credit: false\n');
  });

  it('creates the block when it is missing', () => {
    const out = setBlockScalar('title: X\n', 'footer', 'license', 'CC0-1.0');
    assert.equal(out, 'title: X\n\nfooter:\n  license: CC0-1.0\n');
  });

  it('leaves a same-named key in another block alone', () => {
    const source = 'export:\n  style: generic\n\nfooter:\n  license: none\n';
    const out = setBlockScalar(source, 'export', 'license', 'x');
    assert.match(out, /^export:\n {2}license: x\n {2}style: generic$/m);
    assert.match(out, /^footer:\n {2}license: none$/m);
  });

  it('is idempotent', () => {
    const once = setBlockScalar(WITH_FOOTER, 'footer', 'text', NOTICE);
    assert.equal(setBlockScalar(once, 'footer', 'text', NOTICE), once);
  });
});

describe('canonicalLicense', () => {
  it('spells a licence the way LICENSES does, ignoring case', () => {
    assert.equal(canonicalLicense('cc-by-4.0'), 'CC-BY-4.0');
    assert.equal(canonicalLicense(' cc0-1.0 '), 'CC0-1.0');
  });

  it('accepts none in any case', () => {
    assert.equal(canonicalLicense('None'), 'none');
  });

  it('rejects anything else', () => {
    assert.equal(canonicalLicense('MIT'), null);
  });
});

describe('footerNotice', () => {
  it('reads none as no notice', () => {
    assert.equal(footerNotice('NONE'), '');
  });

  it('passes a notice through, trimmed', () => {
    assert.equal(footerNotice('  © {year} Me '), '© {year} Me');
  });
});

describe('rewriteCourseConfig', () => {
  it('applies every answered value in one pass', () => {
    const out = rewriteCourseConfig(SHIPPED, {
      language: 'nl',
      title: 'Programmeren 1',
      tagline: 'Bachelor 1, semester 2',
      theme: 'thomas-more',
      exportStyle: 'thomas-more',
    });
    assert.match(out, /^language: nl$/m);
    assert.match(out, /^title: Programmeren 1$/m);
    assert.match(out, /^tagline: "Bachelor 1, semester 2"$/m);
    assert.match(out, /^theme: thomas-more$/m);
    assert.match(out, /^export:\n {2}style: thomas-more$/m);
  });

  it('leaves the commented labels block intact', () => {
    const out = rewriteCourseConfig(SHIPPED, { title: 'X', language: 'nl' });
    assert.match(out, /^# labels:$/m);
    assert.match(out, /^# {3}glossary:$/m);
    assert.match(out, /^# {5}title: "📘 Terminology"$/m);
  });

  it('touches nothing when no values are given', () => {
    assert.equal(rewriteCourseConfig(SHIPPED, {}), SHIPPED);
  });

  it('leaves the tagline commented when it is not answered', () => {
    const out = rewriteCourseConfig(SHIPPED, { title: 'X' });
    assert.match(out, /^# tagline: Bachelor 1, semester 2$/m);
  });

  it('writes the footer notice and licence, quoted so YAML reads them back', () => {
    const out = rewriteCourseConfig(WITH_FOOTER, {
      title: 'Programmeren 1',
      footerText: NOTICE,
      footerLicense: 'CC-BY-4.0',
    });
    const data = yaml.load(out);
    assert.equal(data.footer.text, NOTICE);
    assert.equal(data.footer.license, 'CC-BY-4.0');
    assert.equal(data.footer.credit, undefined);
    assert.equal(data.labels, undefined);
    assert.match(out, /^title: Programmeren 1$/m);
    assert.match(out, /^# {5}license: "Shared under \{license\}"$/m);
  });

  it('writes an empty notice as an empty string', () => {
    const out = rewriteCourseConfig(WITH_FOOTER, { footerText: '' });
    assert.match(out, /^ {2}text: ""$/m);
    assert.equal(yaml.load(out).footer.text, '');
  });

  it('resolves the written footer through loadCourseConfig', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-footer-test-'));
    try {
      const out = rewriteCourseConfig(WITH_FOOTER, {
        footerText: NOTICE,
        footerLicense: 'none',
      });
      fs.writeFileSync(path.join(dir, 'course.config.yml'), out, 'utf8');
      _clearCache();
      const { footer } = loadCourseConfig(dir);
      assert.deepEqual(
        { ...footer },
        {
          text: NOTICE,
          license: null,
          credit: true,
        },
      );
    } finally {
      _clearCache();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('templateFor', () => {
  it('names the README template for a language', () => {
    assert.equal(templateFor('readme', 'nl'), 'README-course-nl.md');
  });

  it('names the course-context template for a language', () => {
    assert.equal(templateFor('course-context', 'en'), 'course-context-en.md');
  });

  it('names the writing-style template for a variant', () => {
    assert.equal(
      templateFor('writing-style', 'nl-be'),
      'writing-style-nl-be.md',
    );
  });

  it('throws on an unknown kind', () => {
    assert.throws(() => templateFor('nope', 'en'), /Unknown template kind/);
  });
});

describe('bodyOf', () => {
  it('drops the leading tip block', () => {
    const doc = '# Title\n\n> [!TIP]\n>\n> Copy me.\n\n## First\n\nBody.\n';
    assert.equal(bodyOf(doc), '## First\n\nBody.\n');
  });

  it('passes through a document with no headings', () => {
    assert.equal(bodyOf('Just prose.\n'), 'Just prose.\n');
  });

  it('passes null through', () => {
    assert.equal(bodyOf(null), null);
  });
});

describe('isPristine', () => {
  const shipped = ['# One\n', '# Two\n'];

  it('treats a missing file as pristine', () => {
    assert.equal(isPristine(null, shipped), true);
  });

  it('recognises an untouched copy of a template', () => {
    assert.equal(isPristine('# Two\n', shipped), true);
  });

  it('ignores trailing whitespace and line endings', () => {
    assert.equal(isPristine('# Two\r\n\n', shipped), true);
  });

  it('refuses a file the author has edited', () => {
    assert.equal(isPristine('# Two\n\nMy own words.\n', shipped), false);
  });

  it('ignores where a relative link points', () => {
    assert.equal(
      isPristine('See [the guide](../templates/a.md).', [
        'See [the guide](a.md).',
      ]),
      true,
    );
  });

  it('ignores the folder in a backticked path', () => {
    assert.equal(isPristine('Copy `templates/a.md`.', ['Copy `a.md`.']), true);
  });

  it('ignores where prose happens to be wrapped', () => {
    assert.equal(isPristine('one two\nthree', ['one\ntwo three']), true);
  });

  it('still notices a changed external URL', () => {
    assert.equal(
      isPristine('[x](https://a.example/one)', ['[x](https://a.example/two)']),
      false,
    );
  });
});

describe('isToolingIndex', () => {
  it('recognises the shipped landing page by its frontmatter title', () => {
    const page = [
      '---',
      'slug: /',
      'title: Write Your Course in Markdown, Publish It Anywhere',
      'sidebar_label: Coursewright',
      '---',
      '',
      'Course material tends to live wherever it was last edited.',
      '',
      '## The Problem It Solves',
      '',
      'An LMS editor is fine for a page or two.',
      '',
    ].join('\n');
    assert.equal(isToolingIndex(page), true);
  });

  it('recognises the pre-1.2 landing page by its H1', () => {
    const page = [
      '---',
      'slug: /',
      'title: Coursewright',
      '---',
      '',
      '# Write Your Course in Markdown, Publish It Anywhere',
      '',
      'Course material tends to live wherever it was last edited.',
      '',
    ].join('\n');
    assert.equal(isToolingIndex(page), true);
  });

  it('rejects a course home page', () => {
    assert.equal(isToolingIndex('# Welcome\n\nUse the sidebar.\n'), false);
  });

  it('rejects a course home whose frontmatter title is its own', () => {
    const page = [
      '---',
      'slug: /',
      'title: Welcome',
      'sidebar_position: 0',
      '---',
      '',
      'Use the sidebar to work through the modules.',
      '',
      '## How This Course Works',
      '',
    ].join('\n');
    assert.equal(isToolingIndex(page), false);
  });

  it('falls back to the H1 when the frontmatter will not parse', () => {
    const page = [
      '---',
      'title: [unclosed',
      '  slug: /',
      '---',
      '',
      '# Write Your Course in Markdown, Publish It Anywhere',
      '',
    ].join('\n');
    assert.equal(isToolingIndex(page), true);
  });

  it('does not throw on a malformed frontmatter block', () => {
    const page = '---\ntitle: [unclosed\n---\n\nUse the sidebar.\n';
    assert.equal(isToolingIndex(page), false);
  });

  it('treats a missing course home as replaceable', () => {
    assert.equal(isToolingIndex(null), true);
  });
});

describe('isToolingReadme', () => {
  it('recognises the tooling README by its H1', () => {
    assert.equal(
      isToolingReadme('# Coursewright\n\nWrite your course...\n'),
      true,
    );
  });

  it('recognises the pre-rename tooling README', () => {
    assert.equal(
      isToolingReadme('# Canvas Course Builder\n\nWrite your course...\n'),
      true,
    );
  });

  it('rejects a course README', () => {
    assert.equal(isToolingReadme('# Programmeren 1\n\nMateriaal.\n'), false);
  });

  it('treats a missing README as replaceable', () => {
    assert.equal(isToolingReadme(null), true);
  });
});

describe('nextSteps', () => {
  it('points at init when Canvas is not connected', () => {
    const steps = nextSteps({ canvasConnected: false });
    assert.ok(steps.some((s) => s.includes('npx course init')));
    assert.ok(!steps.some((s) => s.includes('npx course push')));
  });

  it('points at push once Canvas is connected', () => {
    const steps = nextSteps({ canvasConnected: true });
    assert.ok(steps.some((s) => s.includes('npx course push')));
  });

  it('offers a first module only when the tutorial module is gone', () => {
    assert.ok(
      nextSteps({ removedTutorial: true }).some((s) =>
        s.includes('new-module'),
      ),
    );
    assert.ok(
      !nextSteps({ removedTutorial: false }).some((s) =>
        s.includes('new-module'),
      ),
    );
  });

  it('always offers the course context', () => {
    assert.ok(nextSteps().some((s) => s.includes('/course-context-init')));
  });
});
