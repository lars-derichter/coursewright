# Writing Your Own Skills

The bundled [skills](ai-assistants.md) don't cover everything, and they don't
have to: a skill is a plain markdown file, and your AI assistant can write one
for you, following the file layout, shared template and naming rules below.

Using the bundled skills needs none of this. Start at
[AI assistants](ai-assistants.md) instead.

## Asking an Assistant to Write One

Say what you want automated and point the assistant at this page. For example:

> Create a new skill in `.agents/skills/announcement-draft/SKILL.md` that drafts
> a short "what changed this week" student announcement from the git log. Follow
> the conventions in `docs/writing-skills.md`, and look at
> `.agents/skills/lesson-summarize/SKILL.md` for a model.

The [ideas list](roadmap.md) has more candidates.

## Where Skills Live

Skills live in `.agents/skills/<name>/SKILL.md` (`.claude/skills` is a committed
symlink to the same directory). The frontmatter, just `name` and `description`,
is the portable [Agent Skills](https://agentskills.io) format, so the same files
work in every tool that reads skills. `$ARGUMENTS` is substituted by Claude Code
and Codex, and reads as an obvious placeholder anywhere else.

## The Shared Template

The shipped skills follow a shared template; new ones should too, so they stay
predictable for both the reader and the model:

- **Frontmatter**: `name` (matching the folder) and a `description` that says
  what the skill does, where it writes, and the approval gate if any, ending in
  four to six quoted trigger phrases: two or three in English first, then the
  same request in your course language (the shipped skills add Dutch). English
  leads because the skill itself is written in English; the second language is
  what makes the skill fire on how you actually ask for it.
- **Section order**: H1 (the name with the hyphens as spaces, in title case), a
  2–4-line intro, `## Input` (only when the skill takes arguments), `## Steps`,
  `## Rules`, and a bare `$ARGUMENTS` line at the end.
- **Approval gates** only when a skill writes something worth reviewing first.
  Split `## Steps` into `### Phase A: <Verb> (Writes Nothing)` and
  `### Phase B: <Verb> (Only After Approval)`, and end Phase A with the
  canonical pair: "Adjust on request and stay in Phase A. Stop. Wait for
  explicit approval before starting Phase B."
- **State each rule once.** A rule already carried by a step does not reappear
  under `## Rules`; drop the Rules section if nothing is left.
- **Defer, don't copy.** Content owned by
  [writing-style.md](../context/writing-style.md),
  [frontmatter.md](frontmatter.md), or
  [course-context.md](../context/course-context.md) is referenced, never
  inlined; copies drift. Dense reference payloads (format specs, protocol
  details) go in a `references/` file inside the skill folder, read on demand.
  Work the model should not do by hand (checking a generated file, diffing two
  versions of it) goes in a `scripts/` file the skill runs with `node`, on Node
  built-ins only: the skill folder has no `node_modules` to resolve a package
  from. Its test lives in `test/skills/`, so `npm test` covers it.
  `study-pack-build` is the model: `scripts/pack-tool.js` and
  `test/skills/pack-tool.test.js`.
- **Course-agnostic.** No hardcoded course vocabulary, module names, or paths
  that exist in only one course; course facts come from `course-context.md` at
  runtime.
- **Language-agnostic.** The skill's own instructions are English; the language
  it writes _in_ comes from `writing-style.md` at runtime, never from the skill.
  Say so in one `**Language.**` bullet at the top of `## Rules`, as the shipped
  skills do, and let examples lead with English while carrying the same example
  in your course language where that helps the model match it.
- **Temp files** go to the session scratchpad, never `/tmp`. Build zips and
  binaries there and copy them into the repo (cloud-synced folders can reject
  direct writes).

## Naming

Skill names are `<object>-<verb>`, object first, so skills about the same thing
share a prefix and sort together: `/lesson` finds the whole authoring pipeline,
`/issue` the whole queue. The object comes first because it is the part you
know; the verb is the part you would have to guess, and prefix matching keys on
the first segment.

The verb comes last, from a small vocabulary: `design` for gated interactive
authoring, `build` for generation from an approved source, `init` for building a
configuration from ground truth (the repo, an interview, a reference document),
`update` for changing a configuration already in place, whether from a direct
instruction (`/export-style-update`) or from decisions you settled during the
session (`/writing-style-update`), `report` and `fix` for the intake and
work-through ends of the issue queue, `summarize` for a condensed derivation of
an approved source, and `retro` for the after-teaching debrief. An `init` skill
is not one-shot: re-running it after the course changes is expected. Prefer an
existing verb for a new skill; coin one only when none fits.

Two kinds of name sit outside the pattern. Read-only report skills take a result
noun instead of a verb (`consistency-check`, `coverage-map`, `image-todos`). And
three names stay bare verbs because they are single words in universal use, and
because what they act on is whatever you hand them rather than a course object
worth putting first: `/commit`, `/proofread` and `/translate`.

`setup` sits outside the verb vocabulary too, and only `/course-setup` carries
it: an `init` skill builds one configuration file, setup configures the project
as a whole, and the name matches the `npx course setup` command it drives. One
project, one skill; a single case, not a pattern.

To contribute a skill back to the template itself, see
[Contributing](contributing.md).
