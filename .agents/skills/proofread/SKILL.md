---
name: proofread
description: Check a markdown document for spelling, grammar, natural flow, and compliance with context/writing-style.md, in whatever language that guide is written. Distinguishes the student-facing register (course/, evaluation text handed to students) from the colleague-facing register (sources/, blueprints, rubrics), and applies the right rules. Reports findings and offers to apply fixes; writes nothing by default. Use for "proofread", "check the spelling", "check this lesson plan against the style guide", "nalezen", "spelling checken", "check dit lesplan op stijl".
---

# Proofread

Review one markdown document for spelling, grammar, naturalness of the prose (no
translated feel), and
[`context/writing-style.md`](../../../context/writing-style.md) compliance.
Report findings grouped by severity; fixes are applied only when the author
picks them from the report (step 7).

## Input

`$ARGUMENTS` may hold a path. If empty, use the file open in the IDE; otherwise
ask. Only proceed for `.md` files. For other extensions, stop and explain.

## Steps

1. **Determine the register** from the path: `course/**` → student-facing. Under
   `evaluations/**`, what students receive (`instructions.md`, exam and
   assignment text) → student-facing; the colleague documents beside it
   (`blueprint.md`, `questions.md`, `rubric.md`) → colleague-facing. Anywhere
   under `sources/` → colleague-facing. `docs/**`, `README.md` and `AGENTS.md` →
   colleague-facing, plus the rules in `docs/contributing.md` § Documentation
   Style (UK spelling, 80 columns), which add to writing-style.md rather than
   override it. Otherwise ask. The lowest-numbered lesson under
   `sources/lessons/` (if any) is the worked example for the colleague-facing
   register.

2. **Read `context/writing-style.md` in full.** Apply the shared rules plus the
   section matching the register. writing-style.md is the authoritative ruleset:
   do not invent rules it does not contain, and do not assume a language it does
   not state. The mechanical checks below name the usual suspects; run each
   against what the guide actually says, noting its heading case, address form,
   and regional variety first (the shipped baselines disagree on all three).

3. **Mechanical checks** with `grep -n` on the file; discard hits inside code
   blocks, inline code, URLs, frontmatter, and HTML comments (they are not the
   document's prose). Check at least:
   - Em-dashes (`—`): always a violation unless the dash itself is the quoted
     subject.
   - Every literal phrase writing-style.md lists under its AI-tells section,
     plus any regional or vocabulary blacklist it carries (the English baselines
     list LLM vocabulary, the Dutch ones list Hollandisms). Build the grep from
     the file, not from memory.
   - Wrong address form, as writing-style.md defines it (e.g. `one` where an
     English guide mandates `you`, or `u`/`jij` where a Dutch guide forbids
     them).
   - Headings that break the guide's case rule, in whichever direction it runs:
     sentence case where the guide mandates title case, or title case where it
     mandates sentence case. Headings ending in punctuation other than `?`.
   - In a `course/` page, a body that opens with a level-1 heading: the first
     non-blank line after the frontmatter starts with `# `. The frontmatter
     `title` is already the page heading in every output (writing-style.md's
     Headings and Titles section), so the proposed replacement is deleting the
     line. If its wording differs from the `title`, quote both: the author may
     want the `title` to take that wording instead.
   - Register mismatch: in a colleague-facing doc, a page-title emoji on the H1
     or GitHub-style callouts (both defined in writing-style.md's student-facing
     section); in a student doc, a meta-introduction opening (writing-style.md's
     AI-tells section lists the phrasings) in the first paragraph.

4. **Spelling.** If `hunspell` is available (`command -v hunspell`,
   `hunspell -D`) with a dictionary for the document's language, run it over the
   prose and collect suggestions per candidate typo. Discard words whitelisted
   in `cSpell.words` (`.vscode/settings.json`) or used as identifiers in the
   file's own code blocks. Without hunspell, scan visually, note in the report
   that no system spell-checker ran, and point to the install instructions in
   [`docs/ai-assistants.md`](../../../docs/ai-assistants.md).

5. **Content checks** (judgement-based; do not flood the report):
   - Prose that reads as translated rather than written: literal idiom
     translations, calqued collocations, another language's sentence rhythm
     (stacked subordinate clauses, multiple parentheticals in one sentence).
     Every baseline names this; some make it a separate AI-tell with markers to
     grep for.
   - Decorative tricolons, bold scattered through prose, trailing summaries,
     repeating the heading as the section's first line.
   - Student-facing only: sentences clearly above the guide's reading level
     (flag as "consider", not "must fix"); Latinate or inflated phrasing where
     the guide's plain-word rule offers an alternative.
   - Colleague-facing only: cushioning before the point; defensive hedging.

6. **Report in three severity buckets**, each finding as
   `line | quoted text | diagnosis | proposed replacement`, diagnoses of one
   short sentence:
   - **Must fix**: hard `writing-style.md` violations (em-dashes, the wrong
     heading case, a forbidden address form, a level-1 heading opening a
     `course/` page, register mismatch).
   - **Strongly suggest**: spelling, grammar, translated-sounding phrasing, AI
     tells, tricolons, scattered bold.
   - **Consider**: sentence length, rhythm, trailing summaries.

   Name empty buckets explicitly; if all three are empty, say the document is
   clean and stop. Do not invent findings.

7. **Offer to apply fixes**: all "must fix", a named selection, or none (the
   default). When applying, use minimal edits, one concern per edit, then re-run
   the mechanical checks once to confirm. Close with what changed and what was
   reported but left untouched.

## Rules

- **Language.** Report in the language the author writes in; findings and
  proposed replacements stay in the document's own language.
- Treat the colleague-facing register as a peer dialect with its own rules in
  writing-style.md's colleague-facing section, not as a watered-down student
  register.
- Something that reads oddly but breaks no writing-style.md rule goes under
  "consider" with a one-sentence note, or is left alone.
- Run `npm run format` on what you edited; Prettier owns markdown wrapping.
- No commits, no pushes, no staging.

$ARGUMENTS
