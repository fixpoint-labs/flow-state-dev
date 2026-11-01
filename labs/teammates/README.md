# Teammates

A private lab that copies the core layout and interaction of Grok Bot on the workforce package. It
is one half of the evidence that the same package pieces make familiar apps: an app adds only
configuration, React UI and a few small flows, and anything else it needs is a gap filed against the
package.

Its theme is its own: a dark, chat-first look like Grok Bot's, in `src/lib/theme.css`, over the
registry's `tokens` item. The other labs take theirs from the design system; this one keeps a local
theme on purpose, so it reads as the app it copies.

- **Left:** the teammates, Chief of Staff, researcher and writer. Each row is a teammate with an
  ongoing role, never a list of sessions. A row shows the teammate's icon on its color, a line
  saying what it is doing now (*Replying to you*, *Messaging writer*, *Running coding task: …*,
  *Idle*), and how many new entries its conversation has since you last looked. The same icon
  marks the teammate in the conversation's header, on message lines and in popups; the header
  carries the same status line. Under them, *Background* lists the coding
  tasks they started; each opens its run in a popup, read only.
- **Center:** the chosen worker's one conversation. It goes on for weeks. A divider marks where the
  turns the worker reads word for word begin; it reads *summarized* only when the earlier turns were
  summarized for the worker. New content settles in place: the list follows an answer as it is
  written only while you are at the end, and offers *Jump to latest* when you have scrolled up; a
  task's line is drawn the moment it is filed and fills in where it is. Enter sends; Cmd+Enter
  (Ctrl+Enter) sends from every box, including a teammate's instructions, where plain Enter is a
  new line.
- **Popup:** a message line or a task line in the conversation opens that piece of work in a popup
  over it: the other worker's session, read only and live. It closes with Esc, its close button, or
  a click outside it, and the conversation under it keeps its place.
- **Right:** Talk, the worker's exchanges with the other workers, grouped by worker, from the
  message log. It closes.
- **The page's address** names the open teammate and an open task popup
  (`?worker=<id>&session=<id>&task=<id>`), so a reload or a link reopens them, and Back returns
  to what you had open before. A link to a teammate or task that is gone opens the first teammate.

Workers message each other where you can see it. When Chief of Staff messages researcher, a line,
*Messaged researcher*, shows in Chief of Staff's conversation and the message lands in researcher's.
The line opens researcher's turn on it in a popup: what it read, what it did, and the reply it sent. The reply lands
in Chief of Staff's conversation under researcher's name. A message never interrupts the turn you
are in: while Chief of Staff is answering you, researcher's reply shows as a pending line, and Chief
of Staff reads it right after.

Each worker does real work. researcher reads the working folder's files and searches the web, writer
drafts from the working folder's files and from pages it fetches, and Chief of Staff hands out the
work. Chief of Staff sends a quick ask as a message, and real work as a task: a job that needs the
folder's files read to researcher or writer, and a job in several parts as several tasks, in order.
Every result lands back in Chief of Staff's conversation as one line, *researcher finished: Look up
the launch date*, that opens the task in a popup, where the whole result is. Chief of Staff's own
answer on it shows in full below.

A code change is a coding task, not a teammate's job. Coding runs in the background, the way a
coding agent's job does: you watch it, you don't talk to it. Ask Chief of Staff for a code change
and Chief of Staff starts a coding task in the working folder, on one of three coding agents:
Claude Code, Codex or Cursor. Name one ("have Codex do it") and that one runs; name none and Cursor
does, with no question first. Each agent is a worker of its own, off the list and never
messaged, whose `WORKER.md` names its `harness:`. A line in Chief of Staff's conversation and an
item under *Background* show the task, tagged with the agent it runs on (and the model, once the
run reports one), and open its run in a popup. The result lands in Chief of Staff's conversation as
the coding task's line, *Coding task finished: …*. To change a coding task, tell Chief of Staff, who starts the next one.

A coding task's popup says *Starting on Codex…* from the moment the task is filed. Once the run
starts, its steps show as they happen, and once it ends, the result is at the top, above them. The
steps are plain: what the agent wrote, as text, and what it did, such as *Read …/src/session-feed.ts*, *Edit README.md* or the command it ran.
A run of steps folds into one line, *Ran 3 commands and edited a file*, that opens to each one.
The steps read the same on all three agents, though each names its tools its own way. A Claude
Code run loads the working folder's own Claude Code settings and `CLAUDE.md`, never this
machine's, so an output style set there doesn't show in its steps.

Before a task starts, its agent's own sign-in check runs. An agent this machine isn't set up for
fails the task at once, with a line that names it and what's missing, such as "Codex isn't set up on
this machine: Not logged in. Sign in with `codex login`, then start the task again." It never runs
on another agent instead.

There is one working folder, a git checkout you name when you start the lab, and every job that
needs files works in it. Nothing on the page picks a folder, and no worker can name another one.

You can hire teammates of your own (*Hire a teammate*, under the list): a name, one line on what it
does, and its instructions. It joins the list at once, you can talk to it, and Chief of Staff can
hand it tasks. Your own teammates get an *Instructions* control, which replaces their instructions
from the next turn on, and *Fire*, which takes them off the list; their conversation stays readable.
The three teammates from the files can't be edited or fired.

Scope is core messaging and session management. There are no group chats, no new-chat button and
no session list. The design and the decisions behind it are in the
[spec](../../specs/issues/FIX-2154/SPEC.md).

## Run it

The lab runs on a real model and a durable SQLite store, served by `fsdev dev`:

```bash
pnpm --filter @flow-state-dev/teammates dev
```

The team works in this repository's checkout. To point it at another one, set
`TEAMMATES_WORKDIR=/path/to/checkout`. Then ask Chief of Staff to fix something in it.

This builds the pages and serves them with the lab's server (`fsdev.config.mts`). It reads:

| Variable | What it sets | Default |
|---|---|---|
| `TEAMMATES_MODEL` | the model Chief of Staff, researcher and writer answer on | `openai/gpt-6-luna` |
| `TEAMMATES_WORKDIR` | the working folder: an absolute path to a git checkout on this machine | the root of this repository |
| `TEAMMATES_HARNESS` | the harness a coding worker whose file names none runs on: `claude-code`, `codex` or `cursor` | `cursor` |
| `TEAMMATES_STORE` | the SQLite file | `.fsdev/teammates.sqlite` here |
| `TEAMMATES_USER` | who the page acts as | `you` |
| `TEAMMATES_TREE` | the workers' tree | `workforce/` here |

The model needs a credential the gateway takes (`AI_GATEWAY_API_KEY`). Each coding agent needs its
own sign-in: Claude Code signed in, or `ANTHROPIC_API_KEY`; Codex signed in (`codex login`), or
`CODEX_API_KEY`; Cursor signed in, or `CURSOR_API_KEY`. Cursor runs on `composer-2.5`. researcher's web
search needs one search provider's key (`TAVILY_API_KEY`, `EXA_API_KEY`, `BRAVE_API_KEY`, or another
`@flow-state-dev/tools` takes); fetching a page needs none.

With `TEAMMATES_WORKDIR` unset, the working folder is the root of this repository. Naming a folder
that doesn't exist or isn't a git checkout stops the lab at start with an error that names the
setting and the path; it never falls back to the current directory. Each coding run
works in a worktree of the folder, under the lab's `.fsdev/teammates-runs/`, so the checkout's
`.gitignore` must ignore `**/.fsdev/`, where a run keeps its own notes; a run refuses a checkout
that doesn't. The checkout's own branch and working tree are never changed.

With a working folder whose README says the launch date, ask Chief of Staff *"Ask researcher for our
launch date, and help me outline the post."* Chief of Staff answers and messages researcher, which
reads the date from the README. Before researcher replies, send Chief of Staff a second line: the
reply shows as pending, then lands after Chief of Staff's answer, and Chief of Staff uses it in its
next line.

A conversation outlasts its history window (50 turns). Before a turn leaves it, the turn is folded
into a running summary that Chief of Staff reads with the turns it still has word for word. The
divider sits where those begin, labelled *summarized*, so a fact you gave Chief of Staff a hundred
lines ago is above it and Chief of Staff still knows it.

Then ask Chief of Staff *"Fix the typo in the README's first line."* Chief of Staff starts a coding
task, the run shows its steps, and the result lands in Chief of Staff's conversation.

The goal check drives all of this in a browser:
[`goals/teammates-lab/a-worker-talks-to-another-while-you-talk`](../../goals/teammates-lab/a-worker-talks-to-another-while-you-talk/goal.md).

## What the screen reads

Everything the screen reads and writes goes through one adapter, `src/adapter.ts`, and each function
names the package call it makes.

| On screen | Package piece |
|---|---|
| The worker list, sending, the conversation, busy status | the workforce client's `roster()` and `ensureWorkerSession`, the flow's `respond`, session items, `listSessionRequests` |
| Workers messaging each other, the Talk panel | `sendMessage`, the received-message item (`workforce:received`), and the message log |
| Hiring, changing and firing your own teammates | the workforce client's `hire`, `edit` and `fire`, on the roster flow |
| Task lines | the conversation board's rows |
| A teammate's icon and color | its `WORKER.md`'s `icon:` and `color:` lines, declared on the `agent` flow with `settings` and shown on its `roster()` row with `showSettings` |
| The status line | the conversation's requests (`listSessionRequests`) and items for what it is answering, the board's rows for a running coding task, the message log for a message waiting on a reply |
| A message's popup | the recipient's session items: the turn whose received-message item carries the message's id |
| The working folder | `localWorkspaceHost` with a constant run source, `{ kind: "repo", repo }`, and the folder in `localRepositories`; `projectSourceTools` read it |
| Coding tasks and their runs | the conversation board's rows assigned to the worker on the coding flow, which the list leaves out; the row's `run` link, read as the run session's items |
| A run's steps in plain words | the UI registry's `tool-naming` and `tool-grouping`, installed in `src/components/flow-state/`, over each tool call's name and arguments |
| The divider and its *summarized* label | the last request's `historyStart`, and the session's `historySummary` resource |

`color:` names one of the lab's palette, `blue`, `green`, `amber`, `rose`, `violet` or `teal`,
each a `--teammate-*` token in the theme. A teammate whose file sets neither line, such as one you
hire here, gets its initial on a palette color picked from its id.

Not wired yet:

- **Cursor under a long runs folder.** Cursor's SDK names a folder of its own after the run's whole
  worktree path, and the worktree path `harness-manager` makes is long, so under the lab's default
  runs folder a Cursor run fails with `ENAMETOOLONG` (FIX-2344). A short `runsRoot`, such as
  `/tmp/r`, works today.
- **Editing a worker from the files.** They are read-only on the roster; how a user changes one (a
  fork that stands in for it, or another way) waits on a product call.
- **Saving writer's drafts.** No package tool writes files from a worker's turn yet, so writer
  answers with the draft rather than saving it.
- **The source tools' own descriptions say "project".** `projectSourceTools` describe what they read
  as "the project this session works in". Here that is the working folder; the lab doesn't rename
  package tools.
- **A task whose input has an `issue` field** is refused by the coding run as half a feature payload
  (FIX-2282). Chief of Staff's `WORKER.md` tells it to leave `input` empty, which only lowers the
  odds.
