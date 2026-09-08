# Markdown

Standard
[GitHub Flavored Markdown](https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax)
is supported.

## Headings

A page's `title` in the frontmatter is its heading. The preview site renders it
above the body, Canvas shows it as the item name, and a PDF, Word or markdown
export opens the item with it, emoji and all. So the body carries no `#` of its
own: its sections start at `##`, and `npx course validate` warns about a body
that opens with a level-1 heading, because that line prints the title twice.

An export shifts those levels with its scope. A module export puts each item
title at H1 and leaves the body as written; a whole-course export puts module
titles at H1 and item titles at H2, and moves the body down with them, so a
page's `##` becomes an `###`. See [Exporting](exporting.md).

## Internal Links

Use standard relative markdown links to reference other course pages:

```md
[Alerts](02-alerts.md)
[Folder Layout](../05-organising-your-course/01-folder-layout.md)
[Section heading](../02-other-module/01-page.md#section)
```

These links work in every output:

- **Docusaurus**: resolved natively as relative links.
- **Export**: a link whose target is part of the same document becomes an
  internal reference; one whose target is not is unlinked to plain text, with a
  footnote naming the online address when one is known.
- **Push to Canvas**: automatically converted to Canvas internal URLs (e.g.
  `/courses/ID/pages/alerts`). On the first push, pages are created first, then
  any items with forward references are updated in a second pass so all links
  resolve in one go.
- **Pull from Canvas**: Canvas internal URLs are converted back to relative
  markdown paths.

Only `.md` links are transformed. External URLs, fragment-only links
(`#heading`), and non-markdown file links are left unchanged.

## Images and Files

Store images and other embedded files in a `_files/` subdirectory within your
module folder:

```
course/
  01-getting-started/
    _files/
      diagram.png
      handout.pdf
    01-welcome.md
```

Reference them with standard markdown syntax:

```md
![Diagram](_files/diagram.png) [Download handout](_files/handout.pdf)
```

These references work in every output:

- **Docusaurus**: relative paths work natively.
- **Export**: images are embedded in the PDF or Word document.
- **Push to Canvas**: files are uploaded to Canvas file storage and paths are
  rewritten to Canvas file URLs. Files in `_files/` are **not** added as module
  items. They only appear inline.
- **Pull from Canvas**: Canvas file URLs are downloaded to `_files/` and
  converted back to relative paths. A download onto a path git reports as
  modified or untracked is refused instead, and refused whole: no sync-state row
  is written and the URL in the page is left as it is, so the page still renders
  Canvas's copy rather than pointing at a local file that was never fetched. See
  [`(git-dirty)` under Skipped](troubleshooting.md#git-dirty-under-skipped).

An image can also be its own module item instead of part of a page: a file-item
wrapper with `file_ref` (see [Frontmatter](frontmatter.md#file-item)) renders
the image above its download card in the preview.

### Shared Files

A file that more than one module uses goes in `course/_files/`, a shared assets
folder at the root of the course tree; subfolders are welcome
(`course/_files/aias/`). Reference it the same way, one step further up:

```md
![AIAS level 1](../_files/aias/n1.png)
```

Every output resolves it exactly as a module's own `_files/`: one upload and one
Canvas file, however many pages embed it. On Canvas the file lands in a
`shared/` folder that mirrors the tree under `course/_files/`.

Mind the ambiguity: from a page directly in a module folder, `../_files/` is the
shared folder; from a page inside a subfolder, `../_files/` is the module's own
`_files/` and the shared folder is `../../_files/`. The path is always relative
to the file that writes it, and `npm run build` fails on an image path that
resolves to nothing, so a slip does not reach students.

One asymmetry to know about: push, the preview and the exports understand shared
files fully, but a pull never creates one — a binary first met on Canvas is
downloaded into the referencing module's own `_files/`. Move it to
`course/_files/` and repoint the references when you want it shared. See
[Limitations](limitations.md#push-and-pull-are-not-a-merge) for the details.

### Linking to `.html` Files

Inline links to `.html` files are a special case. Docusaurus treats `.html`
(like `.md`) as a page reference rather than a downloadable asset, so a plain
link such as `[example](_files/example.html)` would otherwise break in the
preview. The `remark-html-links` plugin fixes this: any relative link to an
existing local `.html` file opens that file in a new browser tab.

```md
Open the starter: [starter.html](_files/starter.html)
```

To force a download instead (the file saves under its original name rather than
rendering), set `download: true` in the page's frontmatter. The flag applies to
every `.html` link on that page:

```md
---
title: Templates
download: true
---

Download the starter: [starter.html](_files/starter.html)
```

You write a normal relative link (no special syntax) and it works in the
Docusaurus preview and on Canvas (uploaded file) alike. The `download` flag only
affects the preview; on Canvas the link always points to the Canvas file page.
Only `.html` and `.htm` are affected; `.md`/`.mdx` stay page links, and other
file types (`.pdf`, `.zip`, `.docx`, images) already worked. A link with an
anchor (`_files/example.html#top`) is left as navigation.

## Underscore Prefix Convention

Files and folders whose names start with `_` (underscore) are internal: the
course scanner never reads one as a module item, and Docusaurus skips them by
convention. That makes the prefix a drafting mechanism, a way to keep a file in
the tree without it appearing in any output. It does not keep sync out of them,
because two of them are where a local write puts things. Examples:

- `_files/`: embedded assets (images, PDFs), and where sync and pull download
  the binaries a Canvas page embeds. The same folder at the root of `course/`
  holds the [files shared across modules](#shared-files)
- `_category_.json`: Docusaurus sidebar configuration, and where sync and pull
  write the Canvas module name
- `_draft-notes.md`: any file you want to keep local-only, which nothing here
  writes to

Names that start with `.` are skipped the same way. That is for `.DS_Store` and
its relatives, which Finder leaves in any folder it has shown and `.gitignore`
hides from git but not from the scanner: without the skip, one would sync to
Canvas as a file item. No course item starts with a dot, so nothing is lost.

## Custom Alerts

Use GitHub-style blockquote alerts for callout boxes. These render with matching
styling in the Docusaurus preview, in PDF and Word exports, and on Canvas.

```md
> [!NOTE]
>
> Informational note.

> [!TIP]
>
> Helpful tip.

> [!IMPORTANT]
>
> Important information.

> [!WARNING]
>
> Warning message.

> [!ATTENTION]
>
> Urgent: demands immediate attention.

> [!CHECK]
>
> Verification step or checklist item.
```

Each type displays with a distinct colour, icon, and title. Titles follow the
course language set in `course.config.yml` (English: Note, Tip, Important,
Warning, Caution, Check; Dutch: Info, Tip, Belangrijk, Waarschuwing, Opgelet,
Check) and can be overridden per label; see the "Course language and labels"
section in the [user guide](user-guide.md). On Canvas, the icons are uploaded on
the first push and tracked in `.canvas-sync.json`.

One naming quirk to know: the alert you write as `[!ATTENTION]` is the one
GitHub calls `[!CAUTION]`, so its label key in `course.config.yml` is `caution`
and its default English title is "Caution". `[!CAUTION]` is accepted in your
markdown as a synonym, but a pull rewrites it to `[!ATTENTION]`: the HTML on
Canvas records the type, not which of the two spellings you wrote.
