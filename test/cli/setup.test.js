const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  rewriteCourseConfig,
  setScalar,
  setExportStyle,
  yamlScalar,
  templateFor,
  isPristine,
  bodyOf,
  isToolingReadme,
  isToolingIndex,
  nextSteps,
} = require('../../cli/setup');

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
