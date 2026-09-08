---
title: 📘 The Course Website
canvas_type: page
---

The preview you have been reading all along is already a website. Publishing it
takes one setting on GitHub and no command at all.

## Switching It On

Open your repository on GitHub and go to **Settings > Pages**. Set **Source** to
**GitHub Actions**. That is the whole setup.

From then on, every push to GitHub rebuilds and republishes the site. The
address is `https://YOUR-USERNAME.github.io/your-project-name/`. If you own a
domain and would rather use that, enter it on the same settings page.

You are reading one right now: [coursewright.md](https://coursewright.md/) is
the `course/` folder of the Coursewright repository, published exactly this way,
custom domain and all.

> [!WARNING]
>
> The published site is public even if your repository is private. Only
> `course/` is served, so `evaluations/` and `sources/` never reach it, but make
> sure you are happy with your course content being readable by anyone.

GitHub Pages on a private repository needs a paid GitHub plan, which educators
get free through GitHub Education. The
[hosting guide](https://github.com/lars-derichter/coursewright/blob/main/docs/hosting.md)
has the details and the failures worth knowing.

## Try It

1. Switch Pages on as above: **Settings > Pages**, with **Source** set to
   **GitHub Actions**.
2. Commit and push your work from the Source Control panel with **Sync
   Changes**, the button you used on the [Git Workflow](../07-git-workflow.md)
   page.
3. Watch the run appear under the **Actions** tab of your repository. It takes a
   minute or two.

> [!CHECK]
>
> Open `https://YOUR-USERNAME.github.io/your-project-name/` and you see this
> page.
