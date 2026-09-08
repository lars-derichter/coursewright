---
name: lesson-module-build
description: Generate a complete student-facing module under course/ from a lesson plan in sources/lessons/: pages (overview, content, reference cards, summary, glossary, optional homework), downloadable code archives, and transparent PNG placeholders with TODO notes for images. Phase A proposes the design and stops for approval; Phase B writes the files. Use for "build lesson module", "turn this lesson plan into a module", "generate the student material", "module maken van les", "lesplan omzetten naar course", "student-materiaal genereren".
---

# Lesson Module Build

Turn a lesson plan under `sources/lessons/lesson-NN.md` into a complete
student-facing module under `course/`.

## Input

`$ARGUMENTS` may hold a path (`sources/lessons/lesson-03.md`), a lesson number
(`lesson 3`, `3`), and/or free-text notes on the page split. If empty, use the
file open in the IDE when it is under `sources/lessons/`; otherwise ask. Stop
with one sentence if the source is not a `.md` under `sources/lessons/`.

## Steps

### Phase A: Design (Writes Nothing)

1. **Read**, in order: the source lesson plan (full);
   [`context/course-context.md`](../../../context/course-context.md) (module
   conventions, code-and-downloads rules, glossary); for a needed section still
   `TODO`, infer the answer from existing modules or ask once, offering
   `/course-context-update` at the end to record it;
   [`context/writing-style.md`](../../../context/writing-style.md) (the pages
   use the student-facing register);
   [`docs/frontmatter.md`](../../../docs/frontmatter.md); the one or two
   lowest-numbered existing modules under `course/` as worked examples; the
   canonical glossary file, if the course has one (default
   `sources/reference-materials/glossary.yml`; path per `course-context.md`). If
   no modules exist yet, the Phase A proposal doubles as a proposal for the
   module conventions. Confirm it explicitly.

2. **Inventory the plan.**
   - **Goals.** List the lesson's goals, in the course's own notation. Note for
     each which pages will practise it: the page where a student does something
     with it, not merely reads about it. A goal the module only explains is
     worth naming as such.
   - **Code snippets** (courses with code only). Group into projects: snippets
     that reference each other form one project; independent snippets can share
     one archive in numbered subfolders. Layout, packaging, and exclusions
     follow the Code and downloads section of `course-context.md`.
   - **Reference cards** (only if `course-context.md` defines card page types).
     Find every card the plan introduces in prose, the way `/lesson-design`
     writes them; each becomes its own page.
   - **Homework.** A homework page only if the plan has a homework section.
   - **Images.** References like "show on the board", diagrams, schemas. One
     placeholder per reference with a concrete TODO; one to three per lesson is
     normal.

3. **Propose in chat**: the module name and label (next free two-digit `NN`
   prefix in `course/`, kebab-case ASCII slug, title-case label, or the naming
   convention in `course-context.md`); the numbered page split: overview first,
   one content page per concept cluster (title + one-line summary), reference
   cards directly after their introducing page with a short callout pointer back
   from that page, then summary, glossary (only if the course generates one),
   homework last; the code archives (name, file count, layout, referencing
   pages); the image placeholders (filename, page, TODO text).

   Close the proposal with **goals against pages**: one line per lesson goal,
   naming the pages that practise it. Flag any goal no page practises, and any
   page that serves no goal; the author decides whether a gap matters, so do not
   redesign the plan around it or block on it. Skip this paragraph entirely if
   the lesson plan states no goals.

   Adjust on request and stay in Phase A. Stop. Wait for explicit approval
   before starting Phase B.

### Phase B: Write (Only After Approval)

4. **Code archives.** Build each project in a fresh directory in the session
   scratchpad, laid out per the course's conventions: a `<project>/` root folder
   so the IDE recognises the project after unzipping; no IDE metadata, build
   files, or compiled artifacts; one class/unit per file; wrap an incomplete
   snippet in a minimal runnable entry point with a TODO comment. Zip in the
   scratchpad, then **copy** the archive into
   `course/NN-<slug>/_files/<project>.zip`. Never let `zip` write directly into
   a cloud-synced folder (a rename inside such a mount can fail with "Operation
   not permitted"). Verify with `unzip -l` that each archive holds only the
   intended files; stop with a clear error if not.

5. **Image placeholders.** Per placeholder, a 1x1 transparent PNG (kebab-case,
   ASCII, `.png`), written in the scratchpad and copied into `_files/`:

   ```bash
   echo "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=" \
     | base64 -d > "$DIR/<name>.png"   # $DIR = a dir in the session scratchpad
   ```

6. **Markdown pages.** Student-facing register per `context/writing-style.md`
   (voice, punctuation, page-title emoji, callouts). Frontmatter per
   `docs/frontmatter.md`: homework becomes `canvas_type: assignment`; mirror the
   worked example's homework page or ask for the values once. A page opens with
   its frontmatter and nothing else above its first `##`: the `title` is the
   page heading in every output, so never write a `#` line in the body.
   Conventions and formatting mirror the worked examples and
   `course-context.md`; content comes from the plan alone. Use the canonical
   glossary's base terms: a term's listed synonyms may be named once at first
   use; never standardise on a synonym or invent one. Cross-links are relative:
   `./0X-<slug>.md`, `../NN-<module>/0X-<slug>.md`, `./_files/<name>.zip`. Embed
   images where they belong; each page with images gets one HTML-comment TODO
   block at the bottom listing what each must show.

   Page roles (defaults: `course-context.md` and worked examples win):
   - **Overview**: 2–4-sentence intro, what students need, what the lesson
     covers. Name tokens students will _see_ but need not master only when the
     lesson actually shows them: concrete items, no generic "we go deeper later"
     section.
   - **Content pages**: one topic per page, worked examples, the plan's teaching
     method (prediction exercises, practice instructions) where it uses one.
   - **Reference cards**: one per card the plan flags, laid out per the course's
     card conventions.
   - **Summary**: self-contained revision text. Every new concept in its own
     right, bold lead-in per concept, a short commented example where it helps.
     Repeating the content pages is intended. No material beyond the lesson.
   - **Glossary** (only if the course generates one): a stub with frontmatter
     only (title from the glossary config, `canvas_type: page`) and an empty
     body; step 7 fills it. Add any term the lesson introduces to the canonical
     glossary file first (ask the author if unsure it belongs).
   - **Homework**: what to make, how to start, rules, how to hand in.

7. **Generate the glossary page** (only if the course has one):
   `npx course build-glossary -m <NN-slug>`, then
   `npx course build-glossary --check` must report the page up to date. If the
   folder name lacks the lesson number in the form the glossary config expects,
   set `lesson: N` in the stub's frontmatter first. A missing-term flag means
   step 6's glossary addition was skipped. Add the term and re-run.

8. **`_category_.json`**: a `label` and a `position` matching the `NN` prefix,
   pretty-printed the way Prettier leaves it (one key per line, one trailing
   newline), like the existing modules'.

9. **Style pass.** Re-check every page against the student-facing rules of
   `context/writing-style.md` and the module conventions of `course-context.md`,
   and every internal link against the actual numbered filenames.

10. **Report in chat**: module path; generated files grouped (pages, archives,
    PNGs, `_category_.json`); table of image TODOs. Suggest as separate steps,
    do not run: `/proofread` on the module, `npx docusaurus start` to check
    sidebar and links, unzipping one archive in the target IDE. Offer
    `/course-context-update` for any conventions `course-context.md` was
    missing.

## Rules

- **Language.** Write everything in the language `context/writing-style.md`
  states the course uses; `course.config.yml`'s `language` key only picks the
  generated labels. Reply in chat in the language the author writes in.
- Never change the source lesson or other existing modules under `course/`.
- No commits, no pushes, no staging.
- Run `npm run format` on what you wrote; Prettier owns markdown wrapping.
- Only the transparent PNG placeholder for images, never generated artwork.
- One lesson per call. Invent no content beyond the plan; if a needed image is
  unclear, write an honest TODO asking the author.

$ARGUMENTS
