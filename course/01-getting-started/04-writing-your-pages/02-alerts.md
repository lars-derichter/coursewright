---
title: 📘 Alerts
canvas_type: page
---

Alerts are coloured callout boxes that help important information stand out on
the page. They are a great way to highlight tips, warnings, or key details for
your students. This project supports six types of alerts, and they work in every
output.

## Syntax

Alerts use the blockquote alert syntax: the type marker on its own line, then
the text on the following line(s):

```markdown
> [!NOTE]
>
> This is a note.
```

## Available Types

> [!NOTE]
>
> Use **NOTE** for supplementary information that adds context. The reader can
> skip this without missing essential content.

> [!TIP]
>
> Use **TIP** for practical advice and best practices. These help the reader
> work more efficiently.

> [!IMPORTANT]
>
> Use **IMPORTANT** for key information the reader must know to succeed. Do not
> skip these.

> [!WARNING]
>
> Use **WARNING** when something could go wrong. Warns about potential pitfalls
> or common mistakes.

> [!ATTENTION]
>
> Use **ATTENTION** for critical alerts. This type signals that ignoring the
> message could lead to serious problems.

> [!CHECK]
>
> Use **CHECK** to highlight verification steps or success criteria. Useful for
> checklists and validation points.

## Tips for Using Alerts

- Use alerts sparingly. Too many callout boxes make content harder to scan.
- Pick the type that matches the intent, not the colour you prefer.
- Keep the text inside concise. If it needs multiple paragraphs, consider making
  it regular content instead.
- The same alert renders on the website, in a PDF or Word export, and on Canvas,
  where the icons are uploaded to your Canvas instance on the first push.

## Try It

Add a `[!TIP]` of your own to this page, anywhere you like, and save.

> [!CHECK]
>
> It shows as a coloured box, with the title the language in `course.config.yml`
> gives it.
