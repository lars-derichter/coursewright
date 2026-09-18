# AI Assistants

This project is set up for AI coding assistants that run in your terminal or
inside VS Code, such as Claude Code and OpenAI Codex. They can read your project
files, run commands, and make changes, all guided by natural language.

An [AGENTS.md](../AGENTS.md) file at the project root gives any assistant full
context about the project structure, available commands, and conventions, so it
can help effectively out of the box. [CLAUDE.md](../CLAUDE.md) is a one-line
import of the same file, because Claude Code reads that name.

The lesson and evaluation skills sit on a didactic backbone: backward design and
constructive alignment, read from your own `course-context.md`.
[Didactic foundations](didactics.md) explains those ideas and how far they
reach; the [lesson workflow](lesson-workflow.md) shows the skills chaining along
them.

## Supported Tools

- **[Claude Code](https://claude.ai/code)** reads `AGENTS.md` through
  `CLAUDE.md`, discovers the skills through the `.claude/skills` alias, and
  invokes them as `/name`.
- **[OpenAI Codex](https://developers.openai.com/codex)** reads `AGENTS.md` and
  discovers the skills in `.agents/skills/` natively.
- **Other tools**: point them at `AGENTS.md`. The skills are plain markdown, so
  you can paste a skill's instructions into any assistant that lacks skill
  support.

On Windows, skills need one git setting before they are found; see
[Troubleshooting](troubleshooting.md#skills-not-found-on-windows).

## Use Cases for Course Authors

- **Setting up a new course**: `/course-setup` walks the whole first-run
  configuration with you and writes the parts a command cannot.
- **Writing course content**: describe what a page or assignment should cover
  and let the assistant draft the markdown.
- **Creating modules and items**: ask the assistant to run the CLI commands for
  you, passing names and positions as flags. An assistant runs them on a pipe,
  where an unanswered prompt stops the command with an error instead of waiting;
  `npx course <command> --help` names the flags each one needs.
- **Restructuring courses**: move, rename, merge, or split items across modules
  in bulk.
- **Generating markdown from notes**: paste rough notes and have them turned
  into polished course pages.
- **Debugging a failing output**: describe the problem, whether it is a sync
  report, a site build failing on a broken link, or an export in the wrong font,
  and let the assistant inspect the sync state, the build log, and the configs.
- **Reviewing content**: check for broken links, missing frontmatter, or
  inconsistencies across modules.
- **Exporting to PDF or Word**: turn pages, modules, or the whole course into
  printable documents, with a style derived from your own reference.

## The Writing Style Guide

Your AI assistant follows the conventions in
[writing-style.md](../context/writing-style.md) when drafting course content:
language, register, tone, structure, formatting, and patterns to avoid. The
shipped `writing-style.md` is the English baseline, usable as it stands; run
`/writing-style-init` early to adapt it to your own voice and audience, or copy
one of the ready baselines in `templates/` (US English, Flemish Dutch,
Netherlands Dutch) over it and skip the interview (see
[Customisation](customisation.md#the-writing-style-guide)).

You can also edit `writing-style.md` by hand at any time. Treat it as a living
document: the more it reflects your real preferences, the less you'll need to
correct the assistant's output. The skills that maintain and apply it,
`/writing-style-init`, `/writing-style-update`, `/proofread` and `/translate`,
are in [the catalogue below](#writing-style).

## Course Context

Where `writing-style.md` captures _how you write_,
[course-context.md](../context/course-context.md) captures _what your course
is_: subject, learning goals, assessment, pedagogy, lesson-plan conventions,
module structure, code and download rules, glossary, and scope boundaries. Its
sections run in backward-design order (what students should be able to do, how
you will know they can, then how they get there), so the alignment between
goals, assessment and teaching is written down once instead of re-derived per
skill. The lesson skills read it before generating anything.

`/course-context-init` fills it in from your repo and an interview, and
`/course-context-update` folds in the design decisions you settle while working;
both are in [the catalogue below](#project). Like `writing-style.md`, you can
also edit it by hand. The shipped file is the English template; `templates/`
holds the same scaffold in Dutch, so copy `templates/course-context-nl.md` over
`context/course-context.md` first if that is the language you work in.

How the lesson skills chain together, from idea to lesson plan to class version
to published module, is described in the [lesson workflow](lesson-workflow.md).

## Skills

Skills are predefined workflows your AI assistant can run. In Claude Code, type
the skill name (e.g. `/commit`) to invoke it; in Codex and other tools, mention
the skill or let the assistant activate it from your request.

They share the same safety behaviour, so it is stated here once: skills that
write anything substantial propose a design first and stop for your approval;
checking skills report findings and never auto-fix without confirmation; and no
skill commits to git (except `/commit`, whose whole job that is).

### Writing Style

- **`/proofread`** checks one markdown document against `writing-style.md` and
  your spelling. It picks the register from the file path (`course/` and
  `evaluations/` are student-facing; `sources/` is colleague-facing) and reports
  findings in three buckets: must fix, strongly suggest, consider, each with
  line number, quote, diagnosis, and proposed replacement. Every check comes
  from `writing-style.md` itself, so it follows your rules and your language
  rather than a fixed list.
- **`/translate`** renders a document, a passage, or text you paste with the
  call in another language. It infers the source language, proposes the course
  language as the target when the source is not already in it, and takes its
  register from the source: `writing-style.md` governs when the target is the
  course language, ordinary usage of the target language when it is not. Code,
  links, and alert markers survive the pass untouched; the result is checked
  against the original claim by claim, so nothing is added or dropped. It asks
  where to write before it writes.
- **`/writing-style-init`** rewrites `writing-style.md` to match your voice and
  audience. It asks for samples of your writing (strongly preferred) and
  interviews you only about what the samples did not answer. Without samples it
  warns that the result is a best guess.
- **`/writing-style-update`** reviews the current conversation for style
  corrections and preferences you expressed and folds them into
  `writing-style.md` as durable rules.

For the best `/proofread` spell-checking, install `hunspell` with dictionaries
matching your course languages. For English plus Dutch:

```bash
brew install hunspell
mkdir -p ~/Library/Spelling && cd ~/Library/Spelling
curl -fLO https://raw.githubusercontent.com/LibreOffice/dictionaries/master/nl_NL/nl_NL.aff
curl -fLO https://raw.githubusercontent.com/LibreOffice/dictionaries/master/nl_NL/nl_NL.dic
curl -fLO https://raw.githubusercontent.com/LibreOffice/dictionaries/master/en/en_GB.aff
curl -fLO https://raw.githubusercontent.com/LibreOffice/dictionaries/master/en/en_GB.dic
```

Without `hunspell`, the skill falls back to a visual spelling scan and says so
in the report. It treats `cSpell.words` in
[.vscode/settings.json](../.vscode/settings.json) and code-block tokens as the
project whitelist.

### Lessons

- **`/lesson-design`** designs a new lesson plan under `sources/lessons/`, from
  rough notes, a request for a follow-up lesson, or a vague intent (it asks up
  to three sharp questions). The design comes first, in chat: learning goals,
  place in the course, block structure, deliberate exclusions, with honest pros
  and cons of your suggestions and of its own. After approval it writes
  `sources/lessons/lesson-NN.md` and adds new terms to the glossary if your
  course keeps one. It never changes existing lessons.
- **`/lesson-summarize`** distils a full lesson plan into a one-page class
  version under `sources/lesson-plans/`: learning goals, content inventory, and
  a telegram-style timeline that fit on one A5 page. It never invents content;
  if something is missing from the source plan, it surfaces the gap and stops.
- **`/lesson-module-build`** turns a finished lesson plan into a complete
  student-facing module under `course/`: it proposes the module design (page
  split, code archives, image placeholders), and after approval writes every
  file, with frontmatter, downloadable archives, transparent placeholder PNGs
  with TODO notes, and the generated glossary page. It invents nothing beyond
  the plan and never touches the source lesson or other modules.
- **`/lesson-retro`** debriefs a lesson right after you taught it, in a
  conversational interview: one question at a time, following up on your
  answers. Afterwards it sorts every observation into a destination and shows
  the list before touching anything: timing notes into the lesson plan,
  course-wide insights into `course-context.md`, content errors into the issue
  queue for `/issue-fix`, style corrections to `/writing-style-update`. Every
  run also appends a dated section to the lesson's retro report at
  `sources/retros/<year>/lesson-NN.md`, the record the next retro of that lesson
  reads first. The retro is the one sanctioned way to modify an existing lesson
  plan.

### Evaluation

- **`/evaluation-design`** designs an exam or test from the lessons taught so
  far. It proposes a blueprint matrix in chat (per question: the learning goals
  it tests, difficulty, points) plus a coverage check that flags goals not
  tested, weighted out of proportion, or tested below the level they were taught
  at. After approval it writes the student-facing `instructions.md` and a
  colleague-facing `blueprint.md` under `evaluations/<year>/<slug>/`. It only
  tests what was taught.
- **`/quiz-build`** turns a question list (a notes file, a `blueprint.md`,
  questions drafted in conversation) into a QTI 1.2 `.zip` that Canvas imports
  as a quiz. It first maps every question to a supported Canvas question type
  and flags anything that fits none; after approval it generates and verifies
  the package and writes a colleague-facing `questions.md` with the answers.
  Importing the package into Canvas stays a manual step, once per course:
  [quiz questions never sync](limitations.md#quiz-questions-never-sync) explains
  why, and
  [new academic year](new-academic-year.md#what-a-rollover-does-to-each-type)
  lists the import clicks.
- **`/rubric-build`** builds a grading rubric for one assignment or evaluation.
  It proposes the criteria-by-levels matrix, with every criterion traced to a
  requirement in the assignment text or a learning goal, then writes a
  colleague-facing markdown rubric next to the evaluation, or under
  `sources/rubrics/` for homework. Markdown only; Canvas has no rubric sync in
  this project.

### Quality

- **`/consistency-check`** sweeps every module under `course/` for cross-file
  problems a single-file `/proofread` cannot see: dead cross-links and missing
  files, glossary drift, duplicate or gapped numeric prefixes, invalid
  frontmatter, and stale prerequisite references. Findings come back in the same
  three buckets as `/proofread`; only the mechanical categories are ever
  auto-applied, and only after confirmation.
- **`/coverage-map`** cross-references the course's learning goals against
  lesson plans, student modules, and evaluations, and reports alignment gaps:
  goals never practised, practised but never assessed, assessed but never
  taught. Every claim cites the files behind it. Most useful right before an
  exam period.
- **`/image-todos`** lists all outstanding image work across the course: the
  placeholder PNGs and image-TODO comments that `/lesson-module-build` leaves
  behind, as one table plus an orphan list. Pure report.

### Issue Queue

- **`/issue-report`** logs an error or a wanted change while you are checking
  course material, without pulling you out of your reviewing flow. Describe the
  problem and where you saw it (a rendered page title is fine); the skill pins
  the exact passage, quotes it back, and appends one bullet to
  `sources/issues.md`. It asks at most one clarifying question and never fixes
  or diagnoses anything.
- **`/issue-fix`** works through the open entries in `sources/issues.md`. It
  first verifies every entry, groups related ones, checks wider implications
  (the same defect elsewhere, style-rule drift, glossary, lesson plans), bundles
  all questions into one round, and presents one fix plan. After approval it
  applies the fixes and moves handled entries to the queue's Resolved section.
  Canvas keeps serving the old text until you run `npx course push` yourself.

### Export Styling

- **`/export-style-init`** derives a reusable PDF/DOCX export style from a
  reference you give it: a Word document, a PDF, a website, or a CSS file. It
  proposes a style spec, and after approval forks the selected style into
  `sources/export-style/` and regenerates the sample so you can see the result.
  See [export-styling.md](export-styling.md).
- **`/export-style-update`** makes a plain-language change to an existing export
  style ("headings dark blue", "bigger margins"), keeping the PDF and Word
  styles in sync, then regenerates the sample. It forks the selected style on
  first use, so your style survives upstream updates.

  Colour is the one thing these skills do not own outright: it comes from the
  theme in `src/css/themes/`, shared with the website and Canvas. A colour
  change edits the theme, and `reference.docx` alongside it: Word styles cannot
  read the theme. See [Customisation](customisation.md#branding).

### Students and AI

- **`/ai-tutor-build`** builds one AI module under `course/` for your students:
  a page per prompt type (guardrailed tutor, concept explainer, error and
  feedback interpreter, trace trainer, exam coach, quiz-me, extra exercises,
  teach-back), each holding one prompt a student pastes into any chatbot as the
  first message, plus a policy stub when the course has no AI-use page yet.
  Alongside them go study packs, which it has `/study-pack-build` build (next
  bullet), so the chatbot answers from the course instead of its training data.
  It asks you to confirm that students may upload the material to a third-party
  service before a single pack is built, and it leaves the rest of `course/`
  alone.
- **`/study-pack-build`** builds the study packs those prompts rely on, from one
  recipe per pack in `sources/study-packs/`: a TOC file whose frontmatter also
  names the compact pack and the page-title prefixes whose sections stay
  verbatim (reference cards, the glossary, the assessment pages). It exports the
  raw pack with [`npx course export -f md`](exporting.md#markdown), keeps that
  export in `sources/study-packs/raw/`, condenses it into the pack the course
  ships as a file item (the facts, the code, the cards and the rules, without
  the classroom logistics and the encouragement), and checks the compact against
  the raw with its helper script: every heading, every code block and every
  verbatim section has to survive. Run with no arguments it regenerates every
  pack, re-condensing only the sections whose raw changed, so the diff shows
  real change only.
- **`/ai-policy-build`** interviews you and writes the student-facing page that
  says where AI may help in this course and where it may not, replacing the stub
  `/ai-tutor-build` leaves. It offers three starting points: the AI Assessment
  Scale (AIAS), the two-lane approach, or a custom policy from a deeper
  interview when neither framework fits. The frameworks, their wording examples
  and their references live in the skill's `references/frameworks.md`; the page
  itself names a framework in one line and links its site. It never invents
  institution policy: with none to name, it leaves a visible `TODO` where the
  link goes. Afterwards it offers `/course-context-update` so the decisions land
  under Assessment in `course-context.md`.

### Project

- **`/course-setup`** turns a fresh copy of the template into your course. It
  reads what the repo already settles, asks you the rest in one round, and
  proposes every answer for approval before touching anything. Then it runs
  `npx course setup` (which writes `course.config.yml` and installs the
  language-matched templates) and writes the README prose the command cannot
  generate, before handing off to `/course-context-init` and
  `/writing-style-init`. It never connects Canvas for you: `npx course init`
  asks for credentials you type yourself.
- **`/course-context-init`** fills in or refreshes
  [course-context.md](../context/course-context.md): it reads the repo, infers
  everything it can, interviews you only about what the repo did not answer, and
  writes the doc after per-section confirmation. Re-running is expected;
  existing content is treated as confirmed.
- **`/course-context-update`** reviews the current conversation for
  course-design decisions you settled (a learning-goal notation, an assessment
  rule, a scope boundary, a module convention) and folds them into
  [course-context.md](../context/course-context.md) as durable facts. It reads
  the document's headings at runtime, so it fills a section still on `TODO` or
  replaces a fact the conversation overtook, and never reorders the sections.
  Writing-style corrections it notices go to `/writing-style-update` instead.
- **`/commit`** makes committing safer and more consistent: it reviews the
  changes, stages the appropriate files, and creates a commit following the
  project conventions: imperative, present tense, verb-first summaries (`Add`,
  `Fix`, `Update`), no `feat:`/`fix:` prefixes.

## Writing Your Own Skills

The bundled skills don't cover everything, and they don't have to: a skill is a
plain markdown file, and your assistant can write one for you. See
[Writing your own skills](writing-skills.md) for the file layout, the shared
template, and the naming conventions, and the [ideas list](roadmap.md) for
candidates. Most are within reach of a single AI-assisted session.
