---
name: course-setup
description: Turn a fresh copy of the Coursewright template into a real course (course.config.yml, the README, the course context and the writing style guide) by gathering the answers, running npx course setup, and writing the prose the command cannot. Phase A proposes every answer and stops for approval; Phase B applies them. Use for "set up the course", "set up this template", "make this template my course", "cursus opzetten", "dit template mijn cursus maken".
---

# Course Setup

Configure a new course end to end. `npx course setup` owns the mechanical part
(writing `course.config.yml` without disturbing its comments, copying the
language-matched templates into place, removing the built-in tutorial module);
this skill owns the judgement around it: working out the answers from the repo
and the author, then writing the README prose no command can generate.
Re-running is expected: treat what is already configured as confirmed and change
only what the author asks for.

## Steps

### Phase A: Gather and Propose (Writes Nothing)

1. **Read what is already set.** In order:
   - `course.config.yml`: `title`, `tagline`, `language`, `theme`,
     `export.style`, `footer.text`, `footer.license`. Anything other than the
     shipped defaults (`title: Coursewright`, `language: en`, `theme: github`,
     `export.style: generic`, no `footer.text`,
     `footer.license: CC-BY-NC-SA-4.0`) is an answer the author already gave.
   - `course/LICENSE.md`: which licence the course content is under, so the
     footer's licence button can match it.
   - `README.md`: if its H1 is still `# Coursewright`, it is the tooling's
     README and needs replacing. Otherwise it is the author's, and the course
     name, overview and module table in it are facts, not placeholders.
   - `context/course-context.md` and `context/writing-style.md`: whether each
     still holds shipped content or has been written in.
   - `course/`: which modules exist, and whether `01-getting-started/` is still
     there.
   - `.env`: whether Canvas is already connected. Never print the token.

2. **Interview the author for the rest, in one bundled round.** Ask only what
   the repo did not answer:
   - The course language, and whether the author works in that same language.
     They can differ: a Dutch course can be authored by someone who wants the
     interview in English.
   - The course name, and a one-line descriptor (programme, year, semester) if
     they want one on export covers.
   - Which writing-style baseline fits: `en`, `en-us`, `nl-be` or `nl`. Name
     what each prescribes rather than making them guess.
   - Theme and export style, from what `src/css/themes/` and `export-styles/`
     actually contain.
   - The website footer: a one-line notice in markdown (who wrote the course,
     and where; `{year}` stands for the year of the build), or `none` to keep no
     notice, and the licence button: one of the Creative Commons SPDX ids
     [The Site Footer](../../../docs/customisation.md#the-site-footer) lists, or
     `none`. Propose the licence that `course/LICENSE.md` declares, and flag it
     when the author picks another, since the button and that file must name the
     same licence.
   - Whether to replace the course home page (`course/index.md`) with the
     language-matched template, carrying the answer into step 3's flags: under
     `--yes` the command leaves the file alone unless `--course-home copy` says
     otherwise. Upstream that file is the project's own landing page (this repo
     publishes its `course/` as the project site), so a course that keeps it
     markets the tooling to its own students.
   - Whether to remove `course/01-getting-started/`. Say what it is (a
     walkthrough of the project and a worked example of every content type a
     course can create on its own) and that it publishes to students on the
     first `npx course push` if it stays. Mention it remains readable at
     https://coursewright.md/ and in the upstream repository afterwards.

3. **Propose every answer and the exact command.** List the answers as a table,
   marking each as taken from the repo or from the interview, then show the
   `npx course setup --yes …` invocation you will run. Name any destination the
   command will refuse to overwrite because it already holds the author's work,
   so nothing is a surprise.

   Adjust on request and stay in Phase A. Stop. Wait for explicit approval
   before starting Phase B.

### Phase B: Apply (Only After Approval)

4. **Run the command** with the approved flags, always with `--yes` so it never
   tries to prompt:

   ```bash
   npx course setup --yes --language <lang> --title <title> --tagline <text> \
     --theme <name> --export-style <name> \
     --footer <text|none> --license <id|none> \
     --readme <copy|keep> --course-home <copy|keep> \
     --course-context <copy|keep> --writing-style <variant|keep> \
     --tutorial <keep|remove>
   ```

   `--tagline`, `--footer` and `--license` are the only way to set those values
   under `--yes`; leave a flag out and whatever `course.config.yml` already
   holds stands.

   Report what it wrote and what it left alone. If it refused a destination, do
   not work around it by writing the file yourself. Tell the author and ask.

5. **Write the README prose.** The command copies the template; the words are
   this skill's job. Fill in the course overview and the module table from
   `course/` as it actually is, check the licence line against
   `course/LICENSE.md`, trim the "Useful links" list to what this course's
   colleagues need, and delete the tip at the top. Leave a `TODO` comment where
   the author has to decide something you cannot.

6. **Hand off to the two documents that need their own interview.** Offer to run
   `/course-context-init` first (what the course is), then `/writing-style-init`
   (how it is written). Both are separate skills with their own approval gates;
   do not inline their work here.

7. **Report, and name what is left.** State what changed, then the steps the
   author still owns: `npm start` to check the look, `npx course new-module` to
   begin, and `npx course init` for Canvas if it is not connected yet. Name
   `npx course init` rather than running it. It prompts for credentials, and the
   author types those, not you.

## Rules

- **Language.** Interview in the language the author writes to you in, which may
  differ from the course language. What goes into the README follows
  `context/writing-style.md` and the course language, not the interview
  language.
- Never edit anything in `templates/`, `export-styles/` or `src/css/themes/`:
  they are shipped defaults, overwritten on upstream updates. Copy out of them,
  which is what `npx course setup` does.
- Never invent a course fact. When the repo is silent and the author has not
  said, ask, or leave a `TODO` in the README.
- Never run `npx course push`: publishing is the author's call.
- No commits, no pushes, no staging.
- Run `npm run format` on the prose you wrote; Prettier owns markdown wrapping.

$ARGUMENTS
