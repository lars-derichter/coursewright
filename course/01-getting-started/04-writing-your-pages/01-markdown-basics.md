---
title: 📘 Markdown Basics
canvas_type: page
---

All course content is written in **Markdown**, a simple way to format text that
is easy to read and write. You do not need any technical background to use it.
This page walks you through the most common formatting options so you can start
writing right away.

## Text Formatting

You can make text **bold**, _italic_, or **_both_**. Use ~~strikethrough~~ for
deleted text and `inline code` for code references.

## Headings

Headings use `#` symbols. Use `##` for main sections and `###` for subsections.
Avoid using `#` (h1) in your content since the page title already renders as h1.

## Lists

Unordered lists use dashes:

- First item
- Second item
  - Nested item
  - Another nested item
- Third item

Ordered lists use numbers:

1. First step
2. Second step
3. Third step

## Links

Link to external resources with `[text](url)`:

- [Canvas LMS Documentation](https://canvas.instructure.com/doc/api/)
- [Markdown Guide](https://www.markdownguide.org/)

### Internal Links

You can link to other course pages using relative paths. These links work in
every output: in the preview and on the published website, in a PDF or Word
export (where they become cross-references inside the document), and on Canvas,
where a push converts them to Canvas internal URLs.

- Same folder: `[Alerts](02-alerts.md)`
- Subfolder: `[Folder Layout](../05-organising-your-course/01-folder-layout.md)`
- With heading anchor: `[Available Types](02-alerts.md#available-types)`

Try them here:

- [Alerts](02-alerts.md)
- [Folder Layout](../05-organising-your-course/01-folder-layout.md)
- [Available Types](02-alerts.md#available-types)

## Images

Images use the same syntax as links, prefixed with `!`. Store image files in the
`_files/` subdirectory of your module:

```markdown
![Alt text](../_files/example-image.svg)
```

Here is an embedded example:

![Example image](../_files/example-image.svg)

Images travel with the page in every output. An export embeds them in the
document, and a push uploads them to Canvas and rewrites the paths to Canvas
file URLs. A pull downloads them back.

## Linking to Files

You can link to any file in `_files/` the same way, handy for handouts,
templates, or starter files students should download:

```markdown
[Course notes](../_files/coursewright.docx)
```

Like images, linked files are uploaded to Canvas during push and the link is
rewritten to the Canvas file URL. A PDF or Word export leaves the link as you
wrote it, since a document on paper has nowhere to put a download. Try it:
[course notes](../_files/coursewright.docx), which is this whole course as a
Word document.

One special case: in the local preview, a link to an `.html` file opens that
file in a new browser tab. Try it with this
[starter file](../_files/download-me.html). To force a download instead, set
`download: true` in the frontmatter of the page; the flag applies to every
`.html` link on that page. On Canvas the link simply points to the uploaded
file. Internal links to course pages must always use the `.md` path, never
`.html`.

> [!NOTE]
>
> To make a file its own entry in the module list, instead of a link inside a
> page, use a file item. [Workflow Diagram](../02-workflow-diagram.md), near the
> top of this module, is one: a wrapper around an SVG. See
> [Content Types](../05-organising-your-course/02-content-types.md).

## Code Blocks

Use triple backticks for code blocks with optional language highlighting:

```javascript
const greeting = "Hello, world!";
console.log(greeting);
```

```python
def greet(name):
    return f"Hello, {name}!"
```

## Tables

Tables use pipes and dashes:

| Feature | Syntax        | Example       |
| ------- | ------------- | ------------- |
| Bold    | `**text**`    | **bold text** |
| Italic  | `*text*`      | _italic text_ |
| Code    | `` `code` ``  | `code`        |
| Link    | `[text](url)` | [a link](#)   |

## Blockquotes

Use `>` for blockquotes:

> Markdown is intended to be as easy-to-read and easy-to-write as possible.
>
> _John Gruber_

## Horizontal Rules

Three dashes create a horizontal rule:

---

That covers the essentials. For a complete reference, see the
[GitHub Markdown Guide](03-github-markdown-guide.md).

## Try It

Click **Markdown Basics** in the tree to open this file, then add something of
your own: a row to the table under Tables, or a code block in a language you
teach. Save it. This is your copy of the module, so nothing here is precious.

> [!CHECK]
>
> The preview shows what you added, in the right place on the page.
