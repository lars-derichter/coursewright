# What Coursewright Does Not Do

Coursewright is opinionated. It expects one folder layout, treats your markdown
as the source of truth, and holds the full content of only some of the things a
Canvas module can hold. That is what makes it small enough to trust, but it also
makes it a poor fit for some courses, and you should find that out now rather
than in week six.

Read this before you commit a semester to it. Everything below is a description
of how the tool works today, not a list of bugs.

## The Website and the Exports Have Less Small Print

Their short list, in full:

- **Only `course/` is published.** The website and the exports read nothing
  else: `evaluations/` and `sources/` never leave your repository, which is the
  point of them.
- **One level of nesting.** A subfolder inside a module becomes a section
  heading; a folder one level deeper is dropped, with a warning naming it. The
  scanner enforces this for every output, not just Canvas; see
  [the folder structure is a contract](#the-folder-structure-is-a-contract).
- **Word gives up a few things PDF keeps.** SVG images need an extra converter,
  Word's table of contents starts empty until refreshed, and fonts must be
  installed on the machine that opens the document. The
  [DOCX degradations](export-styling.md#docx-degradations) list has all of it.

Everything else on this page is about the Canvas sync. That is where the
surprises live, because Canvas is the one output Coursewright does not build
from scratch on every run: it reconciles against a live course that other
people, and Canvas itself, can also change.

## Which Canvas Types Sync, and How Much of Them

Every type of item a Canvas module can hold crosses in both directions. What
differs is how much of it crosses.

| Canvas type               | Push | Pull | What crosses                                    |
| ------------------------- | ---- | ---- | ----------------------------------------------- |
| Page                      | yes  | yes  | the whole thing: title and body                 |
| Assignment                | yes  | yes  | title, body, and the fields listed below        |
| Discussion                | yes  | yes  | title, message body, and its posting settings   |
| File                      | yes  | yes  | the binary itself                               |
| External URL              | yes  | yes  | the link and its place in the module            |
| Quiz                      | yes  | yes  | a reference: which quiz sits where in a module  |
| External tool (LTI)       | yes  | yes  | a reference: the launch URL and its place       |
| Text header (`SubHeader`) | yes  | yes  | the heading, generated from your subfolder name |

Two of those rows are the ones to read twice. **A quiz and an LTI link are
references, not content.** The markdown file says which Canvas object goes where
in a module; it does not hold the object. Push never creates, updates or deletes
a quiz or an LTI tool, and pull writes a frontmatter-only file for either. A
page, an assignment and a discussion are the opposite: the markdown file _is_
the content, and pushing it rewrites what Canvas holds.

Push skips an unknown `canvas_type` with a warning; `npx course validate`
rejects one before you get that far.

Announcements, rubrics, outcomes, groups, the syllabus page and course settings
are outside the tool entirely: none of them is a module item, and modules are
what this tool reads and writes.

## Quiz Questions Never Sync

The quiz's place in a module syncs. Its questions do not, in either direction.

Nothing here writes to a quiz: no create, no update, no delete. Push reads the
course's quiz list to find the one a module item points at, places the item, and
stops. The [`/quiz-build`](ai-assistants.md) skill generates a QTI 1.2 `.zip`
that you import through the Canvas web interface by hand, and Canvas has no API
for that import, which is why it stays a manual step.

How push decides which quiz an item means:

1. The id on the item's row in `.canvas-sync.json`, when it has one. Push goes
   straight to it and never reads the quiz list at all.
2. Otherwise a quiz item already sitting in that module under the same title,
   which push claims for the file the way it claims any other object. See
   [Push reconciles a module's item list](#push-reconciles-a-modules-item-list).
3. Otherwise a quiz anywhere in the course whose **title** matches the item's
   title exactly. Push places the item and records the id it found on the row,
   so it only has to look once.

The two ways that search ends badly are refusals, not guesses, and both are
errors rather than skips: the action fails with its reason, the rest of the run
carries on, and the run exits non-zero.

- **No quiz by that title.** The error is the QTI import procedure, naming the
  `.zip` in `quiz_ref`, or, when the file names no `quiz_ref` either, saying
  there is no package to import and asking you to create the quiz under that
  title.
- **Two quizzes by that title.** The error names every id it found. A second
  import of the same package is the ordinary way to arrive here; delete the
  stale quiz in Canvas, or place the one you mean in the module by hand so push
  can claim it there.

Two edges are worth knowing:

- **`--dry-run` cannot tell you any of this.** Which quiz an item means is
  resolved while the item is written, and a dry run writes nothing, so it never
  reads the quiz list. A quiz item with no row is reported as one push would
  create, including when the quiz is not in the course and a real push would
  refuse it.
- **Pull refuses a quiz item that names no quiz.** A Canvas module item whose
  `content_id` is empty, which is what a deleted quiz leaves behind, would
  produce a reference file pointing at nothing. Pull writes no file and says so,
  rather than leaving one that looks synced and is never retried.

What that leaves you with:

- **Import is manual and one-way.** Nothing pulls a quiz back into markdown. A
  quiz pulled from Canvas becomes a reference file with no `quiz_ref`, and
  `validate` warns about exactly that, because a quiz with no local package is
  the one a rollover cannot rebuild.
- **Re-importing duplicates.** A second import creates a second quiz; delete the
  old one yourself, or push cannot tell them apart by title.
- **Six question types.** Multiple choice, multiple answers, true/false, short
  answer, numerical, and essay. Matching, ordering and hotspot questions have to
  be rephrased or downgraded.
- **QTI carries no dates or time limit.** Set availability and the time limit in
  Canvas after importing.

If your course leans heavily on Canvas quizzes, Coursewright carries their place
in the course and nothing else.

## An LTI Install Cannot Be Rebuilt from This Repository

An `external_tool` item is a launch URL in a module. Canvas resolves which
installed tool answers that URL every time a student clicks it, which is why the
item survives a rollover while a stored tool id would not: the URL still means
something in next year's course.

What does not survive is the installation itself. Canvas never returns an
external tool's `shared_secret` from the API, so a **course-level** LTI 1.1
install cannot be recreated from anything in this repository. Two ways round it:

- **Ask your Canvas admin to install the tool at account level.** A course
  resolves a tool by searching itself and then its account chain, so an
  account-level install is present in every course you will ever be given. This
  is the durable fix.
- **Seed the new course with Canvas's own Course Copy**, which carries the tool
  installation across. It is the only path that carries a course-level secret.

Canvas fails silently when a launch URL matches nothing: it accepts the item,
returns a 200, shows a normal-looking module item, and produces "Couldn't find
valid settings for this link" the first time a student clicks it. So push asks
Canvas first whether any installed tool claims the URL. When none does, push
warns, names the tools that _are_ installed, and creates the item anyway. A
visible broken item you can fix beats content dropped on the floor.

## Push Reconciles a Module's Item List

A push does not clear a module and rebuild its item list; it reconciles it: each
item is matched against what `.canvas-sync.json` recorded at the last sync, and
only what differs is written.

- **An item you added by hand in Canvas is adopted, not dropped.** Push looks
  for a local file of the same type and title. When it finds one, that file
  claims the Canvas object, and from then on it is an item like any other, with
  the file as the source of its content. When nothing matches, push leaves the
  item exactly where it is and names it in the report. A quiz you placed in the
  module, a discussion, an LTI link, a page that is not in your repository: all
  of them survive a push of the module they sit in.
- **An ambiguous adoption is refused.** Two local files, or two Canvas objects,
  sharing one type and one title, and push claims neither. It names them and
  asks you to retitle one, or to link them by hand in `.canvas-sync.json`.
- **Module item ids survive a push**, so a direct link of the form
  `/courses/123/modules/items/456` keeps working. An item whose local file moved
  to another module folder is moved on Canvas rather than recreated, and
  reordering a module sends new positions to the items already in it. One
  exception: a file item whose binary you renamed. Canvas keys an upload on the
  filename, so a new name is a new Canvas file, and the module item is recreated
  to point at it. The file it replaces is deleted, because nothing points at it
  any more and nothing else would ever clear it out. Push checks all three parts
  of that before it does: Canvas came back with a different file id, the name
  Canvas holds the old file under really did change, and no other row in
  `.canvas-sync.json` still names it. Miss any one and the old file stays where
  it is.
- **A text header is an ordinary item.** It is matched on its module item id
  like anything else, so one added by hand in Canvas is adopted or left alone by
  the same rules. Push never regenerates the set from your subfolder names.
- **A plain push deletes one thing on Canvas**, and only one: the file a renamed
  binary orphaned, above. Everything else is `push --prune-canvas`'s job, and
  even there the only candidate is an item the sync state already tracked and
  whose local file you deleted. Something push has never seen is never one. See
  [Destructive operations and student work](#destructive-operations-and-student-work)
  for what that flag reaches and what it costs.
- **An item you deleted by hand in Canvas is not recreated once Canvas stops
  listing its module item.** Deleting the object usually removes the item with
  it, though not always; while the item is still listed, the recovery in
  [A stale id on the sync row](troubleshooting.md#a-stale-id-on-the-sync-row-404-on-update)
  puts the object back by itself. Past that, the row in `.canvas-sync.json`
  names an object no run can see, so push writes nothing and names the item on
  every run: under `Orphaned locally` while the local file is unchanged, under
  `Needs a decision` once you have edited it. Putting a Canvas deletion back is
  not the tool's call to make.

The report names both routes out of that last case. Delete the local file, which
`sync --prune-local` does for you in the unchanged case; or take the item's row
out of `.canvas-sync.json` and push, which reads the file as new and creates a
fresh Canvas object under a new id. Check first that the object really is gone:
this tool reads a course through its modules, so one sitting outside every
module reads exactly like a deleted one, and pushing a row-less file at that
state gives you a second copy of it.
[Frontmatter reference](frontmatter.md#adopting-an-item-you-made-by-hand-in-canvas)
says what those rows hold and which objects a push cannot see.

One thing does hold part of a push back: an item of a type this version does not
recognise. The content and the membership of that module are still reconciled,
but its order is left exactly as it stands on both sides, because placing the
items around something the tool cannot identify would move it without knowing
what it is. The report names the type it did not understand.

Reconciling needs a sync state to tell a changed item from a new one. When
`.canvas-sync.json` links nothing in a module and both sides hold items, every
local item reads as new here and every Canvas item as new there, so writing both
would duplicate the module. That is the state a
[`reset-sync-state`](advanced-commands.md) leaves behind, and the one a first
run against a course that already has content starts from. `npx course sync` and
`npx course status` refuse that module rather than duplicate it, per module and
not for the whole course, so a module that is genuinely new on one side does not
trip it. Push and pull never hit the refusal: each pins a direction, which is
what the refusal asks for, and adoption pairs the two sides up from there.

## Destructive Operations and Student Work

Deleting on Canvas happens two ways: a prune (`push --prune-canvas` or
`sync --prune-canvas`) and `reset-canvas`. A plain push deletes one thing as
well, the Canvas file a renamed binary orphaned, but a file carries no grades,
so that case belongs above rather than here. What separates a prune from
`reset-canvas` is not how much they delete but which kind of object they delete,
and only one of those kinds takes student work with it.

- **Deleting a module item is safe.** A module item is a link. Removing it
  leaves the page, assignment or file it pointed at exactly where it was, with
  its gradebook column and its submissions untouched.
- **A quiz and an LTI link are only ever unlinked.** A prune and `reset-canvas`
  remove the module item for either one and stop there: the quiz, its questions
  and every submission on it stay in Canvas, and so does the LTI installation
  that other courses launch. Neither is this project's to delete.
- **A discussion is deleted like a page.** It is authored content here, so a
  prune deletes the topic itself when you delete its local file, and the replies
  go with it. `reset-canvas` leaves discussions alone.
- **Deleting an assignment is not.** A prune calls `DELETE` on the assignment
  object itself, and Canvas takes its gradebook column and every submission on
  it. Canvas's `/undelete` sometimes brings the assignment back; the submissions
  frequently do not come with it, so the grades are gone for good.
- **`reset-canvas` does that to every assignment in the course**, alongside
  every module, page and file (except the assignments that are really quizzes,
  below). See [Advanced commands](advanced-commands.md#reset-canvas).
- **Some assignments are quizzes.** A graded Classic Quiz is two objects: the
  quiz that holds the questions, and an assignment that holds its gradebook
  column. Canvas returns that assignment from the assignments API like any other
  (`is_quiz_assignment: true`, with the quiz's id in `quiz_id`), and a `DELETE`
  on it deletes the quiz, its questions and every submission. Neither command
  does that: `reset-canvas` skips those assignments and names them, and a prune
  refuses to delete one, reports it as an error, and leaves it tracked. If a
  local file claimed `canvas_type: assignment` for an id that Canvas holds as a
  quiz, that mismatch is yours to settle: delete the quiz in Canvas if that is
  what you meant. A practice quiz has no gradebook column and never appears
  among the assignments, so it is never at risk.
- **A New Quiz is not covered by any of that**, and cannot be: it is genuinely
  an assignment that launches an LTI tool (`is_quiz_lti_assignment: true`, no
  `quiz_id`, no separate quiz object), so this project manages it as the
  assignment it is, and a prune and `reset-canvas` delete it like one. That
  takes the quiz, its questions and every submission with it, and nothing in
  this repo could rebuild the questions: a New Quiz has no markdown source here
  the way an assignment body does. Both commands name each one they are about to
  delete, so a count of "n assignments" cannot hide it; see
  [What the warnings tell you](#what-the-warnings-tell-you).

Pages and files carry no grades, so pruning one costs you the content and
nothing else, recoverable from git, or from a course export.

One sweep sits out any run you narrow with `-m`. A prune also looks for embedded
binaries nothing points at any more: the `_files/` image or PDF you renamed, or
whose last reference you deleted, leaves its uploaded copy behind in the course
Files area, and `--prune-canvas` clears those out along with the items. On a
scoped run it does not, and it does not list them either, because "no item
references this file" is a question about the whole course and `-m` is you
saying which modules this run may touch: a Canvas file belonging to a module you
did not name is not that run's to delete, and a shared binary under the root
`course/_files/` belongs to no module at all, which is the same answer taken
further. Run the prune over the whole course when you want the orphaned binaries
gone.

### Deleting a Module Folder Is Safer Than Deleting an Assignment File

The asymmetry runs the wrong way round from what you would expect:

- **Delete a whole module folder**, and prune deletes the Canvas _module_. The
  module and its item links go; the pages, assignments and files that were in it
  stay in the course, unlinked but intact, gradebook columns and submissions
  included. Prune looks for missing items only inside module folders that still
  exist, so nothing inside a folder you deleted is ever considered for deletion.
- **Delete one assignment file** from a module that still exists, and prune sees
  an item no local file claims. That is a `DELETE` on the assignment object, and
  the grades go with it.

Removing the bigger thing is the safer move. What deleting a module folder costs
you instead is orphans: assignments and pages no module links to any more. The
tool does not forget them. The sync state keeps its row for the module and for
every item that was in it, so each is named under `Orphaned on Canvas` on every
run until you deal with it, and a prune can reach the module. What a prune
removes is the module, not the pages behind it, so the unlinked content is still
yours to clear out in Canvas.

### Fields That Move Grades Already Given

Push sends the whole assignment on every update, and three of the fields it
sends act on work students have already handed in. Canvas applies each one
silently: its web editor warns about them, its API does not.

- **`points_possible`**: Canvas does not rescale the grades already given. The
  raw scores stay as they are, so every percentage in that gradebook column
  moves.
- **`due_at`**: Canvas recomputes late status against the new date, so an
  automatic late policy re-applies or drops its deductions on submissions that
  are already graded.
- **`submission_types`**: Canvas accepts this change only while the assignment
  has no submissions. Once there are any it ignores the change, reports the push
  as a success, and keeps the value it holds. Frontmatter and Canvas disagree
  from then on, and nothing but the warning says so.

Push names the assignment, the field and both values, and then sends the update
anyway. Nothing is blocked: a re-weighting can be entirely deliberate, and only
you know which one this is.

### What the Warnings Tell You

Before it deletes anything that can hold grades, the tool asks Canvas whether
that content already holds student work:

- **`push --prune-canvas`** flags each doomed assignment in its listing
  (`<-- HAS STUDENT SUBMISSIONS: deletes the gradebook column and every grade in it`),
  counts them in a warning, and names them in the question itself:
  `[push] Delete these from Canvas, including the student submissions and grades? (y/N)`.
- **A graded discussion is checked the same way.** Canvas puts an assignment
  behind the topic and the grades live on that assignment, not on the topic, so
  prune fetches the topic, resolves the assignment behind it and flags the item:
  `<-- GRADED DISCUSSION WITH STUDENT WORK: deletes the topic and its 14 replies, plus the gradebook column and every grade`.
  Once a discussion is in the count, the summary line counts "items" instead of
  "assignments", because it is no longer counting one type.
- **An ungraded discussion is flagged for its replies.** No grades are at stake,
  but deleting the topic still deletes everything students wrote in it, so a
  topic with replies in it is never listed as a bare path:
  `<-- 14 REPLIES FROM STUDENTS: no grades at stake, and deleting the topic still deletes every one of them`.
  An empty topic is listed plainly.
- **A New Quiz is flagged for its questions**, which go with it and which
  nothing here could write again, so the item never reads as an ordinary path:
  `<-- NEW QUIZ: deletes the quiz and its questions, which nothing here could rebuild`,
  or, once students have handed work in,
  `<-- NEW QUIZ WITH STUDENT SUBMISSIONS: deletes the quiz, its questions and every submission and grade on it; nothing here could rebuild the questions`.
  It gets a warning line of its own, ahead of the submission counts:
  `WARNING: 1 assignment being deleted is a New Quiz. Deleting it deletes the quiz, its questions and every submission on it, and nothing here could rebuild the questions.`
  The question says it too:
  `[push] Delete these from Canvas, including the questions of a New Quiz and the student submissions and grades? (y/N)`.
- **`reset-canvas`** prints the same warning and lists the assignments by name,
  plus any New Quiz among them.
  [Advanced commands](advanced-commands.md#reset-canvas) shows the full output.
- **`push`** prints one warning per changed field for each of the three fields
  above, including under `--dry-run`, the only mode where the warning arrives
  before the change rather than with it.

One limit on all of that. A check that fails is reported as unknown, never as
safe (`SUBMISSION STATUS UNKNOWN`, or "could not determine whether 1 item being
deleted has student submissions"), and silence from a failed check is not a
clean bill of health, so treat an unknown as a yes. A topic that says it is
graded but whose assignment Canvas does not list counts as unknown for the same
reason. The same call is what says an item is a New Quiz, so an unknown covers
that too: the questions may be going as well. Take a course export first.

All of the above is about Canvas. The tool can also destroy local work: `pull`
overwrites whole files, `pull --prune-local` deletes the ones Canvas no longer
has, and `pull --force` does either over a file that holds uncommitted work. See
[Push and pull are not a merge](#push-and-pull-are-not-a-merge).

## The Folder Structure Is a Contract

The scanner is strict, and quiet about most of it:

- **Only top-level directories under `course/` are modules.** Loose markdown at
  the root of `course/` is ignored, including `course/index.md`, which is why
  that file appears on the website but never in Canvas.
- **One level of nesting, and one only.** A subfolder inside a module becomes a
  text header. A folder inside _that_ is **dropped**, along with everything in
  it. The drop is announced, not silent: `sync`, `push`, `pull`, `status`,
  `validate`, `search`, `export` and `export-toc` each name the folder once per
  run and say what to do about it.

  ```
  [warn] Skipping 01-intro/02-basics/03-deep/ and everything in it: a module takes one level of subfolders and this is one deeper. Move its files into 01-intro/02-basics/, or make it a subfolder of 01-intro/.
  ```

  A folder prefixed with `_` at that depth is internal by design and says
  nothing. The warning is the whole of the change: the folder is still dropped,
  and `validate` does not count it among the warnings it tallies at the end.

- **Numeric prefixes drive order.** A file or folder without a `NN-` prefix gets
  position 0, so it sorts first and ties with every other unprefixed sibling in
  whatever order the filesystem returns. `validate` warns, but push proceeds.
  The module-management commands are stricter than push: an unprefixed module
  folder is invisible to `new-item`, `move-module`, `rename-module`,
  `delete-module` and the VS Code sidebar, while push still syncs it.
- **A leading underscore or dot hides a path from the scanner, not from sync.**
  `_files/`, `_category_.json` and anything else you prefix with `_` is never
  read as a module item, handy for drafts and easy to trip over; `.DS_Store` and
  its kin are skipped the same way, so Finder cannot plant a phantom file item
  in a module. Neither prefix makes a private corner of the tree: sync and pull
  write the Canvas module name into `_category_.json` and download the binaries
  a Canvas page embeds into `_files/`. Both writes stop at a file git reports as
  holding uncommitted work, which is why a pull sometimes refuses to touch a
  `_category_.json` it would otherwise have relabelled.
- **Canvas item indent is 0 or 1.** Canvas supports five levels; this tool uses
  two.

See [User guide](user-guide.md#course-structure) for the layout the scanner
expects.

## Two Identical Files Can Trade Places with a Deleted One

A curiosity rather than a fault, and worth knowing only because it looks like a
bug when you meet it.

Renames are detected by content. A path the sync state knows that has no file
any more, paired with a new file whose bytes hash identically, is read as that
item having moved, and the row is re-keyed without asking. That is what makes a
rename in Finder, or one arriving with a merge, cost nothing.

The row of a deleted item stays behind on purpose, so that the Canvas object it
names can be reported and pruned. Those two facts meet in one narrow case.
Delete an item, then create another whose file is **byte-identical** to the
deleted one, and the new file is taken for the old one moved. It adopts the
Canvas object, which moves to the new item's module, and the deleted item is
never offered for pruning.

Real content never collides this way, because two pages a person wrote are not
identical to the byte. `npx course new-item` is the exception: it writes a
deterministic stub, so two untouched stubs of the same type and title are the
same file. Delete one you never filled in, create one like it elsewhere, and
this is what you get.

What you end up with is one Canvas page in the module you wanted, carrying the
content you eventually write, under the older page's id and URL. Nothing is lost
and nothing is duplicated; the run says `1 item moved` where you expected
`1 item created`, and the id is not the one you would have guessed. Writing
anything into either file before the next run avoids it entirely.

The sync state cannot do better here. A row whose file is gone looks the same
whether the file was deleted or moved, and nothing records which happened.

## Push and Pull Are Not a Merge

A run settles an item by choosing a side and writing that copy whole. Nothing
here blends two versions of one page, and nothing can: `.canvas-sync.json` holds
a fingerprint of each side rather than its text, so there is no stored ancestor
to merge against even in principle.

- **Pull overwrites whole files.** It regenerates the markdown from the Canvas
  object rather than merging your changes into it, and push is the mirror image:
  it sends the whole page, assignment or discussion. Whichever side loses an
  item loses its version of that item entirely.
- **What changed is decided by content, not by a timestamp.** Each side is
  compared against the fingerprint the last sync recorded for it, which is what
  separates "changed here" from "changed there" and both from "changed on both
  sides", and is why a fresh `git clone` reads as unchanged. The one timestamp
  still read is the `newest` tiebreak, for an authored item both sides changed;
  an item Canvas keeps no timestamp on falls to your copy with a reason saying
  so. Push and pull never reach any of it, because pinning a direction has
  already answered that question. See
  [The reconcile engine](architecture.md#the-reconcile-engine).
- **A file holding uncommitted work is never overwritten and never deleted.** A
  single `git status` covers the whole run, and any file it reports as modified
  or untracked is left exactly as it is, named in the report with the reason it
  was left. Where git cannot answer at all, outside a checkout or wherever `git`
  will not run, every file on disk reads as dirty and a pull writes nothing.
  `pull --force` is the one lever that switches the guard off, for overwrites
  and deletes alike, and it asks before it does. Commit before you reach for it:
  git is the undo this tool is built around.
- **With no sync state, pull adopts rather than skips.** Right after a
  [`reset-sync-state`](advanced-commands.md), or on a clone that has never
  synced, no fingerprint is recorded for anything. Pull pairs each local file
  with the Canvas object of the same type and title, writes Canvas's version
  into the file it matched, and ties the two together from then on. That is how
  the tool takes over a course it did not create, and it is also why a first
  pull onto a tree you have already written is a rewrite of it. The git guard
  above is what stands between those two outcomes.
- **The round trip is lossy.** Canvas HTML becomes markdown through a converter.
  Raw HTML, anything the Canvas rich-content editor added, and formatting
  nuances are normalised away.
- **An alert written as `[!CAUTION]` comes back as `[!ATTENTION]`.** The two
  spellings are one alert type: both are accepted and render identically, but
  the HTML carries only the one kind, and a pull writes it back in this
  project's spelling. See [Custom alerts](markdown.md#custom-alerts).
- **A URL written with `&amp;` comes back written with `&`.** The two spellings
  are one URL to CommonMark and reach Canvas as the same link, but a pull reads
  the address back off the attribute with a real HTML parser and writes the
  decoded spelling; the file settles on it after the first pull and stays there.
  The same goes for an image's alt text and a link's title. What this rules out
  is an address meant to carry the six characters `&amp;` as text, because every
  cycle resolves one level of it: `&amp;amp;` becomes `&amp;` becomes `&`.
- **A file referenced from raw HTML is neither uploaded nor rewritten.** An
  `<img src="_files/diagram.png">`, `<a href="_files/handout.pdf">` or
  `<video src="_files/clip.mp4">` written as an HTML tag in your markdown
  reaches Canvas exactly as you typed it, pointing at a relative path that does
  not exist there. Only inline markdown references
  (`![alt](_files/diagram.png)`, `[text](_files/handout.pdf)`) are uploaded and
  repointed at the Canvas file. Write the reference in markdown syntax;
  `npx course validate` warns about the attribute each embedding tag names its
  file with: `src` on `img`, `video`, `audio`, `source`, `iframe` and `embed`,
  `href` on `a`, and `data` on `object`. A path written in another attribute
  (`srcset`, `poster`) or on a `<track>` tag is just as dead on Canvas and is
  not warned about.
- **A file referenced through a link definition is not uploaded either.**
  `![diagram][d]` with `[d]: _files/diagram.png` further down the page renders
  locally, but push reads inline destinations only, so the file is never
  uploaded and the image reaches Canvas pointing at the relative path. Write the
  destination inline (`![diagram](_files/diagram.png)`); `npx course validate`
  warns about a definition whose destination points into `_files/`.
- **A file embedded from another course becomes this course's.** Content copied
  over from another Canvas course can keep file URLs that point at the source
  course, links students of this course cannot always open. Pull downloads such
  a binary into `_files/` and warns, but records it nowhere, because the id in
  that URL belongs to a course this one cannot vouch for. The next push of the
  page that embeds it uploads the file into this course and takes ownership,
  rather than leaving the embed pointing across courses.
- **A pull never decides a file is shared.** Push, the preview and the exports
  all resolve a binary under the root `course/_files/`
  ([Shared Files](markdown.md#shared-files)), but a binary a page embeds that
  pull first meets on Canvas is always downloaded into the referencing module's
  own `_files/`, because pull cannot know the file is meant to be shared. One
  that already has a row is preserved: later pulls link every page to it rather
  than downloading a second copy. To share a file pull brought down, move it
  under `course/_files/` and repoint the references yourself.
- **A pull keeps a file item's `file_ref` only when it points into a `_files/`
  folder.** A `file_ref` into any `_files/` folder under `course/` stays as you
  wrote it, and the binary is downloaded onto the path it names: the module's
  own `_files/`, the shared `course/_files/`, or, from a subfolder, the module's
  `_files/` as `../_files/pack.md`. The filename is yours too, so a file renamed
  in Canvas still lands under the name the wrapper gives it. Any other
  `file_ref`, one that leaves `course/` or names a path outside every `_files/`
  folder, is not followed, because the bytes come from Canvas and could land
  over a page. The binary goes into the `_files/` beside the wrapper instead,
  under the Canvas file's name, and the wrapper is rewritten with
  `file_ref: _files/<name>`. For a wrapper in a subfolder that is the
  subfolder's own `_files/`, not the module's. A file item first met on Canvas
  has no `file_ref` to keep, so its binary lands there too.
- **Pull does not rename your files.** A Canvas title lands in the file's
  frontmatter as `title:` and a Canvas module name lands in the folder's
  `_category_.json`, while the filename stays as you wrote it, because that path
  is the key of the item's row. The numeric prefix is the one exception, because
  it _is_ the local order: a module reordered in Canvas has the files in that
  folder renumbered to match.
- **A plain pull deletes nothing.** `pull --prune-local` does, and only ever an
  item the sync state already tracked whose Canvas object is gone. A file the
  tool has never seen has no row, so it is never a candidate, and a module
  folder is left alone while it still holds local changes that need a decision
  first.

`npx course status` is the command for "what would this do": it reads both
sides, writes to neither, and names who would win each item. Every writing
command takes `--dry-run` for the same question under one pinned policy.

## Which Fields Reach Canvas

Push sends `points_possible`, `submission_types`, `due_at`, `unlock_at`,
`lock_at` and `published`. Everything else in an assignment's frontmatter is
ignored: group assignments, peer review, allowed attempts, grading type,
assignment groups, and Canvas's per-section date overrides all have to be set in
Canvas.

Pages take only their title and body. A `published:` key on a page is ignored:
push never sends it, so Canvas decides, and you publish pages in Canvas or by
publishing the module.

Discussions take their title, their message body, `discussion_type`,
`require_initial_post`, `delayed_post_at`, `lock_at` and `published`. **A graded
discussion keeps its grading in Canvas only.** Points, due date, grading type
and group set belong to the assignment Canvas puts behind the topic, which this
tool never touches: they appear nowhere in the markdown, and changing them
locally changes nothing. Push and pull both say so when they meet a graded
topic. Set them in Canvas.

See [Frontmatter reference](frontmatter.md) for the fields each type accepts.

## Not a Collaboration Tool

Collaboration here is git collaboration. Two colleagues can share the
repository, branch and review each other's changes, and the website and the
exports rebuild from whatever is merged; what does not exist is real-time
co-editing, or an in-browser editor for a colleague who will not touch git. On
the Canvas side the assumption is stronger: one person owns the markdown. There
is no locking, and if you both push to the same Canvas course, the last push
wins. Sort out who owns which module the way you would sort out who owns which
file.

## What to Do Instead

- **Quiz-heavy course?** Build the quizzes in Canvas, by hand or from a QTI
  package, and keep a one-file reference here for each so they hold their place
  in the module. Everything about the questions stays a Canvas job, every year.
- **Course that lives in Canvas already, edited by several people in the web
  editor?** This tool will fight you. It wants to be the source of truth.
- **Just want version control for your handouts?** Use the repository and the
  PDF export, and skip the Canvas sync entirely.
