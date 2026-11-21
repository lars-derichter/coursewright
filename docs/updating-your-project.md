# Updating Your Project

The original Coursewright project may receive bug fixes, new features, or
improved documentation over time. This guide shows you how to pull those updates
into your project.

> [!TIP]
>
> Before updating, make sure all your local changes are committed. Run
> `git status` to check: if it shows nothing to commit, you're good to go.

## One-Time Setup

Add the original Coursewright project as a remote called `upstream`. You only
need to do this once:

```bash
git remote add upstream https://github.com/lars-derichter/coursewright.git
```

You can verify it was added:

```bash
git remote -v
```

You should see both `origin` (your project) and `upstream` (the original
project).

The first time you run the script it creates a configuration file,
`update-from-upstream.conf`, and exits without merging anything. Review the
file, commit it, then run the script again. See
[Configuring what's protected](#configuring-whats-protected) for what the
settings mean.

## Pulling Updates

The easiest way to update is with the included script:

```bash
bash update-from-upstream.sh
```

The script:

1. Fetches the latest changes from upstream.
2. Squash-merges them into a **single commit** on your branch: upstream's full
   history is not imported.
3. Always keeps your protected paths. The content directories (`course/`,
   `evaluations/`, `sources/`) and the protected files (`README.md`,
   `AGENTS.md`, `CLAUDE.md`, the style and course-context guides,
   `course.config.yml`, and the config file itself) are restored from your
   version, never overwritten by upstream.
4. Prompts you for any **other** file that changed on both sides. For each
   conflict you choose what to do (see
   [Resolving conflicts](#resolving-conflicts) below).
5. Tags the merge point so you can see
   [which upstream version you're on](#which-version-you-are-on).

With an AI assistant, `/upstream-update` runs the script for you and also does
what a squash merge cannot: it re-applies local edits to tooling files that a
conflict resolved to upstream dropped, carries upstream's changes to the
protected files into your copies, fixes what the release's new rules flag in
`course/`, and runs every check. See [AI assistants](ai-assistants.md#project).

After running the script, install any updated dependencies:

```bash
npm install
```

Then push your updated branch to GitHub:

```bash
git push
```

## Which Version You Are On

`npx course --version` prints the version of the tooling in your project. It
reads `package.json`, which every update brings along, so the number is current
after each run of the script, and it works in a fresh clone of your project too.

The tag the script leaves, `last-upstream-merge`, says more precisely where you
stand. Releases of the original project are tagged `v1.0.0`, `v1.0.1` and so on,
and `git fetch upstream` brings those tags along, so git can name the release
your last update came from:

```bash
git describe --tags --match 'v*' last-upstream-merge
```

`v1.0.1` means your last update took that release exactly; `v1.0.1-7-g3f2a9c1`
means it took seven commits more. The [changelog](../CHANGELOG.md) lists what
each release changed. The tag lives only on the machine that ran the update, so
on another clone fall back to `npx course --version`.

## Configuring What's Protected

The script reads its settings from `update-from-upstream.conf`. The file uses a
simple `key = value` format with space-separated lists; lines starting with `#`
are comments.

```ini
# Directories whose local content is always kept (never overwritten by upstream).
protected_dirs = course evaluations sources

# Individual files always kept. Includes this config file itself so your
# customizations here survive future upstream updates.
protected_files = README.md AGENTS.md CLAUDE.md context/writing-style.md context/course-context.md update-from-upstream.conf course.config.yml

# Upstream git remote and branch to merge from.
upstream_remote = upstream
upstream_branch = main
```

- **`protected_dirs`**: directories whose local content is always kept. Anything
  upstream adds inside them is dropped.
- **`protected_files`**: individual files always kept. The config file lists
  itself here, so your edits to it survive future updates. Add any tooling file
  you've customised and don't want upstream to touch.
- **`upstream_remote`** / **`upstream_branch`**: where to merge from.

> [!NOTE]
>
> When upstream introduces a new file you want protected, take the update that
> brings it in first, then add it to `protected_files` and commit. Don't add it
> by hand before it exists in your project: the protection step deletes
> protected files that are absent from your history, so it would eat the
> incoming file instead of keeping it.

Because the config file is itself protected, edits you make here are never
overwritten. Commit the file after changing it.

> [!TIP]
>
> `export-styles/` and `src/css/themes/` ship unprotected on purpose: they hold
> defaults you copy out of, not edit in place. Keep your own export style or
> theme under `sources/` and point `export.style:` / `theme:` in
> `course.config.yml` at it. `sources/` is protected and `course.config.yml` is
> too. If you would rather edit a shipped file in place, add it to
> `protected_files`, or choose `a` at the conflict prompt. See
> [Customisation](customisation.md#branding).

### Deleting Files That Belong to the Tooling Project

"Use this template" copies the whole repository, so your course starts out with
a handful of files that govern the upstream project rather than your course: the
[code of conduct](../CODE_OF_CONDUCT.md), the [security policy](../SECURITY.md),
`.github/ISSUE_TEMPLATE/`, `.github/PULL_REQUEST_TEMPLATE.md`,
[CONTRIBUTING.md](../CONTRIBUTING.md) and the tooling's
[CHANGELOG.md](../CHANGELOG.md). Each says up front which project it applies to,
so leaving them costs nothing and keeps the bug-report route to the upstream
project open. Most people leave them.

If you would rather not carry them, deleting the files is only half the job: the
next update delivers them again. Delete them, commit the deletions, then list
them here:

```ini
protected_dirs = course evaluations sources .github/ISSUE_TEMPLATE
protected_files = README.md AGENTS.md CLAUDE.md context/writing-style.md context/course-context.md update-from-upstream.conf course.config.yml CODE_OF_CONDUCT.md SECURITY.md .github/PULL_REQUEST_TEMPLATE.md
```

Protection restores a path from your own history, and a protected path absent
from your history gets removed instead, which is what you want here. Commit the
deletions first, so "absent from your history" is true by the time the next
update runs.

> [!WARNING]
>
> Protect the individual paths, not `.github` as a whole. That directory also
> holds the CI workflow and the [GitHub Pages](hosting.md) deploy workflow;
> protecting it wholesale would freeze both at the version you happen to have
> today.

`LICENSE` and `THIRD-PARTY.md` are a different case: they cover code that stays
in your repository, so leave them alone.

### Renamed Files and Folders

Upstream occasionally renames a skill folder or a docs file. A squash merge does
not delete the old path in your project, so the update script prunes known old
paths automatically, but it can only do that from the run _after_ the one that
brought it the new list. After an update that renames files, either run the
update once more or remove the old paths yourself with `git rm -r`. If you
customised one of the old files, re-apply your edits to the renamed successor;
the old content stays in your git history.

A **protected** file that moves is the one case the script cannot prune for you:
it restores your version at the old path before pruning would run, so deleting
the old path automatically would throw your customisations away. Move those by
hand.

## Resolving Conflicts

A conflict only happens when a file outside your protected paths was changed
**both** locally and upstream. For each such file the script shows when each
side was last committed and prompts:

```
Conflict: docusaurus.config.js
  local last commit:    2026-05-20
  upstream last commit: 2026-05-28
  [l]ocal  [u]pstream  [m]erge in editor  [a]lways keep local   (default: upstream = most recent)
```

| Choice | What it does                                                                                                                          |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `l`    | Keep your version of the file.                                                                                                        |
| `u`    | Take the upstream version.                                                                                                            |
| `m`    | Open the conflict-marked file in your editor so you can merge by hand. The script waits, then checks that no conflict markers remain. |
| `a`    | Keep your version **and** add the file to `protected_files` in the config, so it stops conflicting on future updates.                 |
| Enter  | Apply the default: whichever side was committed most recently (ties go to upstream).                                                  |

If the script runs without a terminal (e.g. from another script), it applies the
default automatically for every conflict.

The `a` option is the clean way to "pin" a tooling file you've customised: the
next update restores it from your version before the resolver ever runs, so you
won't be asked again.

## Recovering Local Changes to Tooling Files

If you took the upstream version (`u`, or the default) of a file you'd actually
customised, you can recover your version afterwards.

**Before pushing**, restore your version from the previous commit:

```bash
git checkout HEAD~1 -- path/to/file
git add path/to/file
git commit -m "Restore local changes to path/to/file"
```

**After pushing**, recover from an earlier commit:

```bash
# See what changed
git diff HEAD~1 HEAD -- path/to/file

# Restore your version entirely
git checkout HEAD~1 -- path/to/file

# Or selectively re-apply your edits on top of the upstream version
```

Restoring the whole file also throws away whatever upstream changed in it.
`/upstream-update` re-applies only your own hunks instead.

> [!TIP]
>
> To stop being asked about a file you always want to keep, choose `a` (always
> keep local) at the prompt, or add it to `protected_files` yourself.

## Manual Workflow

If you prefer to run the steps yourself instead of using the script:

1. **Fetch** the latest changes:

   ```bash
   git fetch upstream
   ```

2. **Squash merge** the changes. The `--squash` flag applies all upstream
   changes without importing their commit history. The
   `--allow-unrelated-histories` flag is needed because your project was created
   from a template, not forked:

   ```bash
   git merge upstream/main --allow-unrelated-histories --squash
   ```

3. **Restore your content from HEAD**, then resolve any remaining conflicts. A
   squash merge only flags conflicts when both sides modify the same file: files
   that exist upstream but not locally are added silently as staged additions.
   `git checkout HEAD --` will not unstage them (they are absent from HEAD), so
   first reset the index for those paths, then check out from HEAD, then clean
   the working tree:

   ```bash
   # Unstage upstream-only additions in your content paths
   git reset HEAD -- course/ evaluations/ sources/ 2>/dev/null || true

   # Restore your content and protected files from HEAD
   git checkout HEAD -- course/ evaluations/ sources/ \
     README.md AGENTS.md CLAUDE.md context/writing-style.md context/course-context.md \
     update-from-upstream.conf course.config.yml 2>/dev/null || true

   # Drop the now-untracked upstream-only files
   git clean -fd -- course/ evaluations/ sources/

   # For each remaining conflicted file, keep your version...
   git checkout HEAD -- path/to/conflicted-file
   # ...or take upstream's:
   git checkout --theirs -- path/to/conflicted-file

   # Stage everything
   git add -A
   ```

   The protected paths above mirror the defaults in `update-from-upstream.conf`;
   adjust the list to match your own config.

4. **Commit** the result:

   ```bash
   git commit -m "Import upstream updates from coursewright"
   ```

5. **Tag** the merge point for future reference:

   ```bash
   git tag -f last-upstream-merge upstream/main
   ```

6. **Install** updated dependencies and **push**:

   ```bash
   npm install
   git push
   ```

> [!TIP]
>
> If a merge gets too complicated, you can abort it and try again later:
>
> ```bash
> git merge --abort
> ```
