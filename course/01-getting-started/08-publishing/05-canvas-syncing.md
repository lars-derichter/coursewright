---
title: 📘 Canvas Syncing
canvas_type: page
---

Push your content to Canvas, pull edits back into your files, or do both in one
run. The Course Manager panel runs those same commands, and the report lands in
the Coursewright terminal, where you read it and answer what the CLI asks.

## Connecting to Canvas

**Course: Init (Canvas Setup)** in the command palette asks for your Canvas web
address, an API access token and the course ID, and stores the three in `.env`.
The
[Canvas setup guide](https://github.com/lars-derichter/coursewright/blob/main/docs/canvas-setup.md)
shows where to find each. Terminal: `npx course init`.

> [!IMPORTANT]
>
> Keep `.env` secure. It holds your Canvas API token, which grants full access
> to your Canvas account. Never commit it to version control.

## Seeing What Would Change

**Course: Status** in the `…` dropdown reads your files and your Canvas course,
compares each against the last sync, and prints what a sync would do, writing
nothing to either side. **Status of This Module** on a module’s right-click menu
does one module. Status reads the live course, so it needs your credentials and
a connection; there is no offline version, because “what would a sync do” has no
answer from your own files alone. Terminal: `npx course status`, with `-m` for
one module.

## Pushing

Hover a module row and click **Push This Module to Canvas**, the little cloud.
**Course: Push to Canvas** in the `…` dropdown does the whole course, and
**Course: Push to Canvas (Dry Run)** in the palette says what it would do first.
Each folder becomes a Canvas module and each file becomes the item type its
frontmatter names: see
[Content Types](../05-organising-your-course/02-content-types.md). Terminal:
`npx course push`, `--dry-run`, `-m 01-getting-started`.

> [!NOTE]
>
> Push does not rebuild a module from scratch. An item you added in Canvas by
> hand is matched to a local file of the same type and title, and left where it
> is when nothing matches. See
> [Before You Publish to Canvas](./04-before-you-publish-to-canvas.md).

## Commit the Sync State

Your markdown files carry no Canvas ids. The link between a file and the Canvas
object it became lives in `.canvas-sync.json`, in the root of your project,
keyed by the file’s path under `course/`. Nothing else in your project records
it.

Commit it with the content it records. It is not ignored, so `git add .` picks
it up along with your markdown, and so does the **+** next to **Changes** in the
Source Control panel. A push, a pull or a sync leaves you two things to save:
the content you wrote, and the sync state that says where it landed. Never add
the file to `.gitignore` to get it out of the way.

It matters as soon as there is a second copy of your project: another laptop, a
colleague’s checkout, a fresh clone after you lose the original. That copy needs
to know which Canvas objects the course already owns. Without the file it falls
back on matching titles, and anything you renamed is created a second time
instead of updated.

Push from two checkouts and git can end up with two versions of the file and no
way to choose. Do not merge the JSON by hand. Keep one side whole, then run a
push: it claims each object back by type and title and writes the rows again.

```bash
git checkout --ours -- .canvas-sync.json
git add .canvas-sync.json
```

> [!WARNING]
>
> Never commit the file with the conflict markers still in it. Until you repair
> it, `push`, `pull` and `sync` refuse to run, each one naming the file. The
> [troubleshooting guide](https://github.com/lars-derichter/coursewright/blob/main/docs/troubleshooting.md#corrupted-canvas-syncjson)
> covers the repair.

## Pulling

**Course: Pull from Canvas** in the `…` dropdown turns your Canvas course into
local markdown files, which is how you take over a course that already lives
there; **Pull This Module from Canvas** does one module.

Pull asks git first and leaves any file `git status` calls modified or untracked
exactly as it is, listing it at the end. The rule behind that runs the opposite
way round from what you might expect: committed work is not protected,
uncommitted work is. A committed change survives in git whether or not pull
writes over it; an uncommitted one exists nowhere else. So commit before you
pull. When Canvas really does hold the version you want, `pull --force` switches
the guard off and asks first, and that one is terminal-only.

## Syncing Both Ways

Push and pull each pin a direction. **Course: Sync with Canvas** in the `…`
dropdown pins nothing: it reads both sides, works out what changed where since
the last sync, and writes each item in whichever direction it moved. **Sync This
Module with Canvas** does one module.

| What changed since the last sync | What sync does                                    |
| -------------------------------- | ------------------------------------------------- |
| Only your file                   | writes it to Canvas                               |
| Only the Canvas copy             | writes it into your file                          |
| Both, on the same item           | the newest change wins, and the report says which |
| Neither                          | nothing                                           |

Running a push and then a pull does not get you there. Where both sides changed
the same item, push hands it to your file and leaves Canvas matching, so the
Canvas edit is gone before the pull looks at it. Sync sees a conflict there,
settles it on its own terms, and names it in the report.

Two questions it will not settle alone, and puts to you in the Coursewright
terminal: a module both sides reordered, where it prints both orders and asks
which wins, and a file that vanished while a new one turned up in the same
folder with the same title, where it asks whether that is one item renamed.

Your first run should still be a push. Sync tells a changed item from a new one
by `.canvas-sync.json`, which links nothing before your first push, so a module
with items on both sides looks brand new on both, and syncing it would drop a
second copy of everything into Canvas. Sync refuses that module and sends you to
push or pull, which pair each file with the Canvas object of the same type and
title and tie the two together from then on.

## From the Terminal

The prune, conflict, order and force switches exist only here; the panel has no
control for any of them. Every prune lists what it will delete and asks first.

```bash
npx course sync                        # two-way; the newest change wins
npx course sync --dry-run              # report it instead of making it
npx course sync -m 01-intro -m 02-html # only these modules; repeatable
npx course sync --conflict local       # your file wins every clash
npx course sync --order canvas         # Canvas wins a reordered module
npx course sync --prune                # delete on both sides; asks first
npx course push --prune-canvas         # delete Canvas items you deleted
npx course pull --prune-local          # delete local files Canvas dropped
npx course pull --force                # write over uncommitted local work
npx course status                      # what a sync would do; writes nothing
npx course validate                    # check your content before pushing
```

The full reference is in the
[user guide](https://github.com/lars-derichter/coursewright/blob/main/docs/user-guide.md#canvas-sync).

## Try It

1. Run **Course: Init (Canvas Setup)** from the command palette and give it your
   Canvas address, token and course ID.
2. Run **Course: Push to Canvas (Dry Run)**, also from the palette, and read the
   report.
3. Hover the **Getting Started** module and click **Push This Module to
   Canvas**.
4. Open the `…` dropdown and choose **Course: Status**.

> [!CHECK]
>
> The module is in your Canvas course, **Open in Canvas** on its row takes you
> straight there, and status reports nothing left to do.
