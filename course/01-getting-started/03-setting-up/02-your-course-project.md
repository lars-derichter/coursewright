---
title: ⚙️ Your Course Project
canvas_type: page
---

Coursewright is a **template**: you make your own copy, and your copy is yours.
Nothing you do to it touches the original, and you can make one copy per course.
On GitHub each copy is a **repository**, one project’s files together with their
whole history.

## Make Your Copy

1. Open the
   [Coursewright project page](https://github.com/lars-derichter/coursewright).
2. Click **Use this template** at the top right, then **Create a new
   repository**.
3. Give it a name that says which course it is: `course-web-development`,
   `course-databases`. You will thank yourself once you have four of them.
4. Choose **Private** or **Public**, then click **Create repository**.

> [!WARNING]
>
> If you will keep exams or tests in the `evaluations/` folder, make the
> repository **private**. A public repository is public, and students can find
> it. You can change this later under **Settings > General > Danger Zone**, and
> educators can get a free GitHub Pro account, with unlimited private
> repositories, through
> [GitHub Education](https://education.github.com/discount_requests/application).

## Download It to Your Computer

**Cloning** is downloading your project so you can work on it on your own
machine.

1. On your project’s page on GitHub, click the green **Code** button and copy
   the HTTPS URL.
2. In VS Code, press **Cmd+Shift+P** (macOS) or **Ctrl+Shift+P** (Windows,
   Linux) and run **Git: Clone**.
3. Paste the URL, then pick the folder where you keep your work.
4. VS Code clones the project and asks whether to open it. Click **Open**.

> [!TIP]
>
> **Terminal:** open a terminal in the folder where you keep your work, run
> `git clone` with your own URL, then use **File > Open Folder** on the folder
> it creates.
>
> ```bash
> git clone https://github.com/YOUR-USERNAME/your-project-name.git
> ```

Open the project folder itself, not a folder above it. Every step from here on
assumes it is the folder you have open in VS Code.

## Install What the Project Needs

One command, in VS Code’s terminal:

```bash
npm install
```

It downloads what the tool runs on, takes a minute or two, and prints a lot of
text along the way. You run it once now, and again whenever an update brings in
something new.

## Try It

1. Clone your project and open the folder in VS Code.
2. Open the terminal with **Ctrl+`** and run `npm install`.
3. Run `npx course --help`.

> [!CHECK]
>
> The Explorer shows folders called `course`, `docs` and `evaluations`, and
> `npx course --help` prints the list of commands.

> [!NOTE]
>
> [Your first course, step by step](https://github.com/lars-derichter/coursewright/blob/main/docs/first-course.md#5-create-your-course-project)
> walks the same two steps and says what to check on the GitHub page before you
> carry on.
