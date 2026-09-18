# Pack Compression

How a compact study pack is condensed from its raw export, and what
`scripts/pack-tool.js check` enforces. The raw export is the truth: the compact
pack is that export with the prose reduced to what a chatbot needs to answer
from the course. The script proves that the structure, the code and the verbatim
sections survived; this file guides the judgement on everything else.

## What Stays Verbatim

- The header: the pack title, the subtitle line and the date line, as the raw
  has them.
- Every H1 and every H2 heading, in the raw's order, character for character. An
  H1 is a module and an H2 a page: the chatbot cites them, and the check pairs
  sections by them.
- Every fenced code block, fence lines and info string included, with its blank
  lines and its indentation. The check compares blocks with the outer whitespace
  trimmed, so a block may move within its section but never change.
- Every H2 section whose title starts with one of the recipe's `verbatim:`
  prefixes: reference cards, the glossary page, the assessment pages, the
  summary pages, whatever the teacher named in Phase A. They are dense already,
  and a rule or a definition reworded loses precision and nothing else.
- Tables.
- An alert (`> [!NOTE]` and its kin) that states a rule, a limit or a trap,
  alert markup included. An alert that carries encouragement or a study tip
  goes.
- The task text of a homework or assignment page: every task, every level (core,
  extension, challenge, or the course's own names), the rules the work is judged
  by, and the hand-in instructions. Only the framing around them is condensed.
- A bodyless item, as the export left it: a file item's attachment line, an
  external item's URL, a reference item's notice.

## What Is Condensed

The rest of the prose: explanations, worked examples, walkthroughs, overviews.

Condensing keeps:

- every fact, term and definition;
- every rule, and the reason the page gives for it;
- every number, filename, class name, method name, variable name and error
  message;
- every example that carries a distinction: two cases that look alike and behave
  differently, a wrong version next to the right one;
- the order of the points.

Condensing drops:

- lesson logistics: what happens in class, in which step, how long, what to
  bring;
- "what you need" and "before you start" lists: installation reminders, pointers
  to earlier lessons, downloads and folder trees;
- download blurbs: what a zip contains and how to open it;
- page intros and outros: "this page explains", "you now know", "next lesson";
- framing repeated on every page of a kind: the levels legend on every homework
  page, the "this does not count for points" callout, the "log your AI use"
  line. The first occurrence in the pack stays; the rest go;
- motivational alerts and encouragement;
- a second explanation of a point already made: keep the sharper one;
- pointers to other pages when the target is in the pack;
- games, self-tests, checkpoints and reflection prompts, unless the page states
  a rule about them (a threshold, a deadline).

## How to Condense

- Write tight statements or bullets in the course's own words and in the course
  language: a chatbot that quotes the pack should sound like the course.
- Never loosen a rule while shortening it. "Usually", "mostly" and "in general"
  appear only where the raw has them.
- Never merge two examples into one, and never invent one.
- Keep the order of points within a section as the page has them.
- H3 and below are free: merge, rename or drop them as the condensed text needs.
- Keep a page's opening sentence when it states the concept; drop it when it
  announces the page.
- Expect a ratio of 0.4 to 0.6 for a lesson section of ordinary prose. Under 0.3
  a fact has probably gone; over 0.8 the framing has probably stayed. Verbatim
  sections sit at 1.0 by definition and pull a pack's total up.

## What the Check Enforces

`pack-tool.js check <recipe>` reads the compact path and the verbatim prefixes
from the recipe's frontmatter, finds the raw at `raw/<recipe name>.md` next to
the recipe, and prints one line per finding:

| Line                                | Meaning                                                                               | Fix                                              |
| ----------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `header differs`                    | title, subtitle or date differ from the raw                                           | copy the raw's header                            |
| `heading missing H1 "…"` / `H2 "…"` | a section of the raw has no counterpart                                               | put the heading back, with its condensed body    |
| `heading extra H1 "…"` / `H2 "…"`   | a heading the raw does not have                                                       | remove it, or rename it to the raw's             |
| `heading order …`                   | same headings, other order                                                            | reorder to the raw's                             |
| `code missing in "…": <first line>` | a fenced block of the raw is absent or changed                                        | restore it verbatim                              |
| `code extra in "…": <first line>`   | a block the raw does not have                                                         | remove it                                        |
| `verbatim differs "…"`              | a verbatim section was reworded                                                       | copy the raw's section                           |
| `leftover line N …`                 | a fenced div, heading attribute, HTML comment, absolute repository path or local link | remove it; the export never emits these          |
| `` term dropped in "…": `x` ``      | warning: an inline-code term of the raw is absent from the compact section            | check that nothing was lost; a bare value may go |
| `section ratio …`                   | compact bytes over raw bytes, per section                                             | information                                      |

The last lines give the pack's sizes and ratio and the counts of failures and
warnings; the exit code is 1 on any failure. A failure is fixed in the compact,
never in the raw: the raw is the export, and when it is wrong the course page is
wrong.

## Working in Chunks

A pack is condensed one H1 section at a time; a whole raw at once is too much to
hold and too much to check.

1. Print a section of the raw: `pack-tool.js section <raw> "<H1 title>"`.
2. Write the condensed section to the session scratchpad as one file whose first
   line is that H1.
3. Put it in place: `pack-tool.js splice <recipe> <file>`. The first splice
   creates the compact with the raw's header; every splice puts the section at
   the raw's position, or replaces it when the compact already has it, and
   refreshes the header from the raw.
4. `pack-tool.js check <recipe> --section "<H1 title>"`, and fix what it names
   before moving on.
5. After the last section, the full `check`. A pack ships only on `0 failures`.

## Incremental Re-Run

A regeneration re-condenses only what changed.

1. Copy the committed raw to the scratchpad, then export the new raw over the
   committed one.
2. `pack-tool.js changed <recipe> <old raw>` lists the sections that were added
   or changed and those that were removed. `header date only` means the export
   date moved and nothing else.
3. Condense the added and changed sections as above; take the removed ones out
   with `pack-tool.js drop <recipe> "<H1 title>"`; leave the rest alone, so they
   stay byte-identical and the diff of the compact shows real change only.
4. The full `check`. Splice has refreshed the header, so the date matches the
   new raw.
