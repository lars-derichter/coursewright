---
name: study-pack-build
description: Build the study packs students attach to a chatbot, from the recipes in sources/study-packs/. Exports the raw pack with npx course export -f md, condenses it per the skill's rulebook into the compact pack the course ships as a file item, and checks the compact against the raw with the helper script. Creates a pack from a scope, or regenerates existing packs incrementally, re-condensing only the sections whose raw changed. Phase A proposes the recipes and stops for approval; Phase B exports, condenses and checks. Use for "build study packs", "regenerate the study packs", "new study pack for test 3", "studiepakketten bouwen", "studiepakketten hergenereren", "studiepakket voor toets 3".
---

# Study Pack Build

Build the study packs a student attaches to a chatbot next to a course prompt: a
raw markdown export of a selection of the course, condensed to what a chatbot
needs (the facts, the code, the cards and the rules) and checked against that
export. One recipe per pack in `sources/study-packs/` says what goes in; the raw
export lives next to it, and the compact pack ships with the course.

## Input

`$ARGUMENTS` may hold nothing, pack names, a scope with a name, or a proposal.

- Nothing: regenerate every recipe in `sources/study-packs/`, incrementally.
- Pack names: regenerate those recipes.
- A scope (`module`, `course`, `flagged` or `toc`) with a pack name and free
  text: a new pack.
- A proposal handed over by `/ai-tutor-build` (the subsection, the packs with
  their scopes, the verbatim prefixes): Phase A is already answered, so start at
  Phase B.

## Steps

### Phase A: Design (Writes Nothing)

1. **Read**, in order:
   [`context/course-context.md`](../../../context/course-context.md): Course
   Overview (language), Assessment, Code and Downloads, Glossary, Scope
   Boundaries. Then
   [`context/writing-style.md`](../../../context/writing-style.md) for the title
   legend, which is where the verbatim prefixes come from;
   [`docs/frontmatter.md`](../../../docs/frontmatter.md#file-item) for the file
   item; [`references/pack-compression.md`](references/pack-compression.md);
   every recipe in `sources/study-packs/` with its raw export in `raw/`; and the
   existing wrappers, the file items whose `file_ref` points at a `_files/*.md`,
   which say where the packs ship.

2. **Propose in chat**, per pack:
   - **The recipe**: the existing `sources/study-packs/<pack>.toc.md`, or a new
     one from `npx course export-toc` (`-m <module>` for one module, `--flagged`
     for the flagged items, nothing for the whole course) with the AI module's
     own lines and the teacher's exclusions struck. Its frontmatter carries the
     pack's settings next to the exporter's `title` and `subtitle`: `compact:`,
     the path of the compact pack from the repository root, and `verbatim:`, a
     flow list of page-title prefixes (an emoji, a word) whose sections the
     compact keeps unchanged. Propose the reference cards, the glossary page,
     the assessment pages and the summary pages from the legend, for the teacher
     to confirm or extend.
   - **The selection**, in the recipe's words: which modules and pages.
   - **The compact path**: `course/<ai-module>/_files/<pack>.md`, next to the
     other packs.
   - **The wrapper**: the file item in the AI module's study-packs subsection,
     kept when it exists, written when not; the subsection comes from the
     existing wrappers, from the handed-over proposal, or from a question.
   - For a re-run, which sections will be re-condensed is known only after the
     export; say so.

   Adjust on request and stay in Phase A. Stop. Wait for explicit approval
   before starting Phase B.

### Phase B: Build (Only After Approval)

3. **Recipe**: write it or keep it.
   `npx course export-toc -o sources/study-packs/<pack>.toc.md` (with `-m` or
   `--flagged` as agreed), strike the lines that do not belong, add `compact:`
   and `verbatim:` to the frontmatter. The recipe is the one file of a pack that
   is edited by hand, and only its list and its frontmatter.

4. **Raw export**. For a re-run, first copy the committed raw to the session
   scratchpad. Then:

   ```bash
   npx course export -f md --toc sources/study-packs/<pack>.toc.md -o sources/study-packs/raw/<pack>.md
   ```

   The raw goes into version control as it comes out: never edited, never
   shipped.

5. **What to condense**:

   ```bash
   node .agents/skills/study-pack-build/scripts/pack-tool.js changed sources/study-packs/<pack>.toc.md <old raw in the scratchpad>
   ```

   lists the H1 sections that were added or changed, and those that were
   removed. For a new pack everything is added.

6. **Condense** the listed sections one at a time, per the rulebook's chunk
   procedure: `section` prints the raw section, the condensed text goes to the
   scratchpad, `splice` puts it in place, `check --section` proves it. `drop`
   removes a section the raw lost. Untouched sections stay byte-identical.

7. **Check** the whole pack:

   ```bash
   node .agents/skills/study-pack-build/scripts/pack-tool.js check sources/study-packs/<pack>.toc.md
   ```

   It names every broken invariant and prints the sizes and the ratio. Fix the
   compact section it names and run it again; a pack ships only when it passes.

8. **Wrapper**, when none exists: a file item per
   [`docs/frontmatter.md`](../../../docs/frontmatter.md#file-item) in the
   study-packs subsection, with `canvas_type: file`,
   `file_ref: ../_files/<pack>.md` and a colon-free title with the 📦 emoji in
   the course language (a colon, as in `📦 Study Pack: Getting Started`, needs
   YAML quoting). A `.md` file item works in the preview and on Canvas, because
   the wrapper emits a `@site/` URL that Docusaurus bundles as an asset; a plain
   link to a pack in a page body does not, so never link a pack from a page
   body.

9. **Ignore files**: `.prettierignore` carries `course/**/_files/*.md`,
   `sources/study-packs/*.toc.md` and `sources/study-packs/raw/`; add what is
   missing in a course made from an older release.

10. **Checks**: `npm run format` on the markdown you wrote (packs, raws and
    recipes are Prettier-ignored), `npm run lint:links` (a pack passes lychee as
    it is: the export unlinks every local link and the check refuses one in the
    compact) and `npm run build`.

11. **Report in chat**: per pack the raw and compact sizes and the ratio from
    the check, the sections re-condensed, and the wrapper written or kept; the
    staleness rule (a pack is a snapshot: after editing a lesson, run
    `/study-pack-build` with no arguments); and, for a new pack, which sentence
    of the AI module's intro page should now name it. This skill never edits the
    AI module's pages.

## Rules

- **Language.** Everything a student sees, the compact packs and the wrappers,
  is in the language `context/writing-style.md` states the course uses; reply in
  chat in the language the author writes in.
- A raw pack comes from the CLI and goes into version control unedited; a
  compact pack is condensed from it per the rulebook and passes the check;
  neither is patched by hand. To change a pack, change the course page and
  regenerate.
- The export reads `course/` alone, so `evaluations/` and `sources/` never enter
  a pack.
- Never change other modules under `course/`.
- No commits, no pushes, no staging.
- Temp files go in the session scratchpad.

$ARGUMENTS
