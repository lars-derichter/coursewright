---
name: upstream-update
description: Pull a Coursewright release into this course with update-from-upstream.sh, then do what the squash merge cannot: re-apply the local hunks the conflict resolver drops from tooling files (an extra CLI command, package.json scripts, an ignore-file entry), fold upstream's changes to the protected files (AGENTS.md, the writing-style and course-home templates) into the local copies by hand, fix what the release's new rules flag in course/, run every check, and commit at the points Phase A named. Phase A reads the release and proposes; Phase B runs the script and lands the commits. Use for "update from upstream", "update to coursewright vX", "pull the coursewright update", "upstream bijwerken", "update naar coursewright vX", "de coursewright-update binnenhalen".
---

# Upstream Update

`update-from-upstream.sh` owns the mechanical merge: fetch, squash, restore the
protected paths, resolve conflicts, commit, tag. This skill owns the judgement
around it. The two histories are unrelated, so every file changed on both sides
is an add/add conflict that the resolver settles whole, to whichever side
committed most recently, and an upstream release usually wins. That silently
drops whatever the course added to a tooling file; putting it back is the second
half of the job.

## Input

An optional release, such as `v1.2.0`. The script always merges the branch
`update-from-upstream.conf` names, so the argument is a check, not a choice:
when that branch stands at a different release, Phase A says where and asks
before going on.

## Steps

### Phase A: Review and Propose (Writes Nothing)

1. **Preflight.** `git status --porcelain` must be empty and the `upstream`
   remote present; then `git fetch upstream --tags`. The base is the
   `last-upstream-merge` tag, or `v<version>` from `package.json` when the tag
   is missing (it lives only on the machine that ran the last update). The
   target is the configured branch; `git describe --tags --match 'v*'` names the
   release it stands at. Stop when base and target resolve to the same commit:
   the course is current.

2. **Read the release.** `git log --oneline <base>..<target>`,
   `git diff --stat <base>..<target>`, and the `CHANGELOG.md` entries the diff
   adds. Mark every entry that changes a rule for course content rather than for
   the tooling: a new `npx course validate` warning, a frontmatter convention,
   an export behaviour. Those come back in step 5.

3. **Predict the resolver.** Read `update-from-upstream.conf`. A file outside
   the protected paths that upstream changed conflicts when the local copy also
   differs from the base (`git diff --quiet <base> HEAD -- <file>` fails).
   Without a terminal the script settles each conflict on the side whose last
   commit is most recent, ties to upstream: compare
   `git log -1 --format=%ct HEAD -- <file>` with the same against `<target>`.
   The rejoin list is every file that goes to upstream and carries local hunks
   (`git diff <base> HEAD -- <file>` is not empty): an extra CLI command and its
   registration, `package.json` scripts, an entry in `.prettierignore` or
   `eslint.config.js`. Cross-check it against any local section of `AGENTS.md`
   and against the drift report, which lists the same files under "Drifted":

   ```bash
   node .agents/skills/upstream-update/scripts/upstream-drift.js --no-fetch
   ```

4. **Read what upstream changed in the protected paths.** The script restores
   those from local history, so a change upstream made there reaches this course
   only by hand. For each `protected_files` and `protected_dirs` entry, diff the
   upstream file the local one descends from, not the local path:

   | Local                       | Upstream source                        |
   | --------------------------- | -------------------------------------- |
   | `context/writing-style.md`  | `templates/writing-style-<variant>.md` |
   | `context/course-context.md` | `templates/course-context-<lang>.md`   |
   | `course/index.md`           | `templates/course-index-<lang>.md`     |
   | `README.md`                 | `templates/README-course-<lang>.md`    |
   | everything else             | the same path                          |

   `<lang>` is `language` in `course.config.yml`; the writing-style variant is
   the one the local guide descends from (its language section says which). For
   each change, propose the edit that carries the new fact into the local file,
   verbatim from the template when the template is in the course language,
   without touching a local customisation. Name the changes that do not apply
   here: template-author prose in the README, a tutorial module this course
   never had.

5. **Check the course against the new rules.** For each entry marked in step 2,
   scan `course/` for what the rule now flags, including the two root pages
   `validate` never scans, `course/index.md` and `course/LICENSE.md`, since only
   module items are validated. Propose the fixes, marked as the author's call:
   `course/` is theirs.

6. **Propose.** One report: the release in a few lines; a table of predicted
   conflicts (file, side, why, rejoin yes or no); the protected-file edits; the
   content fixes; the verification list from step 10; and the commit points: the
   script's own import commit, a rejoin commit when the list is not empty, and
   one commit per protected-file or content concern.

   Adjust on request and stay in Phase A. Stop. Wait for explicit approval
   before starting Phase B.

### Phase B: Update and Repair (Only After Approval)

7. **Run the script**, in the background and without a terminal:

   ```bash
   ./update-from-upstream.sh < /dev/null
   ```

   With no terminal it applies the default at every prompt, which is what Phase
   A assumed. A `/dev/tty` that exists but cannot be opened ("Device not
   configured") ends the same way: each `read` fails and the default applies. If
   it has not finished within a minute, a terminal is attached and it is waiting
   at a prompt: tell the author to press Enter at each one. Read the log: every
   conflict went to the predicted side (correct the rejoin list where it did
   not), the import commit exists, and the `last-upstream-merge` tag moved.

8. **Rejoin.** For each file in the list, the local hunks are
   `git diff <base> HEAD~1 -- <file>`; apply them on upstream's new file with
   `git apply --3way`, or edit them in by hand from `git show HEAD~1:<file>`
   when the patch does not apply. A three-way apply that conflicts leaves
   markers in the file: resolve them, and confirm
   `grep -nE '^(<{7}|={7}|>{7})' <file>` finds none before committing. Never
   `git checkout HEAD~1 -- <file>`: that also reverts what upstream changed in
   the same file, so the recipe in
   [docs/updating-your-project.md](../../../docs/updating-your-project.md#recovering-local-changes-to-tooling-files)
   fits only a file upstream left alone. Run `npm install` when `package.json`
   or the lockfile changed, and confirm `npx course --help` lists the local
   commands. Commit.

9. **Integrate.** Apply the protected-file edits and the content fixes approved
   in Phase A, one commit per concern.

10. **Verify**, in this order: `npm run format`, `npm run lint`, `npm test`,
    `npm run test:template`, `npm run build`, `npx course validate`,
    `npm run lint:links`, `npx course check`. The template suite fails on
    exactly four checks in a course repository, the ones that read `README.md`,
    `course/index.md` and the two guides in `context/`
    ([docs/tests.md](../../../docs/tests.md#the-two-suites)); a fifth failure is
    a regression. So is anything else that passed before the update. Finish with
    the drift report from step 3: "Drifted" should now name only the known local
    customisations.

11. **Report.** The commits that landed; what was rejoined and why; the
    verification table with the expected failures named as such; and what stays
    open: `npm run vscode:install` when
    `.vscode/extensions/course-manager/package.json` changed, and anything that
    belongs upstream rather than here, such as a broken link in `docs/` or a
    script bug.

## Rules

- **Language.** The skill is English; report in the language the author writes
  to you in. Edits to `context/writing-style.md` and to `course/` follow that
  guide.
- Re-apply hunks; never restore a whole file from before the import.
- Never edit `docs/`, `templates/`, `export-styles/` or `src/css/themes/`: the
  next update overwrites them, so a fix they need goes to the upstream
  repository.
- The script's prompts get the default and nothing else. Phase A was built on
  it.
- Commits only at the points Phase A named, one concern each. Never `git push`:
  the pre-push hook runs `npx course check`, but pushing is the author's call.
- A commit body says which side the resolver took and why the rejoin was needed.
- Temp files go to the session scratchpad.

$ARGUMENTS
