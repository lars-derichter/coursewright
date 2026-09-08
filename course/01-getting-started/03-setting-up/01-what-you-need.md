---
title: ⚙️ What You Need
canvas_type: page
---

Four things, all free: three programs and one account. You install them once and
then forget about them. If you already have them, go straight to
[Your Course Project](02-your-course-project.md).

Take them in the order below. On macOS the git install runs from inside VS Code,
so VS Code comes first.

> [!NOTE]
>
> **The terminal** is the panel where you type commands instead of clicking. VS
> Code has one built in, and **Ctrl+`** opens and closes it. A few of the steps
> below need it; once the Course Manager panel is up, nearly everything else is
> a labelled button. Type a command, press Enter, and wait for the prompt to
> come back before you type the next one.

## VS Code

Visual Studio Code is the editor you will write in, and it runs on Windows,
macOS and Linux. Download it from
[code.visualstudio.com](https://code.visualstudio.com/) and install it with the
defaults.

On macOS, do one more thing while you are there: press **Cmd+Shift+P**, type
`shell command`, and choose **Shell Command: Install 'code' command in PATH**.
The Course Manager extension needs it later on.

## Node.js

Node.js is the engine this tool runs on. You will never use it directly.
Download the **LTS** version from [nodejs.org](https://nodejs.org/), as long as
it is 24 or higher, and accept the installer’s defaults.

## Git

Git keeps the history of your course and syncs it with GitHub. How you install
it depends on your system.

- **Windows:** download the installer from
  [git-scm.com/downloads](https://git-scm.com/downloads) and click through it.
  The defaults are fine.
- **macOS:** open VS Code’s terminal and run `xcode-select --install`.
- **Linux:** `sudo apt install git` on Ubuntu or Debian, `sudo dnf install git`
  on Fedora.

Then tell git who you are, because your name goes on every change you save:

```bash
git config --global user.name "Your Name"
git config --global user.email "your.email@example.com"
```

## A GitHub Account

GitHub is where your course lives online. It is your backup, your history, and
the way you pull in improvements to the tooling later. If you do not have an
account, sign up at [github.com/signup](https://github.com/signup) and verify
your email address.

## Try It

1. Open VS Code and press **Ctrl+`** to open its terminal.
2. Run `node --version`.
3. Run `git --version`.

> [!CHECK]
>
> Both print a version number, and the Node one is `v24` or higher.

> [!NOTE]
>
> [Your first course, step by step](https://github.com/lars-derichter/coursewright/blob/main/docs/first-course.md#1-install-vs-code)
> covers these same four installs with the per-system detail, and
> [Troubleshooting](https://github.com/lars-derichter/coursewright/blob/main/docs/troubleshooting.md)
> has the common failures.
