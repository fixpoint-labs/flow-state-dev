# Teammates

A private lab that copies the core layout and interaction of Grok Bot on the workforce package. It
is one half of the evidence that the same package pieces make familiar apps: an app adds only
configuration, React UI and a few small flows, and anything else it needs is a gap filed against the
package.

Its theme is its own: a dark, chat-first look like Grok Bot's, in `src/lib/theme.css`, over the
registry's `tokens` item. The other labs take theirs from the design system; this one keeps a local
theme so it reads as the app it copies.

- **Left:** the teammates, Chief of Staff, researcher and writer. Each row is a teammate with an
  ongoing role, never a list of sessions. A row shows the teammate's icon on its color, a line
  saying what it is doing now (*Replying to you*, *Messaging writer*, *Running coding task: …*,
  *Idle*), and how many new entries its conversation has since you last looked. The same icon
  marks the teammate in the conversation's header, on message lines and in popups; the header
  carries the same status line.
- **Center:** the chosen worker's one conversation. It goes on for weeks, past its history window
  of 50 turns: before a turn leaves the window, it is folded into a running summary that the worker
  reads with the turns it still has word for word. A divider marks where the word-for-word turns
  begin, and reads *summarized* once earlier turns have been folded in. While a worker answers, the
  tools it uses show in the conversation as it uses them, each saying what it acted on (*Read
  …/next/plan.md*, *Search "codename" · 2 matches*). A run of them is one line, open while it runs
  and folded once it is done, *Searched the code and read a file*, that opens to each. A step whose
  result says it failed, such as a read the working folder refused, reads *(failed)* in red.
- **Typing and scrolling:** a line you send rises to near the top and its answer is written below
  it; nothing else moves the list, and *Jump to latest* appears when there is more below. A task's
  line is drawn the moment it is filed and fills in where it is. Enter sends; Cmd+Enter
  (Ctrl+Enter) sends from every box, including a teammate's instructions, where plain Enter is a
  new line.
- **Popup:** a message line or a task line in the conversation opens that piece of work in a popup
  over it: the other worker's session, live. A task's popup also has the task's buttons (below). It closes with Esc, its close button, or
  a click outside it, and the conversation under it keeps its place.
- **Right:** the open teammate's panel. At the top, its name and role, and *Edit instructions*.
  Under that, the tasks its conversation started, coding tasks and teammates' jobs alike. Running
  tasks come first. *Done*, *Failed* and *Cancelled* each fold into one line with a count, and a
  click opens the rows. A task that ends moves into its group as it ends. Each row opens the task in
  a popup. A *Routines* section sits at the foot, empty for now.
- **Keys:** ⌘K (Ctrl+K) finds a teammate by its name or role, or opens *Hire a teammate*. Alt+↑
  and Alt+↓ move to the previous or next teammate. `/` puts the cursor in the composer, and `?`
  lists every key. Opening a teammate puts the cursor in its composer. Firing a teammate you hired
  asks first in a row under the header, with *Keep* focused.
- **The page's address** names the open teammate and an open task popup
  (`?worker=<id>&session=<id>&task=<id>`), so a reload or a link reopens them, and Back returns
  to what you had open before. A link to a teammate or task that is gone opens the first teammate.

Scope is core messaging and session management. There are no group chats, no new-chat button and
no session list. The design and the decisions behind it are in the
[spec](../../specs/issues/FIX-2154/SPEC.md).

## How the team works

### Messages and tasks

Workers message each other where you can see it. When Chief of Staff messages researcher, a line,
*Messaged researcher*, shows in Chief of Staff's conversation and the message lands in researcher's.
The line opens researcher's turn on it in a popup: what it read, what it did, and the reply it sent.
The reply lands in Chief of Staff's conversation under researcher's name. A message never interrupts
the turn you are in: while Chief of Staff is answering you, researcher's reply shows as a pending
line, and Chief of Staff reads it right after.

Each worker does real work. researcher reads the working folder's files and searches the web, writer
drafts from the working folder's files and from pages it fetches, and Chief of Staff hands out the
work. Chief of Staff sends a quick ask as a message, and real work as a task: a job that needs the
folder's files read goes to researcher or writer, and a job in several parts goes out as several
tasks, in order. Every result lands back in Chief of Staff's conversation as one line, *researcher
finished: Look up the launch date*, that opens the task in a popup, where the whole result is. A task
that finished without writing a result says so there, in place of the result. Chief of Staff's own
answer on it shows in full below.

### Coding tasks

A code change is a coding task, not a teammate's job. Coding runs in the background, the way a
coding agent's job does: you watch it, you don't talk to it. Ask Chief of Staff for a code change
and Chief of Staff starts a coding task in the working folder, on one of three coding agents:
Claude Code, Codex or Cursor. Name one ("have Codex do it") and that one runs; name none and Cursor
does, with no question first. Each agent is a worker of its own, off the list and never
messaged, whose `WORKER.md` names its `harness:`. The rest of that file is the agent's
instructions: every run on it is told them before the task. A line in Chief of Staff's conversation and a
row in Chief of Staff's panel show the task, tagged with the agent it runs on (and the model, once the
run reports one), and open its run in a popup. Once the run reports what it spent, the line adds its
tokens and, when the vendor reported a charge, the cost; the popup splits input from output tokens, and
the panel totals Chief of Staff's coding tasks. A run billed by subscription shows tokens and no cost.
The result lands in Chief of Staff's conversation as
the coding task's line, *Coding task finished: …*. To change a coding task, tell Chief of Staff, who starts the next one,
or use the task's buttons.

A task's popup has its buttons, which act on the task's row with no turn of Chief of Staff's in
between. While the task runs: **Cancel**, which asks once, and a **Steer** line whose words reach
the run. Once it failed or was cancelled: **Retry**, which runs it again as the same task, and, for
a coding task, one **Re-run on …** per other coding agent. A re-run is a new task on that agent,
its brief the old one plus a line naming the task it re-runs; the old task stays as it was, and the
result lands in Chief of Staff's conversation like any other. When the board refuses a press (the
same work is already open on that agent, say), its words show in place. A failed task's reason
shows as an error at the top of its popup.

A coding task's popup says *Starting on Codex…* from the moment the task is filed. Once the run
starts, its steps show as they happen, and once it ends, the result is at the top, above them. The
steps are plain: what the agent wrote, as text, and what it did, such as *Read
…/src/session-feed.ts*, *Edit README.md* or the command it ran. A run of steps folds into one line,
*Ran 3 commands and edited a file*, that opens to each one. The steps read the same on all three
agents, though each names its tools its own way. A Claude Code run loads the working folder's own
Claude Code settings and `CLAUDE.md`, not your user-level ones, so an output style set in yours
doesn't show in its steps.

A coding task that committed waits for your review before it completes. Its popup shows *Ready for
review*: the commits on its branch, and a judge's verdict on whether the run did what the task
asked, which is information, not approval. **Accept** completes the task. **Ask for changes**, with
your words, sends them to the same coding session for one more run, which you review again. A run
that asks you something shows its question in the popup with a box for your answer, and goes on
with it.

When the lab starts, it checks which coding agents this machine can run and logs a table:

```
Coding harnesses on this machine:
✓ Cursor
✗ Codex: Codex has no credential: Not logged in. Run `codex login`, or set CODEX_API_KEY.
? Claude Code: The check did not answer within 30 s.
```

Chief of Staff sees the same rows, so it starts coding tasks only on an agent marked ✓ and tells
you what to run for one that isn't. The `harness-readiness` flow's `read` action returns the rows,
and `{ refresh: true }` checks again. A task on an agent last read as not ready is checked once
more before it starts, so signing in after the lab started works without a restart. If it still
isn't ready, the task fails at once with a line that names the agent and what to run, such as
"Codex isn't set up on this machine: Codex has no credential: Not logged in. Run `codex login`, or
set CODEX_API_KEY. Then start the task again." It never runs on another agent instead.

There is one working folder, a checkout you name when you start the lab (see [Run it](#run-it)),
and every job that needs files works in it. Nothing on the page picks a folder, and no worker can
name another one.

### Your own teammates

You can hire teammates of your own (*Hire a teammate*, under the list): a name, one line on what it
does, and its instructions. It joins the list at once, you can talk to it, and Chief of Staff can
hand it tasks. Your own teammates' panels have *Edit instructions*, which replaces their instructions
from the next turn on, and their header has *Fire*, which takes them off the list; their conversation stays readable.
The three teammates from the files can't be edited or fired.

## Run it

The lab runs on a real model and a durable SQLite store, served by `fsdev dev`:

```bash
pnpm --filter @flow-state-dev/teammates dev
```

The command builds the pages and serves them with the lab's server (`fsdev.config.mts`). It reads:

| Variable | What it sets | Default |
|---|---|---|
| `TEAMMATES_MODEL` | the model Chief of Staff, researcher and writer answer on | `openai/gpt-6-luna` |
| `TEAMMATES_WORKDIR` | the working folder: an absolute path to a git checkout on this machine | the root of this repository |
| `TEAMMATES_HARNESS` | the harness a coding worker whose file names none runs on: `claude-code`, `codex` or `cursor` | `cursor` |
| `TEAMMATES_STORE` | the SQLite file | `.fsdev/teammates.sqlite` here |
| `TEAMMATES_USER` | who the page acts as | `you` |
| `TEAMMATES_TREE` | the workers' tree | `workforce/` here |
| `TEAMMATES_RUNS` | the folder each coding run's worktree goes in | `.fsdev/teammates-runs/` here |
| `TEAMMATES_RUN_TIMEOUT_MS` | the wall-clock budget for one coding run, in milliseconds | `1200000` (20 minutes) |
| `TEAMMATES_SETUP` | a command each fresh worktree runs before its coding run starts, such as `pnpm install --frozen-lockfile`; no shell | none |
| `TEAMMATES_CHECKS` | the commands a coding run's worktree must pass before its task is done, `;`-separated, such as `pnpm typecheck; pnpm test`; no shell, so a `;` inside one command, even quoted, isn't supported. A red one sends the run back with the command's output | none |

The model needs a credential the gateway takes (`AI_GATEWAY_API_KEY`). Each coding agent needs its
own sign-in: Claude Code signed in, or `ANTHROPIC_API_KEY`; Codex signed in (`codex login`), or
`CODEX_API_KEY`; Cursor signed in, or `CURSOR_API_KEY`. Cursor runs on `composer-2.5`. researcher's web
search needs one search provider's key (`TAVILY_API_KEY`, `EXA_API_KEY`, `BRAVE_API_KEY`, or another
`@flow-state-dev/tools` takes); fetching a page needs none.

The team works in this repository's checkout unless `TEAMMATES_WORKDIR` names another. Naming a
folder that doesn't exist or isn't a git checkout stops the lab at start with an error that names
the setting and the path; it never falls back to the current directory. Each coding run works in a
worktree of the folder, under the lab's `.fsdev/teammates-runs/` (or `TEAMMATES_RUNS`), so the
checkout's `.gitignore` must ignore `**/.fsdev/`, where a run keeps its own notes; a run refuses a
checkout that doesn't. The checkout's own branch and working tree are never changed.

### Try it

With a working folder whose README says the launch date, ask Chief of Staff *"Ask researcher for our
launch date, and help me outline the post."* Chief of Staff answers and messages researcher, which
reads the date from the README. Before researcher replies, send Chief of Staff a second line: the
reply shows as pending, then lands after Chief of Staff's answer, and Chief of Staff uses it in its
next line.

Keep talking past 50 turns and the divider reads *summarized*: a fact you gave Chief of Staff a
hundred lines ago is above it, and Chief of Staff still knows it.

Then ask Chief of Staff *"Fix the typo in the README's first line."* Chief of Staff starts a coding
task, the run shows its steps, and the result lands in Chief of Staff's conversation.

The goal check drives all of this in a browser:
[`goals/teammates-lab/a-worker-talks-to-another-while-you-talk`](../../goals/teammates-lab/a-worker-talks-to-another-while-you-talk/goal.md).

## What the screen reads

Everything the screen reads and writes goes through one adapter, `src/adapter.ts`, and each function
names the package call it makes.

| On screen | Package piece |
|---|---|
| The worker list, sending, the conversation, busy status | the workforce client's `watchRoster()` and `ensureWorkerSession`, the flow's `respond`, session items, `listSessionRequests` |
| Workers messaging each other | `sendMessage`, the received-message item (`workforce:received`), and the message log |
| Hiring, changing and firing your own teammates | the workforce client's `hire`, `edit` and `fire`, on the roster flow |
| Task lines | the conversation board's rows |
| A teammate's icon and color | its `WORKER.md`'s `icon:` and `color:` lines, declared on the `agent` flow with `settings` and shown on its `roster()` row with `showSettings` |
| The status line | the conversation's requests (`listSessionRequests`) and items for what it is answering, the board's rows for a running coding task, the message log for a message waiting on a reply |
| A message's popup | the recipient's session items: the turn whose received-message item carries the message's id |
| The working folder | `localWorkspaceHost` with a constant run source, `{ kind: "repo", repo }`, and the folder in `localRepositories`; `projectSourceTools` read it |
| Coding tasks and their runs | the conversation board's rows assigned to the worker on the coding flow, which the list leaves out; the row's `run` link, read as the run session's items |
| A task waiting on you, and your answer | the row's holds through the Inbox's `inboxItems` and `taskRowView`, answered with the Inbox client's `answerOne`; a review drawn by the UI registry's `review-hold`, installed in `src/components/flow-state/`, from the run's stop read by harness-manager's `reviewDetail` |
| A task's buttons | the Inbox client's `board(at)` on the conversation that filed it (`cancel`, `steer`, `release`, `retry`, and `refile` for a re-run), drawn by the UI registry's `task-actions`, with a failed task's error drawn by its `error` (`ErrorBody`), both installed in `src/components/flow-state/` |
| A run's steps in plain words, in a popup and inline in the conversation | the UI registry's `tool-naming` and `tool-grouping`, installed in `src/components/flow-state/`, over each tool call's name, arguments, status and result: `toolSubject`, `toolStepState` (with `toolOutcome`), `toolRunState`, `withToolState` and `toolRunOpen` |
| The divider and its *summarized* label | the last request's `historyStart`, and the session's `historySummary` resource |

The conversation follows its session's stream. Busy status, whether a conversation is answering,
and the divider read the conversation's requests when one of them changes, and the divider reads the
`historySummary` resource when it changes, through `client.subscribe`. A long reply costs them no
more reads than a short one. On a host whose push can miss a change, such as the SQLite store the
lab runs on, they also read every 1.5 seconds, as before.

`color:` names one of the lab's palette, `blue`, `green`, `amber`, `rose`, `violet` or `teal`,
each a `--teammate-*` token in the theme. A teammate whose file sets neither line, such as one you
hire here, gets its initial on a palette color picked from its id.

Not wired yet:

- **Editing a worker from the files.** They are read-only on the roster; how a user changes one (a
  fork that stands in for it, or another way) waits on a product call.
- **Saving writer's drafts.** No package tool writes files from a worker's turn yet, so writer
  answers with the draft rather than saving it.
- **The source tools' own descriptions say "project".** `projectSourceTools` describe what they read
  as "the project this session works in". Here that is the working folder; the lab doesn't rename
  package tools.
