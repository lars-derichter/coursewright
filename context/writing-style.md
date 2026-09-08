# Writing Style

> [!IMPORTANT]
>
> This guide ships as a ready English baseline, usable as it stands. It is a
> starting point, not a requirement. Run `/writing-style-init` early to adapt it
> to your own language, audience, and voice, or copy another baseline from
> [`templates/`](../templates/) over this file: US English, Flemish Dutch or
> Netherlands Dutch. The file is protected during upstream updates, so your
> version sticks. See [Customisation](../docs/customisation.md).

Course materials are in English, and so is this guide, which AI tools read
before drafting anything for you.

## Audiences

Course writing has two audiences and two registers. Pick the right one for the
file you are editing.

- **Student-facing**: anything in `course/` and `evaluations/`, plus assignment
  and exam instructions. Warm, accessible, CEFR B2.
- **Colleague-facing**: lesson plans in `sources/lessons/`, class versions in
  `sources/lesson-plans/`, and source notes and drafting documents elsewhere in
  `sources/`. Direct, dry, no readability cap. Reads like talking to a fellow
  teacher or like a published teaching manual.

The lowest-numbered lesson plan under `sources/lessons/` is the worked example
for the colleague-facing register.

`AGENTS.md` and the guides in `docs/` belong to the tooling project rather than
to your course. They follow the colleague-facing register plus the rules in
[Contributing](../docs/contributing.md#documentation-style), and they are not
yours to restyle: an upstream update overwrites `docs/` outright, and
`AGENTS.md` is protected from one, so an edit there is yours to carry forever.
Change your course's voice here; leave those alone.

`README.md` changes hands. It is the tooling project's until `npx course setup`
replaces it with your course's own, and yours after that.

The rest of this guide splits into **shared rules** (apply to both),
**student-facing**, and **colleague-facing**.

## Shared Rules

### Language

- **UK spelling.** "colour", "customise", "-ise" over "-ize", "practise" for the
  verb against "practice" for the noun. If your institution writes US English,
  take [`templates/writing-style-en-us.md`](../templates/writing-style-en-us.md)
  instead. The rule that matters is that one variety wins throughout.
- **Second person, plain vocabulary.** "you", never "one". Prefer "use" over
  "utilise", "make sure" over "ensure that due care is taken", "help" over
  "facilitate", "about" over "with regard to".
- **Contractions are welcome** in explanatory prose: "you'll", "don't", "it's".
  They keep the tone human. Drop them in assignment and exam instructions, where
  precision beats warmth.
- **Keep technical terms in their conventional form:** _markup_, _selector_,
  _property_, _whitespace_, _screen reader_, _deploy_, _commit_, _framework_.
  Never invent a translation or a house synonym for a term students will meet
  again in the documentation.
- **Natural English, not translationese.** If you think in another language,
  watch for:
  - Idioms carried over literally from your first language.
  - Another language's sentence rhythm: stacked subordinate clauses, long
    parenthetical insertions dropped into the middle of a sentence, the main
    verb arriving far too late.
  - Calqued collocations that do not survive the trip ("make a photo", "open the
    light", "since three years").

### Structure of a Page

Open with one or two sentences of context, then get to the point. No "In this
section, we will…" meta-introductions.

- **Numbered lists** for ordered steps.
- **Bulleted lists** for enumerations and concept breakdowns. For concept lists,
  lead with a short **bold** phrase:
  ```md
  - **Readable code:** your work is easier to read and more clearly
    structured.
  - **Fewer surprises:** the next person to open the file knows what to
    expect.
  ```
- **Short prose paragraphs** for explanation. No walls of text.
- **Code blocks** for anything that is typed, shown, or copied.
- **Headings** to break up longer pages. Start at `##` for main sections; `###`
  sparingly. Never `#`: that level belongs to the page title.

### Headings and Titles

- **No level-1 heading in the body.** The `title` in the frontmatter is the page
  heading in every output: the website, Canvas, and the PDF, Word and markdown
  exports. A `#` in the body prints that title a second time, and
  `npx course validate` reports the page. Sections start at `##`.
- **Title case, Chicago style.** Capitalise the first and last word plus every
  major word. Lowercase articles (a, an, the), coordinating conjunctions (and,
  but, or, nor, for, so, yet), and prepositions of three letters or fewer (in,
  on, at, to, of, by, up, as). Capitalise both halves of a hyphenated compound.
  - Good: `## A Logical Folder Structure for Your Website`
  - Bad, sentence case: `## A logical folder structure for your website`
  - Bad, every word capitalised:
    `## A Logical Folder Structure For Your Website`
- Short and descriptive. No trailing punctuation except `?` for a real question.
- Acronyms in their conventional form: URL, HTTP, API, PDF, FAQ.
- **The rule covers headings you write, not labels the tooling generates.**
  Alert titles, link and file cards, and the glossary heading come from the
  built-in label set and are sentence case ("External link"). Override
  individual ones under `labels:` in `course.config.yml` if you want them to
  match.

### Punctuation and Typography

- **No em-dashes (—).** AI tell. Use a comma, a colon, parentheses, or a new
  sentence.
- **En-dashes (–)** for ranges (`2023–2024`).
- **Pick one serial-comma convention and keep it.** "red, white and blue" or
  "red, white, and blue", but not both on the same page. Use the comma whenever
  leaving it out creates ambiguity.
- Smart quotes `‘’` and `“”`.
- Ellipsis `…`, sparingly.
- One exclamation mark at a time.

### Patterns to Avoid (AI Tells)

Text that reads as machine-written costs you students' trust faster than a typo
does. Sweep for these before publishing.

The first three groups show up in text from any model. The last three are the
pet habits of one assistant each: keep the groups for the models you use and
delete the rest.

**Openers and transitions**

- "Let's dive in", "By the end of this lesson, you will be able to…".
- Rhetorical questions used as a runway: "So what does this actually mean for
  you?"
- "In today's fast-paced world…", and every other scene-setting first paragraph.
- Over-enthusiastic openings: "Great!", "Fantastic!", "Exciting news!".

**Sentence-level tells**

- "It's important to note that…", "It's worth noting that…": just say the thing.
- The "not just X, it's Y" construction, and its cousin "X isn't about A, it's
  about B".
- Decorative tricolons: "fast, simple and efficient".
- Stacked hedges: "may potentially help to some extent in certain cases".
- Vague attribution: "experts say", "studies show", with no source in sight.
- Vocabulary that turns up far more often in generated text than in yours:
  _delve_, _leverage_, _robust_, _seamless_, _crucial_, _testament to_,
  _underscore_, _realm_, _tapestry_, and _navigate_ used figuratively.

**Shape and rhythm**

- Bold scattered through prose. Bold belongs on list lead-ins or on a term you
  are defining.
- Every paragraph closing with a summary sentence.
- Repeating the heading as the first line of the section.
- Bullet lists where every item runs to the same length and the same grammatical
  shape. Real lists are lumpy.
- Perfectly balanced sections, three bullets each, all the way down.
- Sentences of the same length and build, marching in step. Vary the rhythm.

**Claude**

- Copula avoidance: "serves as", "stands as", "acts as", "represents" where the
  verb is "is".
- Trailing participle padding: "…, highlighting the importance of X", "…,
  ensuring a smooth workflow", "…, reflecting broader trends".
- Unsolicited reassurance: "You're not alone", "You're not imagining it".
- Assistant voice leaking into prose: "Great question", "You're absolutely
  right", "I'd be happy to walk you through…".

**ChatGPT (OpenAI)**

- Emoji as decoration in headings and bullets (🚀, ✅, 💡).
- "In conclusion" / "Overall" closers, and "Hope this helps!".
- Hype vocabulary: "game-changer", "unlock", "elevate", "supercharge", "embark
  on a journey".
- A table for information that is not tabular.
- "Short answer: … Longer answer: …" and "TL;DR" scaffolding.

**Gemini**

- "Here's a breakdown of…", and answers that are nothing but nested bullets,
  three levels deep.
- "In essence", "Essentially", "Ultimately" as paragraph openers.
- "Think of it like…" analogies for everything.
- Unprompted disclaimers and safety caveats tacked onto the end.

### Links

- Official, durable sources for reference: standards bodies, a tool's own
  documentation, the vendor's reference pages.
- Internal links use relative `.md` paths.

### Code Examples

- Fenced blocks with a language tag (` ```js `, ` ```python `, ` ```bash `).
- The smallest snippet that makes the point.
- Code comments in the course language, so English here.

## Student-Facing Materials

### Reading Level

**CEFR B2.** Short, concrete sentences. Break a long sentence in two rather than
stacking clauses. Explain a term on first use, then use it freely.

### Voice and Tone

Default voice for explanatory text:

- **Second person, direct.** "you create", "try", "save". Imperatives in steps.
- **"We" for shared work in class.** "We'll look at this together…"
- **"I" for personal experience and opinion.** Welcome, do not strip it out.
- **Warm, occasionally playful.** Congratulate ("Nice work!"), admit when
  something is genuinely annoying, slip in a small joke where it fits. Do not
  force it.
- **Honest.** If one operating system has it easier this one time, say so.
- **Parenthetical asides are welcome** in explanatory text, though not in every
  paragraph.

### Exercises, Assignments, and Exams: Clarity First

In instructions, a student must be able to start without asking. Drop the warm
voice where it costs clarity:

- No parenthetical asides, no jokes, no "I" or "we".
- Short imperatives, unambiguous steps, explicit deliverables and constraints.
- No contractions where a misreading is expensive.
- A lighter, warmer tone is fine in the _introduction_ to an assignment; from
  the actual instructions onward, clarity wins.

### Page-Title Emoji

Page titles may start with an emoji signalling the page type. One is the
default; a second is fine when it genuinely adds information (❗️📅 for an
assignment with a deadline), never a third. With two, keep the order of the list
below. If no listed emoji fits, use an off-list one now and then; once it
recurs, add it here with its meaning.

- ❗️ assignment (to hand in, graded or not)
- 💯 exam or test material
- 🏠 homework
- 📅 has a deadline
- 👥 group work
- 💬 discussion
- 📝 something to write
- 📖 something to read
- 🛠 something to build
- ⚙️ setup / installation
- 📦 starter files / download
- 🧪 try it yourself / experiment
- 🔎 research
- 💪 practice
- 🔑 solution
- 🚸 extra help
- 🧩 extra exercise
- 📘 explanation / reference
- 🎬 video
- 📽 presentation
- 📕 summary
- ⚠️ important
- 💣 danger
- ℹ️ extra info
- 🔁 revision

Emoji stay on the title: none in the section headings inside the page, in
bullets, or in prose. Students never read this guide, so put the legend on your
course's start page; signage only works when the reader knows the signs.

### Callouts (GitHub-Style Alerts)

Keep them short. If the content grows past a few lines, move it into the page.

- `[!NOTE]` background, "learn more"
- `[!TIP]` hint or shortcut
- `[!IMPORTANT]` must not be missed
- `[!WARNING]` common pitfall
- `[!ATTENTION]` urgent, act now
- `[!CHECK]` verification step

`[!ATTENTION]` is this project's spelling of what GitHub calls `[!CAUTION]`;
both are accepted, and the rendered title comes from the `caution` label in
`course.config.yml`.

### "Learn More" Links

Put background or further-reading links inside a `[!NOTE]` at the end of a
section.

## Colleague-Facing Materials

For lesson plans (`sources/lessons/`), class versions (`sources/lesson-plans/`),
source notes, and drafting documents in `sources/`. The audience is fellow
teachers, not students. The lowest-numbered lesson plan under `sources/lessons/`
is the example to mirror.

### Reading Level

Native or C2. Skip simplification. Compound sentences are fine when they carry
their weight; favour two short sentences over one stacked one anyway, because
rhythm matters.

### Voice and Tone

- **Direct, dry, occasionally playful.** Like talking to a colleague in the
  staff room, or like a published teaching manual. Warmth comes from precision
  and dry observation, not from cushioning.
- **Front-load the point.** No setup paragraphs, no "In this lesson plan I
  describe…". Open with one context sentence, then get to it.
- **Fragments are welcome** when they hit harder: _"Three concepts. No more."_
  _"Everybody passes."_
- **Both "I" and "you" are fine.** _"You model learning goal 4 by debugging in
  front of them."_ _"I walk around and ask questions."_ Use "I" sparingly, for
  personal experience or a judgement call you want to flag as yours.
- **No trailing summaries.** Stop when the point is made.
- **State expectations directly.** No defensive hedging ("it could be that some
  students…"). If you expect it, say so.

### Structure

- No page-title emoji. Those are signage for students.
- Short paragraphs and bullets where useful, just like the shared structure
  rules above. Lesson plans typically use `##` for blocks and phases, and `###`
  for time-bracketed sub-sections.
