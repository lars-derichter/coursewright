---
title: 📘 Git Workflow
canvas_type: page
---

By now you have Git installed, a GitHub account, and a local copy of your course
project. This page shows you how to use Git as part of your daily workflow:
saving your work, backing it up to GitHub, and getting things back when you need
to.

If you still need any of those, go back to
[What You Need](03-setting-up/01-what-you-need.md) and
[Your Course Project](03-setting-up/02-your-course-project.md). The
[git and GitHub guide](https://github.com/lars-derichter/coursewright/blob/main/docs/git-and-github.md)
explains what git is doing underneath.

## Saving Your Work

VS Code’s Source Control panel handles all of this without a terminal. Open it
with the branching-line icon in the activity bar, or **Ctrl+Shift+G** (Windows,
Linux) / **Cmd+Shift+G** (macOS). It lists every file you have changed since
your last commit.

1. **Review.** Click a file to see a diff, a side-by-side comparison of what you
   changed. Green lines are additions, red ones deletions.
2. **Stage.** Hover a file and click the **+** to include it, or the **+** next
   to the **Changes** heading to include everything. Staged files move to a
   **Staged Changes** section at the top.
3. **Commit.** Type a short message in the box at the top, then click **Commit**
   (or press **Ctrl+Enter** / **Cmd+Enter**).
4. **Push.** Click **Sync Changes**. The first time, VS Code asks you to sign in
   to GitHub, and remembers you after that.

**Sync Changes** pulls as well as pushes, so it is also how you pick up work you
committed on another machine.

> [!TIP]
>
> You do not have to stage everything at once. If you changed three files but
> only want to commit two of them right now, stage those two.

## From the Terminal

The same three steps, typed:

```bash
git add .                                          # stage your changes
git commit -m "Add intro page to database module"  # save a snapshot
git push                                           # upload to GitHub
```

Commit early and often. A commit after every meaningful change beats one giant
commit at the end of the day: a small one is easier to read later and easier to
undo. Write the message for your future self, so you can scan a list of commits
and find what you are after. Messages like these do the job:

- `Add welcome page to intro module`
- `Fix typo in assignment instructions`
- `Reorganise module 3 into subsections`

## The Canvas Sync File

If you publish to Canvas, your project gains one file you did not write:
`.canvas-sync.json`, in the project root. It is not ignored, and it has to be
committed along with everything else.
[Canvas Syncing](08-publishing/05-canvas-syncing.md) explains why.

## Viewing History and Getting Things Back

Nothing is ever truly lost. Every commit is a snapshot of your whole project,
and the easiest place to browse them is GitHub itself.

1. Open your repository and click the **commits** link near the top. You get
   every commit, newest first, and clicking one shows exactly what changed.
2. To follow a single file, open it and click **History** in the top-right
   corner, then **View file** on the commit you want.
3. To restore that version, click **Raw**, copy the content into your local
   file, and stage, commit and push it like any other change.

From the terminal you can pull a file straight out of an older commit:

```bash
git log --oneline
git checkout abc1234 -- course/01-getting-started/07-git-workflow.md
```

Replace `abc1234` with the hash from `git log`. After restoring, stage and
commit the change as usual.

## Keep Your Repository Private

> [!WARNING]
>
> If you use the `evaluations/` folder to store exams, tests, or other
> assessment materials, make sure your GitHub repository is set to **private**.
> A public repository means anyone, including students, can see everything in
> it.

You can change your repository’s visibility in GitHub under **Settings >
General > Danger Zone > Change repository visibility**.

Educators are eligible for a **free GitHub Pro account**, which includes
unlimited private repositories and other benefits. You can apply at
[GitHub Education](https://education.github.com/discount_requests/application).

## Try It

1. Open the Source Control panel and click a page you changed to read the diff.
2. Stage everything with the **+** next to **Changes**, type a message, and
   click **Commit**.
3. Click **Sync Changes**.

> [!CHECK]
>
> Your repository’s page on GitHub shows the commit, with your message on it.

> [!NOTE]
>
> To learn more about Git and GitHub:
>
> - [GitHub Skills](https://skills.github.com/): free interactive courses, in
>   real repositories
> - [Git Handbook](https://docs.github.com/en/get-started/using-git/about-git):
>   a short, clear overview of the concepts
> - [Atlassian Git Tutorials](https://www.atlassian.com/git/tutorials): the
>   basics through to the advanced corners
> - [Oh My Git!](https://ohmygit.org/): a game that teaches Git through puzzles
