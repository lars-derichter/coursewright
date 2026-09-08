---
name: consistency-check
description: Whole-course consistency sweep of course/: dead cross-links, terms used before their introducing lesson, glossary drift, duplicate or gapped numeric prefixes, frontmatter problems, page bodies that repeat their title as a heading, stale prerequisite references, a label language that does not match the prose language. Complements /proofread, which checks a single file, and /coverage-map, which checks learning-goal alignment rather than structure. Reports findings grouped by severity and offers to apply the mechanical ones; writes nothing by default. Use for "consistency check", "check the whole course", "find dead links", "consistentiecheck", "dode links zoeken", "hele cursus nakijken".
---

# Consistency Check

Sweep every module under `course/` for cross-file problems that a single-file
`/proofread` cannot see: dead links, glossary and terminology drift, structural
numbering issues, and stale prerequisite references. Report findings grouped by
severity; fixes are applied only when the author picks them from the report
(step 8).

## Input

`$ARGUMENTS` may name one or more module folders (e.g. `03-<slug>`) to limit the
sweep. Empty means all of `course/`. Link targets outside the scoped modules are
still verified.

## Steps

1. **Read the course facts.**
   [`context/course-context.md`](../../../context/course-context.md): whether
   the course keeps a glossary and where (default
   `sources/reference-materials/glossary.yml`), and the module conventions.
   [`docs/frontmatter.md`](../../../docs/frontmatter.md): valid frontmatter per
   content type. If the Glossary section is `TODO`, check whether the default
   glossary file exists; if the repo gives no answer, ask the author once and
   offer to save the answer into `course-context.md`.

   [`context/writing-style.md`](../../../context/writing-style.md): the language
   and regional variety the course prose is written in. It is the authority on
   that: `course.config.yml`'s `language` key only sets the generated **label**
   language and cannot express a variety. Note the language before running step
   6, which greps prose.

2. **Inventory the course.** List every module folder, its pages, and its
   `_files/` contents (`find course -type f`). Record each page's numeric
   prefix, frontmatter, and `_category_.json` per module.

3. **Dead cross-links.** Extract every relative link target from the pages with
   `Bash` + `grep -nE '\]\([^)]+\)'` (and `src=`/`href=` in raw HTML), keeping
   file and line. For each target that is a relative path (`.md` pages,
   `_files/` downloads and images), resolve it against the linking file's
   directory and verify it exists on the filesystem. Strip anchors and query
   strings before checking; skip absolute URLs.

4. **Glossary checks**: only if the course keeps one; otherwise skip this step
   and say so in the report.
   - **Terms before their lesson**: for each glossary term with a lesson number,
     grep the modules numbered _before_ that lesson for the term (and its
     synonyms) in prose. A term casually used before the lesson that introduces
     it is a finding.
   - **Missing lemmas**: technical terms that recur across pages, look
     glossary-worthy, and have no entry in the canonical glossary file.
     Judgement-based; keep it to clear cases.
   - **Synonym drift**: pages using a synonym where the glossary defines a base
     term. First use with the synonyms named once is fine (see the terminology
     rule in `/lesson-module-build`); consistent use of the synonym instead of
     the base term is a finding.
   - **Generated pages up to date**: run `npx course build-glossary --check`. A
     failure is a must-fix finding.

5. **Structure.**
   - Duplicate numeric prefixes within one module or within `course/` itself;
     gaps in the sequence (report gaps as "consider": they may be deliberate).
   - Frontmatter problems: run `npx course validate`, which checks these
     mechanically: unknown `canvas_type` values, an `external_url` or
     `external_tool` item with no URL, a `file` or `quiz` item whose `file_ref`
     or `quiz_ref` names nothing on disk. Every error it reports is a finding.
     It also reports broken markdown links and missing referenced files; fold
     those into step 3's findings. Raw HTML references it only warns about as
     never syncing, without checking the target exists; that existence check
     stays step 3's. What no command checks stays a judgement call against
     `docs/frontmatter.md`: assignment pages missing the fields the worked
     examples carry.
   - A body that opens with a level-1 heading. The same `npx course validate`
     run warns about each one by path and quotes the line. Every such warning is
     a finding, and the fix is the one the warning gives: delete the line,
     because the frontmatter `title` is already the page heading in every
     output. When the line's wording differs from the `title`, quote both in the
     finding, so the author can decide whether the `title` should take it.
   - `_category_.json` whose `position` does not match the folder's numeric
     prefix, or module folders missing `_category_.json` where the other modules
     have one.
   - Label language against prose language: the `language` key in
     `course.config.yml` picks the label set the tooling generates (alert
     titles, link and file cards, glossary headings), and it should match the
     language `writing-style.md` states the course is written in. An English
     guide under `language: nl` gives students English prose framed by Dutch
     generated labels. Report the mismatch, not a fix: either side may be the
     wrong one.

6. **Stale prerequisites.** Grep for phrases that point back at earlier lessons
   or modules, and for cross-module links, then check each against the actual
   current numbering and folder names. Cover at least the backward references
   ("the previous lesson", "the previous module", "we saw earlier") and the
   number-bearing forms ("lesson 3", "module 2", "chapter 4").

   Derive the grep terms from the pages, not from memory: translate those forms
   into the language step 1 established, then confirm the wording against the
   pages themselves, which show the course's one habitual word for a lesson and
   for a module.

   A page pointing at lesson 3 for material that now lives in lesson 4, or
   linking to a renamed module, is a finding.

7. **Group and report findings.** Three severity buckets:

   - **Must fix**: dead links, `build-glossary --check` failures, duplicate
     prefixes, invalid frontmatter, a body that opens with a level-1 heading.
   - **Strongly suggest**: terms used before their introducing lesson, synonym
     drift, stale prerequisite references, `_category_.json`/prefix mismatches,
     a label language that does not match the prose language.
   - **Consider**: prefix gaps, candidate glossary lemmas.

   For each finding: `file:line | quoted text | diagnosis | proposed fix`. Keep
   diagnoses to one short sentence. If a bucket is empty, say so explicitly. If
   all three are empty, say the course is consistent and stop. Do not invent
   findings.

8. **Offer to apply mechanical fixes.** Only the mechanical categories qualify:
   dead links with an obvious correct target, prefix and `_category_.json`
   corrections, deleting a body's opening level-1 heading (the line only; the
   `title` stays as it is). Ask whether the author wants all, a selection by
   number, or none. Default is none. When applying, make minimal-diff edits,
   then re-run the relevant check to confirm. Judgement findings (glossary,
   terminology, prerequisites) are never auto-fixed; the author handles those.

## Rules

- **Language.** Report in the language the author writes in; findings and
  proposed fixes stay in the course's own language.
- Every mechanical finding is verified against the filesystem or a command
  result; a grep hit alone is not a finding.
- Skip code blocks, inline code, URLs, frontmatter, and HTML comments for every
  check that greps prose: terminology in step 4 and prerequisites in step 6
  alike. Step 6 needs this most: a module or lesson number inside a command, a
  path or sample output is not a prerequisite reference, and any course that
  shows commands will carry them. Link extraction uses the raw file.
- Course specifics come from the repo at runtime; hardcode nothing.
- No commits, no pushes, no staging.
- Run `npm run format` on what you edited; Prettier owns markdown wrapping.

$ARGUMENTS
