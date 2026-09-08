# Your First Course, Step by Step

This guide takes you from a computer with nothing installed to a published
course module: on a course website, as a PDF or Word handout, or in Canvas. You
choose the route in the final step, and the built-in tutorial module you preview
along the way is a working example of every content type a course can create on
its own. It assumes no experience with VS Code, the command line, or git. Most
of what follows is clicking a labelled button in VS Code, with the terminal
command named alongside for anyone who would rather type.

Set aside about an hour for the first run. You do most of it once and never
again.

If a step fails, [Troubleshooting](troubleshooting.md) covers the common
failures. If you would rather read what the tool does before installing it, the
[user guide](user-guide.md) is the reference and [limitations](limitations.md)
is the honest list of what it will not do.

## What You Will Install

Three programs, all free, all standard:

- **[VS Code](https://code.visualstudio.com/)**: the editor you will write in.
- **[Node.js](https://nodejs.org/)**: the engine the tool runs on. You will
  never use it directly.
- **[Git](https://git-scm.com/downloads)**: keeps the history of your course and
  syncs it with GitHub.

And one account: **[GitHub](https://github.com/signup)**, where your course
lives online.

## 1. Install VS Code

Go to [code.visualstudio.com](https://code.visualstudio.com/), download the
version for your system, and run the installer. The defaults are fine.

On Windows, one checkbox in the installer is worth ticking: **Add to PATH**. It
is on by default. On macOS, drag the app to your Applications folder, then open
VS Code and do this once:

1. Press **Cmd+Shift+P** to open the command palette, a search box for
   everything VS Code can do. You will use it a lot.
2. Type `shell command` and choose **Shell Command: Install 'code' command in
   PATH**.

That step lets the bundled VS Code extension install itself later. Skip it and
you will hit a confusing error in step 7.

## 2. Install Node.js

Go to [nodejs.org](https://nodejs.org/) and download the **LTS** version, as
long as it is 24 or higher. Run the installer and accept the defaults.

## 3. Install Git

**Windows:** download the installer from
[git-scm.com/downloads](https://git-scm.com/downloads) and click through it. The
defaults are fine.

**macOS:** open VS Code, then open its built-in terminal with **Ctrl+`** (the
backtick key, top-left on most keyboards). Type this and press Enter:

```bash
xcode-select --install
```

**Linux:** `sudo apt install git` on Ubuntu or Debian, `sudo dnf install git` on
Fedora.

Then tell git who you are. This name appears in your course history:

```bash
git config --global user.name "Your Name"
git config --global user.email "your.email@example.com"
```

[Git and GitHub basics](git-and-github.md) explains what git is and what each
git command in this guide does; copying them as they come is enough to follow
along.

> [!NOTE]
>
> **The terminal** is the panel where you type commands instead of clicking. VS
> Code has one built in: **Ctrl+`** opens and closes it. A handful of install
> steps in this guide need it; once the Course Manager panel is up, most of what
> follows is clicking a labelled button instead. You type a command, press
> Enter, and wait for the prompt to come back before typing the next one.

## 4. Create Your GitHub Account

If you do not have one, sign up at
[github.com/signup](https://github.com/signup) and verify your email address.

GitHub is where your course files live online. It is your backup, your history,
and the way you will pull in improvements to the tooling later.

## 5. Create Your Course Project

Coursewright is a **template**: you make your own copy, and your copy is yours.
Changes you make never affect the original, and you can make one copy per
course. On GitHub, each copy is a **repository**: one project's files together
with their whole history.

1. Open the
   [Coursewright project page](https://github.com/lars-derichter/coursewright).
2. Click **Use this template** at the top right, then **Create a new
   repository**.
3. Give it a name that says which course it is: `course-web-development`,
   `course-databases`. You will thank yourself when you have four of them.
4. Choose **Private** or **Public**, and click **Create repository**.

> [!WARNING]
>
> If you will keep exams or tests in the `evaluations/` folder, make the
> repository **private**. A public repository is public: students can find it.
> You can change this later under **Settings > General > Danger Zone**, and
> educators can get a free GitHub Pro account with unlimited private
> repositories through
> [GitHub Education](https://education.github.com/discount_requests/application).

Check the page header now says `github.com/YOUR-USERNAME/your-project-name`
before continuing.

## 6. Download It to Your Computer

**Cloning** means downloading your project so you can work on it locally.

1. On your project's GitHub page, click the green **Code** button and copy the
   HTTPS URL.
2. In VS Code, open the command palette (**Cmd/Ctrl+Shift+P**) and run **Git:
   Clone**.
3. Paste the URL when asked, then choose a folder where you keep your work:
   `Documents`, for example.
4. VS Code clones the project and asks whether to open it. Click **Open**.

> [!TIP]
>
> **Terminal:** open a terminal
> (**Ctrl+`**) in the folder where you keep your work, run `git clone` with your
> own URL, then use **File > Open Folder** on the folder it creates.
>
> ```bash
> git clone https://github.com/YOUR-USERNAME/your-project-name.git
> ```

From here on, every step in this guide happens with this folder open in VS Code.

> [!NOTE]
>
> The project has plenty of files you will never open: `lib/`, `cli/`, `docs/`,
> config files, all tooling. Five things are yours: `course/` (what students
> see), `sources/` (lesson plans and notes), `context/` (the style guide and
> course-design facts), `evaluations/` (exams and tests), and `README.md`.
> Everything else runs itself.

## 7. Install the Tooling

Two commands, typed in the terminal. These are the ones everybody types; the
rest of this guide is clicking.

```bash
npm install
```

Downloads what the tool needs. It takes a minute or two and prints a lot of
text.

```bash
npm run vscode:install
```

Installs the Course Manager extension into VS Code, so every command from here
on is a click.

Then open the command palette and run **Developer: Reload Window**. A book icon
appears in the left-hand activity bar: that is the **Course Manager** panel.

If `npm run vscode:install` fails with a message about `code` not being found,
go back to step 1 and install the shell command.

## 8. The Course Manager Panel

Click the book icon in the activity bar. The panel shows your course as a tree:
modules, the subsections inside them, and the items inside those. Click a row to
open that file in the editor.

Four buttons sit in the panel's title bar: **Course: New Module**, **Course:
Search...**, **Course: Preview** and **Course: Refresh Tree**. The `…` dropdown
beside them adds the whole-course Canvas commands and the course export.
Right-click a row for the actions that apply to it, which differ for a module
and an item.

The tree already has one module in it, **Getting Started**, so there is
something to click straight away. [VS Code integration](vscode.md) is the full
reference for the panel.

## 9. Make It Your Course

The template ships as a working example. The setup wizard turns it into yours.

Open the command palette and run **Course: Setup (First-Run Wizard)**. The
panel's welcome view carries a Setup button of its own, but it only appears when
the tree finds no modules; a fresh clone ships the **Getting Started** module,
so the tree is never empty and that button never shows. The palette is the route
that always works.

The wizard runs in the shared **Coursewright** terminal and asks its questions
there: your course name, the language of the labels students see, the look of
the site and the exports, and whether to remove the built-in tutorial module. It
ends by offering to connect Canvas; skip that for now, the Canvas route in step
12 comes back to it. Answer, and it writes the configuration for you.

> [!TIP]
>
> **Terminal:** `npx course setup` runs the same wizard. `npx` runs a tool that
> came with the project, nothing extra to install; every command in this project
> starts with `npx course`, and `npx course --help` lists them all.

[Customisation](customisation.md) explains every choice and how to change it
later. If you work with an AI assistant, the `/course-setup` skill walks the
same ground and writes the prose the command cannot; see
[AI assistants](ai-assistants.md).

## 10. Preview Your Course

Click **Course: Preview** in the panel's title bar. It starts the dev server, if
it is not already running, and opens your browser at `localhost:3000` showing
your course. Leave it running: it updates as you write. The
`courseManager.previewPort` setting changes the port, for when something else on
your machine already holds 3000.

> [!TIP]
>
> **Terminal:** `npm start` runs the same preview. It keeps the terminal busy
> while the preview is open; press **Ctrl+C** to stop it, or open a second
> terminal for other commands with the **+** button at the top right of the
> terminal panel.

Read the **Getting Started** module in that preview. It is the built-in
tutorial, a working example of every content type a course can create on its
own, and it teaches markdown, the folder layout and the daily workflow from the
panel you just installed. Every page in it survives the trip to each of the
publish routes in step 12. The same module is live at
[coursewright.md](https://coursewright.md/), so you can compare what you see
with the published version.

## 11. Write Something

Click **Course: New Module** in the panel's title bar. It asks for a name and
adds the module after the last one; move it afterwards if it belongs somewhere
else.

Right-click the new module and choose **Course: New Item**. It asks which of six
types you want and a name; a page is the one to pick for a first try. The item
lands at the end of the module too.

Write in the file that appears and watch it change in the preview.

> [!TIP]
>
> **Terminal:** `npx course new-module` and `npx course new-item` create the
> same things. Unlike the panel, `new-module` also asks where to put the new
> module.

## 12. Publish It

The same files publish three ways. Pick the route your course needs today; the
other two stay open.

### A Website

On GitHub, go to **Settings > Pages** and set **Source** to **GitHub Actions**;
from then on, every push to GitHub (step 13 does the first one) rebuilds the
public site at `https://YOUR-USERNAME.github.io/your-project-name/`.
[Hosting](hosting.md) covers the paid-plan requirement for private repositories
(free for educators) and what the site does and does not include.

### A PDF or Word Handout

A Word export needs only pandoc, a free tool with a double-click installer on
every platform; a PDF export also needs Typst, which is more work to install.
[Exporting](exporting.md#what-you-need) has both, per platform.

Then right-click your module in the tree and choose **Course: Export Module to
PDF/DOCX...**, and pick PDF or Word. The styled file lands in `exports/`.

> [!TIP]
>
> **Terminal:** `npx course export -m 01-your-module` does the same, using your
> module's folder name. Add `-f docx` for Word, or drop `-m` to export the whole
> course as one document.

### Canvas

Before you connect Canvas, read [Backing up a Canvas course](backups.md). It
takes five minutes and it is the one step in this guide you cannot undo by
retrying. If your Canvas course already has content in it, export it first; if
you can get an empty sandbox course, point the tool at that until you trust it.

Open the command palette and run **Course: Init (Canvas Setup)**. It asks for
three things: your Canvas web address, an access token, and the course ID.
[Canvas setup](canvas-setup.md) shows where to find each one. They go into a
`.env` file that stays on your computer and is never uploaded.

> [!TIP]
>
> **Terminal:** `npx course init` runs the same setup.

Check what would happen on Canvas before anything happens. Open the command
palette and run **Course: Push to Canvas (Dry Run)**. Read that output. When it
says what you expect, open the panel's `…` dropdown and choose **Course: Push to
Canvas**.

> [!TIP]
>
> **Terminal:** `npx course push --dry-run`, then `npx course push`.

Open the course in Canvas. Your module is there.

Whichever route you took, the other two read the same files: no route locks the
others out, and nothing you wrote belongs to just one of them.

## 13. Save Your Work

Committing is how you keep a version you can return to.

Open the Source Control panel: the branch icon in the activity bar, or
**Ctrl+Shift+G** (Windows, Linux) / **Cmd+Shift+G** (macOS). It lists every file
you have changed. Stage a file with the **+** next to it, or stage everything
with the **+** next to **Changes**. Type a short message in the box, click
**Commit**, then click **Sync Changes** to push it to GitHub.

> [!TIP]
>
> **Terminal:** the same three steps, typed:
>
> ```bash
> git add .
> git commit -m "Add the first module"
> git push
> ```

`add` selects the changes, `commit` records them with a message, and `push`
uploads them to GitHub. Do this at the end of every writing session. Small,
frequent commits are far easier to undo than one big one.

[Git and GitHub](git-and-github.md) explains what is actually happening here.

## Where to Go Next

- **[User guide](user-guide.md)**: the course structure and every daily command.
- **[VS Code integration](vscode.md)**: the full reference for the Course
  Manager panel, the palette, and every command.
- **[CLI reference](cli-reference.md)**: every command and flag, for when you
  need one the panel does not reach.
- **[Markdown guide](markdown.md)**: the formatting syntax, links, images, and
  the coloured alert boxes.
- **[Lesson workflow](lesson-workflow.md)**: designing a course with an AI
  assistant, starting from what students should be able to do.
- **[Hosting](hosting.md)** and **[exporting](exporting.md)**: the full guides
  for the publish routes, including the ones you skipped today.
- **[Limitations](limitations.md)**: what the tool will not do, and what to do
  instead.
