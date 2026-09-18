---
name: ai-tutor-build
description: Build one central AI module under course/ for students: a copy-paste prompt page per selected prompt type (guardrailed tutor, concept explainer, exam coach and more), a policy stub when the course has no AI-use page yet, and study packs, condensed markdown exports of the course material that students attach to the chatbot together with the prompt. Phase A proposes the module, the prompts and the packs and stops for approval; Phase B writes the pages and builds the packs with /study-pack-build. Use for "build AI tutor", "AI tutor module", "chatbot prompts for my students", "AI-tutor bouwen", "AI-module maken", "chatbotprompts voor mijn studenten".
---

# AI Tutor Build

Build one AI module under `course/` that turns any chatbot into a study aid with
guardrails: a page per prompt type that a student pastes as the first message, a
policy stub when the course has no AI-use page yet, and study packs, condensed
markdown exports of the course built by `/study-pack-build`, that the student
attaches alongside the prompt so the chatbot answers from the course rather than
from memory.

## Input

`$ARGUMENTS` may hold prompt-type names from the catalogue in
[`references/prompt-types.md`](references/prompt-types.md), a prefix or slug for
the AI module, a pack scope (`module`, `course`, `flagged` or `toc`), and/or
free text. Empty means: propose defaults.

## Steps

### Phase A: Design (Writes Nothing)

1. **Read**, in order:
   [`context/course-context.md`](../../../context/course-context.md): Course
   Overview (language, level), Assessment (evaluation moments, aids allowed),
   Pedagogy, Code and Downloads (filled in, it marks a course with code),
   Glossary, Scope Boundaries. For a needed section still `TODO`, ask once and
   offer `/course-context-update` at the end to record the answer. Then
   [`context/writing-style.md`](../../../context/writing-style.md) (the pages
   use the student-facing register),
   [`docs/frontmatter.md`](../../../docs/frontmatter.md), both `references/`
   files of this skill, the list of modules under `course/`, the lowest-numbered
   module other than the AI module as the worked example for page conventions,
   and any existing AI-policy page: search page titles for AI and policy words
   in the course language, and ask when unsure. A policy page says what students
   may and may not do per assessment moment; a page about using AI tools is not
   one.

2. **Classify the course** (code? exams or tests? writing?) and propose at most
   four prompt types by default: the tutor always, then the best fits for the
   course kind from the catalogue's "suggest when" column. List the rest in one
   line so the teacher can add them.

3. **Propose in chat**:
   - **The module**: prefix, slug and label. `00-` when the course keeps its
     meta modules (agreements, practical information) ahead of the lessons, so
     the AI module sits above the first lesson in the sidebar and in Canvas;
     else the next free `NN-`. Label in the course language.
   - **The pages**: the policy stub first, only when no policy page exists, as
     `01-<slug>.md` with the slug the course-language word for "AI rules"
     (`01-ai-rules.md`, `01-de-afspraken.md`) and a 📘 title in the course
     language; `/ai-policy-build` replaces it in place under that filename, so
     the name is fixed here once. Then the prompt pages from `02-`: filename and
     title per selected type, 📘 by default, or the entry that fits the type
     when the course's legend in `writing-style.md` has one (💪 practice, 🧩
     extra exercise). Offer the catalogue's three recipes for the tutor page.
   - **The prompt scaffold**: the catalogue's shared boilerplate filled in with
     course facts (course name, language, level, scope boundaries, glossary
     terms, and the assessment criteria where a type needs them), shown once;
     per type only its distinguishing rules and kickoff line.
   - **The packs**: the scope (default one pack per module; alternatives: the
     whole course as one pack, `--flagged` items only, or a curated `--toc`
     selection), the modules included (never the AI module itself, never
     anything the teacher excludes), the pack filenames, the `NN-study-packs/`
     subsection that will hold them, and the verbatim prefixes: the page-title
     prefixes whose sections a pack keeps unchanged, proposed from the legend in
     `writing-style.md` (reference cards, the glossary page, the assessment
     pages, the summary pages). The recipes go in `sources/study-packs/` with
     the raw exports in `raw/`; `/study-pack-build` owns them.
   - **The privacy and copyright confirmation** from
     [`references/attaching-files.md`](references/attaching-files.md), asked as
     an explicit question, and the per-tool upload lines with their check date,
     for the teacher to prune.

   Adjust on request and stay in Phase A. Stop. Wait for explicit approval
   before starting Phase B.

### Phase B: Write (Only After Approval)

4. **Module folder** and `_category_.json`: a `label` and a `position` matching
   the prefix, pretty-printed the way Prettier leaves it, like the existing
   modules'. A `00-` module takes `"position": 0`, which Docusaurus honours, and
   its folder is made by hand because `npx course new-module` refuses
   position 0.

5. **Policy stub page** (only when none exists), under the filename proposed in
   step 3: a short student-facing page saying that the rules for AI use in this
   course are set by the institution and the teacher, and where to find them,
   with this comment directly after the frontmatter block for the author:
   `<!-- TODO: replace this stub with the institution's policy, or run /ai-policy-build to write one. -->`.
   An HTML comment renders neither in the preview nor on Canvas (the push passes
   it into the page HTML and Canvas's sanitiser drops it), so it is an
   author-only note. The prompt pages link to it as the course rules.

6. **Prompt pages**, one per selected type, in this shape:
   - An intro paragraph: what the role does and why it helps learning.
   - A "How to use it" numbered list: open a chatbot of your choice (ChatGPT,
     Claude, Gemini or another); start a new chat; attach the study pack of the
     module you are studying, one short step linking the study-packs intro page,
     which alone carries the upload steps and the per-tool lines; paste the
     whole prompt as your first message; then ask your question or paste your
     work.
   - One line on where the course rules do not allow it, linking the policy
     page.
   - `## The prompt`: "copy everything in the box below", then the whole prompt
     in a ```text fence. The prompt is the shared boilerplate plus the type's
     distinguishing rules plus the course facts, in the student's first person,
     so it pastes unchanged.
   - A `[!WARNING]` that the AI can be wrong and that the course wins ties.
   - Cross-links to the sibling prompt pages.
   - On the tutor page only, when the teacher wants them: the three recipes from
     the catalogue, under a heading of their own.

   The section titles above are the model's, not the page's: page titles,
   headings and the prompt itself are all in the course language.

7. **The `NN-study-packs/` subsection**, last in the module: a
   `_category_.json`, and an intro page (what a pack is and why to attach it,
   which pack goes with which module, the five upload steps and the per-tool
   lines from `attaching-files.md`, and that a pack is a condensed snapshot: the
   course's facts, code, cards and rules at the date in its header, not every
   sentence of every page) with one HTML comment directly after the frontmatter
   block for the next author:
   `<!-- Packs are built by /study-pack-build from the recipes in sources/study-packs/; run it with no arguments to regenerate them all. -->`.
   The wrappers are `/study-pack-build`'s. Never link a pack from a page body;
   it ships as a file item.

8. **Study packs**: run `/study-pack-build` with the approved proposal from step
   3 (the subsection, the packs with their scopes, the verbatim prefixes).
   Handed a proposal, it skips its own Phase A and writes the recipes, the raw
   exports, the compact packs and their wrappers, and checks every pack against
   its raw.

9. **Checks**: `npm run lint:links` and `npm run build` must pass. A pack passes
   lychee as it is: the export unlinks every local link and the pack check
   refuses one in the compact, so no exclusion is needed. Say to open one
   wrapper with `npm start` to see the download card.

10. **Report in chat**: files by group (pages, wrappers, packs,
    `_category_.json`); the prompt types built; every pack with the raw and
    compact sizes and the ratio its check printed, and a staleness warning (a
    pack is a snapshot: after editing a lesson, run `/study-pack-build` with no
    arguments); the privacy note. Suggest as separate steps, do not run:
    `/ai-policy-build` when the stub was written, `/proofread` on the module,
    `/course-context-update` for anything `course-context.md` was missing.
    `npx course push` is the author's to run.

## Rules

- **Language.** Write everything in the language `context/writing-style.md`
  states the course uses; `course.config.yml`'s `language` key only picks the
  generated labels. Reply in chat in the language the author writes in.
- Packs are `/study-pack-build`'s: this skill proposes them and never writes
  one, and a regeneration is that skill's job.
- A re-run on a course that already has the AI module proposes only additions
  and regenerations, never a rewrite of a page the teacher edited.
- Never change other modules under `course/`.
- No commits, no pushes, no staging.
- Temp files go in the session scratchpad.
- Run `npm run format` on the markdown you wrote; Prettier owns markdown
  wrapping.

$ARGUMENTS
