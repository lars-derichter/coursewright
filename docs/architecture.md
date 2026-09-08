# Architecture

Technical overview of how the sync system works.

## Three Layers

```
course/  (markdown)
   |
   +--> Docusaurus (local preview)
   |
   +--> Canvas API (push/pull)
```

1. **Markdown source**: `course/` contains numbered folders (modules) with
   numbered markdown files (items). Frontmatter defines the Canvas type and
   metadata.

2. **Docusaurus**: serves the same `course/` directory as a static site. No
   transformation needed: relative links and images work natively.

3. **Canvas sync**: the CLI converts markdown to HTML (push) or HTML to markdown
   (pull) and communicates with the Canvas REST API.

## Course Configuration

All three layers read `course.config.yml` at the project root through
`lib/config/course-config.js`, which resolves the course title and tagline, and
the course language plus optional per-label overrides against the built-in label
sets in `lib/config/labels.js`. A missing file means English, and an unset title
falls back to that language's `export.course_title` label. The CLI loads it for
push (alert titles), pull (the untitled fallback), export (metadata labels,
document language, default titles) and the glossary builder;
`docusaurus.config.js` loads it for the site title and navbar, the tagline, the
site locale and the remark plugin labels.

## Sync State

`.canvas-sync.json` is where a local file's Canvas identity lives. It is
committed rather than gitignored, and no markdown file carries a `canvas_id`, so
a push or a pull leaves a change here to commit alongside the content that
caused it. Being committed is also how it stops being readable: a merge left
half-finished puts conflict markers in it. A file that is there and cannot be
parsed refuses the run rather than passing for a course that was never synced,
and the refusal says when it found those markers.

```json
{
  "schema_version": 4,
  "canvas_base_url": "https://school.instructure.com",
  "course_id": 12345,
  "last_sync": "2026-08-19T10:00:00.000Z",
  "modules": {
    "01-introduction": {
      "canvas_module_id": 67890,
      "name": "Introduction",
      "position": 1,
      "item_order": [
        "01-introduction/01-welcome.md",
        "01-introduction/02-link.md"
      ],
      "items": {
        "01-introduction/01-welcome.md": {
          "canvas_type": "page",
          "canvas_id": 1234,
          "page_url": "welcome",
          "module_item_id": 5678,
          "title": "Welcome",
          "indent": 0,
          "local_hash": "sha256...",
          "canvas_hash": "sha256...",
          "canvas_updated_at": "2026-08-19T09:59:00.000Z",
          "synced_at": "2026-08-19T10:00:00.000Z"
        },
        "01-introduction/02-link.md": {
          "canvas_type": "external_url",
          "canvas_id": 555,
          "module_item_id": 555,
          "external_url": "https://example.com",
          "title": "Example",
          "indent": 0,
          "local_hash": "sha256...",
          "canvas_hash": "sha256...",
          "canvas_updated_at": null,
          "synced_at": "2026-08-19T10:00:00.000Z"
        }
      }
    }
  },
  "icons": {
    "note": {
      "canvas_file_id": 111,
      "preview_url": "https://school.instructure.com/courses/12345/files/111/preview",
      "theme": "sha256..."
    }
  },
  "files": {
    "01-introduction/_files/diagram.png": {
      "canvas_file_id": 222,
      "canvas_url": "/courses/12345/files/222/preview",
      "sha256": "9f2c..."
    }
  }
}
```

Key properties:

- **canvas_base_url**: the Canvas host, with no `/api/v1` suffix and no trailing
  slash. `normaliseBaseUrl` in `lib/canvas/client.js` puts both this value and
  the one in `.env` into that shape, so the two can differ by punctuation and
  still agree.
- **modules**: keyed by the local folder name; the Canvas module id is a value
  under it. `item_order` is the order the module's items were in at the last
  sync, and it is the base leg of the three-way ordering comparison, so a
  renamed item keeps its slot instead of moving to the end, where it would read
  as a reorder nobody made.
- **items**: keyed by the item's path under `course/`, with forward slashes on
  every platform and always beginning with its module's folder name. Path as
  key, Canvas ids as values. Keying on the path is what makes a committed file
  legible to the person who owns it: you can open it, recognise your own course
  in it, and repair a row by hand. A key written with the `course/` prefix
  matches nothing and fails silently. Renames do not orphan a row: every command
  that renames re-keys as it goes, and one made by hand is picked up by
  `lib/sync/rename-detect.js`.
- **local_hash / canvas_hash**: what each side looked like at the last sync.
  They are never compared to each other, only each against its own stored value,
  which is how the engine tells "changed here" from "changed there".
- **icons**, one entry per alert type: the Canvas file id, the preview URL the
  HTML converter embeds, and a fingerprint of the theme the SVG was painted in,
  so a theme change re-uploads the icons and an unchanged theme does not.
- **files**: one row per embedded binary (an image, a PDF) with its Canvas file
  id and URL and a SHA-256 of its content, so a changed file is re-uploaded and
  an unchanged one is not. A key normally opens with its module folder; one for
  a shared binary under the root `course/_files/` carries no module segment, and
  its upload goes into a Canvas `shared/` folder mirroring the tree under
  `course/_files/`, taken from the file's own path so every push resolves the
  same destination. A row vouches that the file lives in this course, so a pull
  that meets a file embedded from another course downloads the binary without
  writing one; the next push of the embedding page uploads the file into this
  course and records it then.
- **last_sync**: stamped at the end of any `sync`, `push` or `pull` that ran to
  completion, including one that found nothing to do. A `--dry-run` and a
  `status` never write it, and a run that stopped before the end leaves the
  value the last completed one left. Nothing reads it, and no decision depends
  on it. The only timestamps a decision reads are the file's mtime and Canvas's
  `updated_at`, and only to break a tie when both sides of an item changed.
- **schema_version**: the loader reads version 4 only. A file carrying any other
  version is refused with an error rather than guessed at, because misreading
  the mapping would create duplicates on Canvas; rebuild with
  [`reset-sync-state`](advanced-commands.md) and push again.

### Prune Semantics

`push --prune-canvas` deletes a Canvas resource only when the sync state already
tracked it and the local file it was tracked under is gone. Prune candidates are
base rows the planner paired with a Canvas item that has no local counterpart,
which is why something push has never seen is never one: a page, a quiz or an
LTI link added by hand in Canvas is adopted or left where it is, never deleted.
Frontmatter has no say in it, because no markdown file carries an identity to
claim with.

An item that moved to another module is a move rather than a deletion. Rename
detection runs over the whole course before the `--module` filter narrows
anything, so a row follows its file even into a module this run was not asked to
touch.

Pruning a `file` item has one more check in it. Canvas deduplicates uploads, so
the Canvas file behind a wrapper can be the same file a page embeds or a second
wrapper names. Prune deletes the file only when no other row in
`.canvas-sync.json` still holds its id (the same `fileStillReferenced` sweep
every file delete in `lib/sync/apply.js` runs), and otherwise removes only the
module item, naming the row that kept the file in the verbose log.

Before it asks for confirmation, prune checks whether the items on its list
already hold student submissions, because deleting an assignment or a graded
discussion takes its gradebook column and every grade in it. The plan's delete
actions carry Canvas ids and nothing about student work, so
`cli/prune-warning.js` reads `has_submitted_submissions` off a single
`listAssignments` call for the course rather than fetching each assignment. A
discussion needs one step more: its own id is a DiscussionTopic id, which that
list is not keyed by, so each doomed topic is fetched to find out whether it is
graded and, if it is, which assignment holds its grades. The fetch also yields
the reply count, which goes in the listing because deleting a topic deletes
every reply in it whether it is graded or not. No assignment and no graded
discussion on the list means no lookups at all. An item with submissions is
flagged in the listing and named in the confirmation question; a lookup that
fails is reported as "could not determine", never as "no submissions".

## Content Types

`canvas_type` in a file's frontmatter decides which of two contracts the file is
under. `VALID_CANVAS_TYPES` in `cli/validate.js` is the authoritative set.

**Authored content**: `page`, `assignment`, `discussion`, `file`. The local file
is the source of truth. Push creates or updates the Canvas object and overwrites
what it held; prune deletes the object. The three markdown types share one code
path, `writeContent` in `lib/sync/apply.js`, parameterised by a strategy object
(`pageStrategy`, `assignmentStrategy`, `discussionStrategy` in
`lib/sync/canvas-write.js`), which supplies the create and update calls, the
fields to send, and how to read the id and the slug back out of the response.

**References**: `quiz`, `external_tool`, and `external_url`. The file records
which Canvas object belongs at this position; the object itself is out of scope.
Push creates the module item and nothing else. Prune and `reset-canvas` remove
the module item and never the object behind it.

- `quiz` resolves through the id on its sync-state row while the course still
  lists that quiz, and by an exact title match against `listQuizzes` otherwise.
  The id it finds is recorded on the row, never written into the file. A quiz
  that matches nothing throws with the QTI import procedure in the message, and
  two quizzes under one title throw as ambiguous. Neither is skipped: a silent
  skip would report an item the run had not created and still exit zero.
  `lib/canvas/quizzes.js` deliberately exposes a read call only, so no code path
  can write to a quiz.
- `external_tool` is identified by its launch URL, not by `content_id`. Canvas
  resolves the tool through `Lti::ToolFinder.from_url` on every launch, and
  substitutes a dummy tool with `id = 0` when nothing matches, saving the item
  with a 200 and no error. `findToolForUrl` in `lib/canvas/external-tools.js`
  runs the same finder ahead of time through the sessionless-launch endpoint,
  and reports `resolves`, `no-match`, or `unknown`. A failed probe is never read
  as a match or as a miss.
- `external_url` is a plain link. It exists only as a module item, with no
  Canvas object behind it, so its module item id is its whole identity, and that
  id survives a push, because the item list is reconciled rather than rebuilt.

Pull writes both kinds. For authored content it converts the Canvas HTML body;
for a reference it writes frontmatter only, with no API fetch at all.
`CANVAS_OWNED_KEYS` in `lib/convert/html-to-markdown.js` lists, per type, the
keys Canvas is authoritative for: those are taken from the Canvas item every
time, including when Canvas has no value (so a cleared due date clears locally),
while every other key in the local file is preserved verbatim. `quiz_ref` is the
clearest case: Canvas has never heard of the QTI package, so the key belongs to
the author and has to survive every pull.

## The Reconcile Engine

`sync`, `push`, `pull` and `status` are one engine with a policy each. There is
no separate push algorithm and no separate pull algorithm. The engine lives in
`lib/sync/` and runs in three stages:

1. **Gather** (`gather.js`). `gatherLocal` scans `course/` through
   `lib/convert/course-scanner.js` and fingerprints what it finds.
   `gatherCanvas` reads the course's modules and items and fingerprints those,
   fetching a body only where a fingerprint genuinely needs one. `gitDirtyPaths`
   runs one `git status` for the whole run. Every file read and every Canvas
   request a sync makes happens here, which is what puts the request budget of a
   run in one place rather than letting it emerge from a call graph.
2. **Plan** (`plan.js`). One pure function of four arguments: base, local,
   canvas and policy. No `fs`, no `fetch`, no clock, no randomness. It hands
   back the actions in execution order, plus one section per row of the report:
   conflicts, adoptions, orphans, decisions, refusals, pending questions, and
   the writes the policy withheld.
3. **Apply** (`apply.js`). Executes the actions, recording a fresh fingerprint
   for both sides after every write. `canvas-write.js` and `local-write.js` hold
   the per-type writes for each side.

`cli/sync.js`, `cli/push.js`, `cli/pull.js` and `cli/status.js` set a policy,
ask the questions the planner parked, and print the report `cli/report.js`
renders for all four. They decide nothing else, which is why the four commands
agree with each other by construction instead of by four implementations
happening to match.

| Command  | Writes Canvas | Writes `course/` | Both sides changed    | Adopts |
| -------- | ------------- | ---------------- | --------------------- | ------ |
| `sync`   | yes           | yes              | newest (`--conflict`) | no     |
| `push`   | yes           | no               | local wins            | local  |
| `pull`   | no            | yes              | Canvas wins           | Canvas |
| `status` | no            | no               | newest wins           | no     |

A write the policy forbids is never emitted as an action, but it is always
recorded in `withheld`, so a push can say "Canvas changed here and I left it
alone" rather than losing the fact. `status` is not a separate code path: it is
the same plan with both write flags off, which leaves the action list empty and
every report section full.

### Three Inputs, Not Two

The third input is the one that does the work: the sync state as the last run
left it. Comparing the working tree against Canvas can only say that the two
differ. Comparing each of them against the state at the last sync says which one
moved, and "changed here", "changed there", "changed on both sides" and "deleted
here" are four different questions with four different answers.

An item with no base row at all is a fifth case: new on the side it is on. That
can be true of a whole module on both sides at once, after a
[`reset-sync-state`](advanced-commands.md) or on a first run against a course
that already holds a copy, and reconciling it would create a second copy of
everything and duplicate the module. `detectCollisions` refuses that module
instead, per module and never for the whole course, so a module that is
genuinely new on one side does not trip it. A pinned direction is the answer the
refusal asks for, so `push` and `pull` never reach it.

### Two Fingerprints, Never Compared to Each Other

`fingerprint.js` gives every synced item a `local_hash` and a `canvas_hash`, and
each side is compared only against its own stored value. The two are computed
from different things (a file's bytes on one side, a canonical JSON of Canvas
fields on the other), so comparing them to each other is meaningless and always
will be. Canvas rewrites markup it is handed, which is why `canvas_hash` is
taken from the response to a write and never from what was sent: hash the
request and every later run reports a remote change nobody made.

Neither hash reads an mtime, so both survive a `git clone`, which stamps every
file it checks out with the checkout time. An mtime-based comparison would read
a fresh clone as an entirely modified course.

One decision still reads an mtime, and only one: the `newest` tiebreak. It has
two timestamps to compare only for an item of an authored type where both hashes
moved. A module name renamed on both sides, a reference, and a text header reach
the same policy with nothing to compare, because Canvas keeps no timestamp on
any of them; each falls to local with a reason naming what is untimed rather
than blaming Canvas for bad data. A Canvas `updated_at` that is missing or
unparseable gives it to local, and so does a tie, because of the two possible
mistakes pushing over a remote edit is the one git can undo.

### Adoption, Not Duplication

Under a pinned direction, `planAdoptions` pairs the items neither side has a
base row for by type and title, so a Canvas object already sitting in the module
is claimed by the local file that matches it rather than copied beside it. Types
have to match exactly. A local page does not adopt a Canvas assignment of the
same name: that is a conversion, and this tool cannot do one. A title carried by
two items on either side is ambiguous, so nothing is adopted for it and the
report names them. Everything else in the module is left exactly where it is: a
quiz you placed by hand, a page that is not in your repository, an LTI link. See
[Push reconciles a module's item list](limitations.md#push-reconciles-a-modules-item-list)
for what that means item by item.

Text headers are ordinary items here. They carry a `sub_header` fingerprint over
their title and indent (`subHeaderHash` in `gather.js`), so one added in Canvas
is adopted or left alone by the same rules as anything else; the set is never
regenerated wholesale from your subfolder names.

### Asking Without Blocking

The planner never prompts and never touches the network, and `--conflict ask` is
not an exception to that. A conflict it may not settle on its own lands in
`pending.conflicts` and produces no action; the command asks the author and then
calls `plan()` a second time with the answer in `policy.resolved`. The same goes
for a contested order, keyed by module folder, and for a probable rename, keyed
by the path it came from.

Re-planning is free, because nothing is fetched again. It also means the answer
is applied to the same course it was asked about, rather than to a state that
moved on while the terminal waited.

### What a Run Writes into Your Tree

Pull writes files, and it never renames them. A Canvas title lands in the file's
frontmatter as `title:`, a Canvas module name lands in the folder's
`_category_.json`, and the filename stays as you left it. The one thing that
still moves is the numeric prefix, which _is_ the local order: a Canvas-side
reorder is a `reorder-local-module`, and it renames through temporary names one
depth at a time, because a reorder routinely moves two files into each other's
slots. `plan.js` has seven local action types in total: create, update and
delete for an item, the same three for a module, and that reorder. No local move
and no local rename among them.

Push writes to Canvas, and the only thing it ever puts into a file is a `title:`
line, spliced in as text on an item it created or adopted that declares none. No
file is given a `canvas_id`, ever: identity lives in `.canvas-sync.json`, and
because `canvas_id` counts as a Canvas-owned frontmatter key, a stale one is
dropped on the next pull.

Push still makes a second pass for links. An item whose markdown links to a page
this run had not created yet is pushed with that link unresolved, and
`resolvePendingLinks` rewrites it once everything exists, re-recording the
fingerprint, because a row describing the unresolved version would have every
later sync see a Canvas-side change nobody made.

### Refusals

A refusal is not a failure of the tool; it is the tool declining to destroy
something. Three of them matter:

- **Uncommitted local work.** `guardDirty` refuses any write into the working
  tree over a file `git status` reports as modified or untracked, because git is
  the only copy of what is in it. Where git cannot answer at all (outside a
  checkout, or wherever `git` will not run) every file already on disk reads as
  dirty and a pull writes nothing. `pull --force` is the one lever that switches
  the guard off, for overwrites and deletes alike, and it asks first whenever
  there is a guarded file for it to override.
- **A module that cannot be reconciled.** `detectCollisions`, above.
- **An item that cannot be placed.** A `quiz` whose title matches no quiz in the
  course throws, and so does one whose title matches two. Neither is skipped.

A refusal costs that item or that module and nothing else. The run carries on
with the rest, lists what it refused and why, and exits non-zero.

## Link Resolution

Bidirectional link resolution happens in `lib/convert/link-resolver.js`:

**Push (relative -> Canvas URL):**

- Input: `../02-setup/01-install.md#requirements`
- Resolves via: sync state maps relative path to canvas_id
- Output: `/courses/12345/pages/install#requirements`

**Pull (Canvas URL -> relative):**

- Input: `/courses/12345/pages/install#requirements`
- Resolves via: reverse map from canvas_id to relative path
- Output: `../02-setup/01-install.md#requirements`

Fragment identifiers (`#section`) are preserved in both directions. External
URLs, fragment-only links, and non-`.md` links pass through unchanged.

## Content Conversion

**Markdown to HTML** (`lib/convert/markdown-to-html.js`):

- Strips YAML frontmatter
- Uses `marked` with GFM extensions
- `marked-alert` handles `> [!NOTE]` etc. `[!ATTENTION]`, this project's
  spelling of GitHub's `[!CAUTION]`, is rewritten to it in the source before
  parsing. That is the one rewrite here that works on text rather than on
  tokens, so it runs through `replaceOutsideCode`
  (`lib/convert/link-resolver.js`) and skips fenced blocks and inline code: a
  lesson that documents the alert syntax keeps saying what its author wrote
- Custom renderer produces inline-styled alert HTML with Canvas-hosted SVG
  icons. The icon is decorative and carries an empty `alt`: the alert's title
  says the same thing in words, right beside it
- Custom table renderers style a pipe table inline, from the theme's
  `--cw-border` and `--cw-surface-subtle`: collapsed borders, a border and
  padding on every cell, a filled header row with a heavier rule under it, and a
  stripe on every second body row, which is what the preview site draws from the
  same two tokens. Column alignment stays the `align` attribute `marked` already
  emits and never becomes a `text-align` in the style, because a pull reads
  either one as the column's alignment and would write a `:---` under every
  column of a table nobody aligned
- Custom link/image renderers resolve internal references
- Every outside value the converter interpolates is HTML-escaped, in an
  attribute and in element content alike. A `"` or a `<` in a filename would
  otherwise end the attribute early; a `&` in a query string starts an entity.
  The alert title is the content case: it comes from a `labels:` override in
  `course.config.yml`, and raw it could open a tag. One escaper serves both
  positions, because the characters an attribute needs are a superset of what
  content needs
- A value that came out of a markdown token is entity-decoded before it is
  escaped, because `marked` hands the renderer a link destination, an image's
  alt text and either one's title as raw source text: `?a=1&b=2` and
  `?a=1&amp;b=2` are the same URL to CommonMark, and both reach Canvas as the
  one attribute value that resolves back to `?a=1&b=2`. Without the decode,
  Canvas would serve a query parameter named `amp;b`. Only the five entities the
  escaper produces and numeric references are decoded; `&copy;` stays literal. A
  resolver's output is not decoded: it is assembled from ids in
  `.canvas-sync.json`, so there is no encoding to undo
- A pull reads the value back off the attribute with a real HTML parser, so the
  markdown it writes holds the decoded spelling, which pushes to the HTML that
  was already there: push, pull, push sends the same HTML twice, in either
  spelling.
  [Push and pull are not a merge](limitations.md#push-and-pull-are-not-a-merge)
  has the worked example

**HTML to Markdown** (`lib/convert/html-to-markdown.js`):

- Uses `turndown` with atx headings and fenced code blocks
- Custom rules convert alert divs back to GFM alert syntax
- Custom rules resolve Canvas internal links and file URLs
- A table's inline styling does not survive the trip, by design: the GFM
  plugin's `preserveTableStyles` is off, so a styled table comes back as a plain
  pipe table and the author's file keeps no `style` attribute. Turned on, the
  plugin would keep any table whose cells carry a border, padding or a
  background as raw HTML, which is every table this project pushes
- The alert's icon does not survive the trip, by design: the rule skips the
  title paragraph the icon sits in, so the markdown names no icon and the next
  push renders a fresh one from `state.icons`. `downloadReferencedFiles` in
  `lib/sync/local-write.js` cuts those paragraphs out of the HTML before it
  scans for embedded binaries, for the same reason — a downloaded icon would be
  an orphan the moment it landed, referenced by no markdown and recorded in no
  `state.files` row. It excludes them by that shape rather than by id, because
  the ids in `state.icons` are only this course's current generation: a first
  pull has none, a page not pushed since a theme change still carries the
  previous ones, and content copied from another Canvas course carries that
  course's, which this state can never hold

## Docusaurus Content Filtering

Not every Canvas type maps to a Docusaurus page, and one kind of link needs
help. Four remark plugins in `src/plugins/` handle it, wired in
`docusaurus.config.js` with the course language's labels.

**External URL items**: a file with `canvas_type: external_url` has no body
worth rendering. `remark-external-url.js` replaces the document body with a
styled link card showing the URL, so the page keeps its place in the
autogenerated sidebar and visitors see the link rather than raw frontmatter.

**Reference items**: a quiz or an external tool is authored in Canvas, and the
markdown file only records where it belongs. `remark-reference-item.js` gives
the page a card naming the type and a notice saying where the item is edited. A
quiz card links to its Canvas page when `.canvas-sync.json` holds the course's
address and the file's id, an external tool to the launch URL in its
frontmatter; a fresh clone has neither, and the card renders unlinked rather
than guessing.

**File items**: a binary synced from Canvas is stored as a markdown wrapper with
`canvas_type: file` and a `file_ref` pointing at the binary in `_files/`.
`remark-file-item.js` replaces the body with a styled file card and a download
link. When the binary is an image, video or audio file (classified by
`lib/convert/media-types.js`, the same table the Canvas upload stamps its
content types from), the media renders above the card: an image inline, video
and audio with a `<video controls>` / `<audio controls>` player. PDF/DOCX
exports embed images the same way, above the item's attachment line
(`lib/export/assemble.js`); video and audio keep the attachment line alone.

**Inline `.html` links**: Docusaurus's built-in `transformLinks` plugin skips
relative links ending in `.md`, `.mdx` or `.html`, taking them for page
references. Right for `.md` and `.mdx`, wrong for
`[starter](_files/starter.html)` on a normal page. `remark-html-links.js` runs
before the default plugins and rewrites such a link (relative, to an existing
local `.html` or `.htm` file) into an `<a href={require(...)}>` anchor that
webpack bundles. The anchor gets `target="_blank"` by default; with
`download: true` in the page's frontmatter it gets a `download` attribute
instead, so the browser saves the file under its original name. External,
absolute, `@site/`, anchor-only (`.html#…`) and non-existent targets are left
alone, and so is the Canvas sync path: the source markdown keeps its plain
relative link.

## Error Recovery

- **Retry**: a call that comes back 429, 5xx, or a throttled 403 (Canvas reports
  rate limiting as 403 with "Rate Limit Exceeded" in the body) is retried up to
  3 times on top of the first attempt, so a failing request is made 4 times
  before it gives up. Each retry waits the server's `Retry-After` when the
  response names one (capped at 60 seconds), with exponential backoff otherwise.
  A request with no answer after 60 seconds times out, and network errors and
  timeouts are retried the same way. The exception is `POST`: it is retried only
  when Canvas refused the request before running it (429 or throttled 403),
  never on a 5xx, network error, or timeout, because those leave it unknown
  whether Canvas processed the request and a duplicate page or assignment is
  worse than a clean failure.
- **Rate limiting**: pauses 1 second when `x-rate-limit-remaining` drops
  below 50.
- **Stale IDs**: a 404 on updating a page, assignment or discussion means the
  object was deleted in Canvas, so it is created again. A module is not: a 404
  there fails the action, and the run reports it.
- **Unreadable modules**: when Canvas lists a module but refuses to list its
  items (retries exhausted, a permission error), the gather carries the module
  through flagged `unreadable` instead of dropping it, and the planner refuses
  to derive anything from or about it: no writes on either side, no orphan or
  prune candidates, local edits inside its folder parked for the run. The
  refusal lands as one skipped entry naming the module and the failure, which
  fails the run the way every skip does. A module that could not be read is
  never treated as one that was deleted.
- **Saving the state**: the sync state is written once the alert icons are
  uploaded, after every action that was applied or failed, and again at the end
  of the run. However a run stops, an error or an outright kill alike, it loses
  at most the action in flight: every Canvas id already handed out is on disk,
  so the next run recognises the objects behind it instead of creating them a
  second time. Only the end-of-run save stamps `last_sync`.
- **Atomic writes**: the sync state is saved write-to-tmp-then-rename to prevent
  corruption.
