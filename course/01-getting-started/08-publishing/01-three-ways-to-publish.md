---
title: 📘 Three Ways to Publish
canvas_type: page
---

The files you have been writing publish three ways, and you pick the route your
course needs today. The other two stay open: all three read the same files, and
none of them locks the others out.

- **A course website.** One setting on your GitHub repository, and every push
  republishes it. Your students get a public address for the materials, whether
  or not the course uses Canvas at all.
- **A PDF or Word handout.** Two free converters, installed once. Good for a
  styled course text, or for a single chapter you want on paper.
- **Canvas.** Your Canvas credentials, and a backup of the course before you
  start. This is the route that fills the modules students see in Canvas.

The pages that follow take each route in turn, Canvas in two of them, because it
is the one that can lose work.

## Try It

Build the site once before you go on. The website route does this on every push,
and it is the quickest check that your links hold. This one has no sidebar
button, so open VS Code’s terminal with **Ctrl+`** and type it:

```bash
npm run build
```

> [!CHECK]
>
> A `build/` folder appears in your project, and the command finishes without
> naming a broken link.
