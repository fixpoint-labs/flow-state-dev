# Teammates

A private lab that copies the core layout and interaction of Grok Bot on the workforce package. It
is one half of the evidence that the same package pieces make familiar apps: an app adds only
configuration, React UI and a few small flows, and anything else it needs is a gap filed against the
package.

Its theme is its own: a dark, chat-first look like Grok Bot's, in `src/lib/theme.css`, over the
registry's `tokens` item. The other labs take theirs from the design system; this one keeps a local
theme so it reads as the app it copies.

- **Left:** the teammates, Lead, researcher and writer. Each row is a teammate with an
  ongoing role, never a list of sessions. A row shows the teammate's icon on its color, a line
  saying what it is doing now (*Replying to you*, *Messaging writer*, *Running coding task: …*,
  *Idle*), and how many new entries its conversation has since you last looked. The same icon
  marks the teammate in the conversation's header, on message lines and in popups; the header
  carries the same status line. A teammate that needs you says so first, in the attention colour
  and with a badge, and keeps its place in the list: *Needs your OK: …* while it waits for your
  yes, *Waiting on you: …* while one of its tasks does. For two minutes after a coding task of its
  ends, the line says *Coding task finished: …* or *Coding task failed: …*. The tab's title counts
  the teammates with something for you, *(2) Teammates*. *Notify me*, at the foot, asks the
  browser's permission and then sends a desktop notification for each new need or ended coding
  task while the tab is in the background; it is off until you turn it on.
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
- **Files:** paste an image, pick files with **+**, or drop them on the box; each shows above the
  text with a remove button, and your line keeps them, after a reload too. The teammate sees them.
- **Stopping:** while a teammate answers, *Stop* sits beside *Send* and stops every turn it is
  answering; Esc twice or Cmd+. (Ctrl+.) does the same from anywhere on the page, and one Esc
  never does. The button reads *Stopping…* until the turn has ended. The conversation then shows
  *Interrupted by you* after the turn's last line, read from the turn's own record, so a reload
  keeps it. While the tasks it started still run, the newest such line says how many, with *View*.
  A Stop the server refuses says why beside the button.
- **Popup:** a message line or a task line in the conversation opens that piece of work in a popup
  over it: the other worker's session, live. A task's popup also has the task's buttons (below). It closes with Esc, its close button, or
  a click outside it, and the conversation under it keeps its place. While a task runs, its feed
  ends in a live line: the command or file it is on, else its plan step, else its last progress
  note, else "Working...", with how long it has been running.
- **Right:** the open teammate's panel. At the top, its name and role, and *Edit instructions*.
  Under that, the tasks its conversation started, coding tasks and teammates' jobs alike, with
  their count, newest first in each group. Running tasks come first; one waiting on you leads, in
  the attention colour, and every running task shows, however many there are. Failed tasks follow,
  open, each with the first line of its reason: the newest five, with *Show all* and *Show fewer*
  for the rest. *Clear* hides the failed tasks from the panel in this browser; it deletes nothing,
  the heading still counts them, a task that fails again shows again, and *Show N cleared* brings
  them back. *Done* and *Cancelled* each fold into one line with a count, and a click opens
  the rows; *Done* opens to its newest five and a *Show all* button. A task that ends moves into
  its group as it ends. Each row opens the task in a popup, and a task's line in the conversation
  uses the same word and colour as its row. A *Routines* section sits at the foot, empty for now.
- **Keys:** ⌘K (Ctrl+K) finds a teammate by its name or role, or opens *Hire a teammate*. Alt+↑
  and Alt+↓ move to the previous or next teammate. `/` puts the cursor in the composer, and `?`
  lists every key. Opening a teammate puts the cursor in its composer. Firing a teammate you hired
  asks first in a row under the header, with *Keep* focused.
- **The page's address** names the open teammate and an open task popup
  (`?worker=<id>&session=<id>&task=<id>`), so a reload or a link reopens them, and Back returns
  to what you had open before. A link to a teammate or task that is gone opens the first teammate.
- **A task's time:** each task in the panel carries it. A running one reads *working · 4m 12s*,
  counted from when this attempt's run started, so a retried task starts again from zero. A
  running task whose run has stopped answering reads *quiet for 40m* in amber: the run stopped
  renewing its claim on the task (the board's lease lapsed), as when the server running it died,
  and it stays quiet until the board hands the task to a new run. A run that is alive but slow
  keeps renewing, so it never reads quiet; a long clock is the sign there. Nothing reads quiet
  while the panel has lost the server. An ended task says how long ago it ended, and the panel's
  heading counts the tasks running, waiting, failed and done.

Scope is core messaging and session management. There are no group chats, no new-chat button and
no session list. The design and the decisions behind it are in the
[spec](../../specs/issues/FIX-2154/SPEC.md).

## How the team works

### Messages and tasks

Workers message each other where you can see it. When Lead messages researcher, a line,
*Messaged researcher*, shows in Lead's conversation and the message lands in researcher's.
The line opens researcher's turn on it in a popup: what it read, what it did, and the reply it sent.
The reply lands in Lead's conversation under researcher's name. A message never interrupts
the turn you are in: while Lead is answering you, researcher's reply shows as a pending
line, and Lead reads it right after.

Each worker does real work. researcher reads the working folder's files and searches the web, writer
drafts from the working folder's files and from pages it fetches, and Lead hands out the
work. Lead sends a quick ask as a message, and real work as a task: a job that needs the
folder's files read goes to researcher or writer, and a job in several parts goes out as several
tasks, in order. Every result lands back in Lead's conversation as one line, *researcher
finished: Look up the launch date*, that opens the task in a popup, where the whole result is. A task
that finished without writing a result says so there, in place of the result. Lead's own
answer on it shows in full below.

### Coding tasks

A code change is a coding task, not a teammate's job. Coding runs in the background, the way a
coding agent's job does: you watch it, you don't talk to it. Ask Lead for a code change
and Lead starts a coding task in the working folder, on one of three coding agents:
Claude Code, Codex or Cursor. Name one ("have Codex do it") and that one runs; name none and Cursor
does, with no question first. Each agent is a worker of its own, off the list and never
messaged, whose `WORKER.md` names its `harness:`. The rest of that file is the agent's
instructions: every run on it is told them before the task. A line in Lead's conversation and a
row in Lead's panel show the task, tagged with the agent it runs on (and the model, once the
run reports one), and open its run in a popup. Once the run reports what it spent, the line adds its
tokens and, when the vendor reported a charge, the cost; the popup splits input from output tokens, and
the panel totals Lead's coding tasks. A run billed by subscription shows tokens and no cost.
The result lands in Lead's conversation as
the coding task's line, *Coding task finished: …*. To change a coding task, tell Lead, who starts the next one,
or use the task's buttons.

A task's popup has its buttons, which act on the task with no turn of Lead's in
between. While the task runs: **Cancel**, which asks once, and a **Steer** line whose words reach
the run. Once it failed or was cancelled: **Retry**, which runs it again as the same task, and, for
a coding task, one **Re-run on …** per other coding agent. A re-run is a new task on that agent,
its brief the old one plus a line naming the task it re-runs; the old task stays as it was, and the
result lands in Lead's conversation like any other. When the board refuses a press (the
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
asked, which is information, not approval. To accept it, pick where the work goes. **Open a PR**
pushes the run's branch and opens a pull request into the branch your working folder has checked
out. **Merge locally** merges the run's commits into that branch, in your working folder. Either way
the task completes. Its popup shows the pull request's link, or the branch and commit it merged
at, and what to do next. The task's line in the thread says *PR #n*, or *merged into* and the
branch's name. If the push, the pull request or the merge fails, the card shows the error with
**Retry**. The run's commits stay on its branch. A merge that conflicts stops and says which
files. It never resolves them for you, and your checkout is left as it was. **Ask for changes**, with
your words, sends them to the same coding session for one more run, which you review again. A run
that asks you something shows its question in the popup with a box for your answer, and goes on
with it.

The page's context strip shows which coding agents this machine can run, each with what to run
for one that isn't ready ("Codex has no credential: Not logged in. Run `codex login`, or set
CODEX_API_KEY.").

Lead sees the same rows, so it starts coding tasks only on an agent marked ✓ and tells
you what to run for one that isn't. The harness kit's `harnesses` flow's `readiness` view returns the rows,
and `{ refresh: true }` checks again. A task on an agent last read as not ready is checked once
more before it starts, so signing in after the lab started works without a restart. If it still
isn't ready, the task fails at once with a line that names the agent and what to run, such as
"Codex isn't set up on this machine: Codex has no credential: Not logged in. Run `codex login`, or
set CODEX_API_KEY. Then start the task again." It never runs on another agent instead.

The page shows the same rows as chips over the conversation, with a Re-check button, next to the
working folder, the model and the default agent the lab was started with. If the folder's
`.gitignore` doesn't ignore `.fsdev/`, that line says so too, since a coding task's checkout of it
would be refused. An empty conversation offers a few lines to start with, built from who that
worker hands work to; a click puts one in the box and sends nothing.

There is one working folder, a checkout you name when you start the lab (see [Run it](#run-it)),
and every job that needs files works in it. Nothing on the page picks a folder, and no worker can
name another one.

### Your own teammates

You can hire teammates of your own (*Hire a teammate*, under the list): a name, one line on what it
does, and its instructions. It joins the list at once, you can talk to it, and Lead can
hand it tasks. Your own teammates' panels have *Edit instructions*, which replaces their instructions
from the next turn on, and their header has *Fire*, which takes them off the list; their conversation stays readable.
The three teammates from the files can't be edited or fired.

### Routines

Lead, researcher and writer can each follow a GitHub pull request for you, or run something on a
clock. Ask in words: *"Follow acme/api#412 and tell me about every review on it."* The teammate
saves a routine, and each new review on that pull request reaches the same conversation as a
message, once. *"What are you following?"* lists your routines; *"Pause that"* and *"Stop
following it"* pause or delete one. A clock routine (*"Every Monday at 9, check the open pull
requests"*) files a task at its time.

The lab polls GitHub; it needs no public address. It reads GitHub with the token of whoever runs
the lab: `GITHUB_TOKEN`, or what `gh auth token` answers at start. The lab has one user
(`TEAMMATES_USER`): it takes every request as that user, whatever user the request names, so
the token serves nobody else. The lab keeps its data in its own organization (`teammates-lab`), so conversations saved before the lab named one don't open. With no token, a GitHub routine is refused, naming
`GITHUB_TOKEN`, and clock routines still run. Clock routines and polls tick from two SQLite files
beside the store.

## Run it

The lab runs on a real model and a durable SQLite store, served by `fsdev dev`:

```bash
pnpm --filter @flow-state-dev/teammates dev
```

The command builds the pages and serves them with the lab's server (`fsdev.config.mts`). It reads:

| Variable | What it sets | Default |
|---|---|---|
| `TEAMMATES_MODEL` | the model Lead, researcher and writer answer on | `openai/gpt-6-luna` |
| `TEAMMATES_MODELS` | the models a teammate may reply with, comma-separated, for the composer's *Respond with*; each shows where its calls go (a provider's key, Vercel AI Gateway or OpenRouter) or why it can't run, and a pick is saved to that teammate | `TEAMMATES_MODEL` alone |
| `TEAMMATES_WORKDIR` | the working folder: an absolute path to a git checkout on this machine | the root of this repository |
| `TEAMMATES_HARNESS` | the harness a coding worker whose file names none runs on: `claude-code`, `codex` or `cursor` | `cursor` |
| `TEAMMATES_STORE` | the SQLite file | `.fsdev/teammates.sqlite` here |
| `TEAMMATES_USER` | who the page acts as | `you` |
| `TEAMMATES_TREE` | the workers' tree | `workforce/` here |
| `TEAMMATES_RUNS` | the folder each coding run's worktree goes in | `.fsdev/teammates-runs/` here |
| `TEAMMATES_RUN_TIMEOUT_MS` | the wall-clock budget for one coding run, in milliseconds | `1200000` (20 minutes) |
| `TEAMMATES_SETUP` | a command each fresh worktree runs before its coding run starts, such as `pnpm install --frozen-lockfile`; no shell | none |
| `GITHUB_TOKEN` | the token a routine that follows a GitHub pull request reads GitHub with, for the lab's own user alone | what `gh auth token` answers at start; none, and GitHub routines are refused |
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

### The host

`host.mts` puts the lab's server together from package pieces, and `fsdev.config.mts` calls its
`openTeammates` with the variables above. What each piece is for:

- **Lead, researcher and writer** run on the workforce kit's built-in `agent` flow, so each has
  `sendMessage` and one conversation where messages land. Memory is composed in through `uses`
  (read) and `afterAnswer` (record each turn). What was said before the history window is kept by
  the built-in flow, which folds older turns into a summary by default, so the lab wires none of
  its own. The flow's tool catalog holds web search and fetch, and the working folder's source
  reads; each worker's `tools:` line picks its own from them. Each teammate's `icon:` and `color:`
  lines ride on its roster row (`settings` and `showSettings`), so the page draws them.
- **Claude Code, Codex and Cursor** are the coding workers, one per harness, on the harness kit's
  coding worker flow (`coder`): it takes the tasks a teammate files and runs each through its
  worker's harness, in a worktree of the working folder. Before a task starts, the harness's
  readiness is checked; one this machine isn't set up for fails the task with a sentence that names
  it and says what to run. A run that committed waits for your review, and the working folder's
  checks pass first. A shutdown waits for a coding run still going, its checks and judge included.
- **Readiness** is the harness kit's: put in the workers' context so Lead files coding work only on
  a ready harness, and served as the `harnesses` flow's `readiness` view, read with no session,
  which `{ refresh: true }` reads again.
- **The working folder** is one git checkout the operator names. It is the host's constant run
  source, so every coding run and every read of the workers' source tools works in it. There are no
  projects: no worker has a project tool, and nothing a model writes can name another folder. So
  the operator also names its checks, the commands a coding run's worktree must pass before its
  task is done, and a setup command each fresh worktree runs first so the checks find what they
  need. Neither runs through a shell.
- **The lab's context** is the `lab-context` flow's `context` view (`flows/lab-context.mts`, its ref beside it in `lab-context-ref.mts`), read
  with no session: the working folder, the model, the default harness, which workers each worker
  hands work to (read off the workers' files), and, when the folder doesn't ignore `.fsdev/`, the
  problem a coding run's checkout would be refused with (checked at start, never fatal). The page
  draws its context strip and first-run lines from it.
- **Teammates** you hire from the page are rows of your own roster, written through the workforce
  kit's roster flow; nothing restarts.
- **Routines:** Lead, researcher and writer hold the routine tools, so you can ask one to follow a
  GitHub pull request or to do something on a clock, and to list, pause or delete what it follows.
  A pull request's events are polled (no public URL) on the operator's own GitHub token, for the
  operator alone (workforce's `operatorGitHub`); `fsdev dev` ticks the polls and the clock routines,
  each from a SQLite file of its own beside the store.
- Every request is the lab's own user in the lab's own org, never a user the request names: the
  operator-only GitHub token is gated on it. `openTeammates`'s `user` option, which names the user
  each request is (the lab's own when it names none), is for a goal's host that needs two users
  in that org; `fsdev.config.mts` never sets it. A consult of another conversation reads on a smaller
  model (`intent/utility`).

Durable, on SQLite: a worker message a busy host turned away is sent again on its session's wake,
and a restart keeps every conversation.

### Try it

With a working folder whose README says the launch date, ask Lead *"Ask researcher for our
launch date, and help me outline the post."* Lead answers and messages researcher, which
reads the date from the README. Before researcher replies, send Lead a second line: the
reply shows as pending, then lands after Lead's answer, and Lead uses it in its
next line.

Keep talking past 50 turns and the divider reads *summarized*: a fact you gave Lead a
hundred lines ago is above it, and Lead still knows it.

Then ask Lead *"Fix the typo in the README's first line."* Lead starts a coding
task, the run shows its steps, and the result lands in Lead's conversation.

The goal check drives all of this in a browser:
[`goals/teammates-lab/a-worker-talks-to-another-while-you-talk`](../../goals/teammates-lab/a-worker-talks-to-another-while-you-talk/goal.md).

The screen tests run on a scripted server, `test/scripted-server.ts`: a stand-in at the client
that stores items and answers the package views, so every line the screen draws goes through
`src/app/`'s hooks and the real client. The contract tests in `test/contract/` run their
scenarios (a task's result, a line sent mid-turn, a failed turn and its Retry, a held question
and its answer, a cancelled task, a stopped turn, a line with files, a lapsed connection) through
those hooks against the scripted server and against the lab's own server (`host.mts`), in
process, with only the model scripted and coding runs on the scripted harness. A scenario the lab
can't show yet is marked to fail with the issue that adds it.

## What the screen reads

Every read is a package hook and every write a package client's call, over the one client
`AppProvider` holds (`useAppClient()`). The roster, the lab's context, harness readiness, busy status
and worker messages are package views a screen reads with `react`'s `useView`, and the roster's
changes go through workforce's client. A conversation is read once for every screen on it, by its
follower (`ConversationFollower`, in `src/app/conversations.ts`): its items on `react`'s
`useSessionFeed`, its turns on workforce's session turns view, and the history summary through
`useResource` by session id. Its writes go through workforce's client (`useConversationCalls`).

| On screen | Package piece |
|---|---|
| The worker list, sending, the conversation | the workforce client's `watchRoster()` (its roster view), `ensureWorkerSession` and `send` (the flow's `respond`), the session's items on `useSessionFeed`, and workforce's session turns view for whether it is answering |
| Busy status: the dot and the *Idle* age | workforce's worker sessions view (the default conversation, and whether a turn runs in it) and session turns view (when the last turn ended, else started) |
| The context strip and the harness chips | the lab's `lab-context` view (`flows/lab-context.mts`) and the harness kit's readiness view; *Re-check* reads readiness again with `{ refresh: true }` |
| A failed turn and *Retry* | the engine's `error` item for the turn, drawn by the UI registry's `request-recovery`, installed in `src/components/flow-state/`; Retry is the workforce client's `retryTurn`, on the newest turn only, and only for a turn the session turns view names as one the engine retries |
| Workers messaging each other | `sendMessage`, the received-message item (`workforce:received`), and workforce's worker messages view: a worker's open messages, and the row and answer of each line on screen, found through the message log's indexes |
| Hiring, changing and firing your own teammates | the workforce client's `hire`, `edit`, `reset` and `fire`, on the roster flow |
| Task lines | the conversation board's rows |
| Stop, and the stopped line | the workforce client's `stopTurns`: each turn running when it reads them, and each line you sent before the press; a line you send after it runs on. The line is the UI registry's `request-recovery` stopped look, installed in `src/components/flow-state/`, after each turn the session turns view lists as `aborted`, with the session stream's unfinished runs as its count |
| A teammate's icon and color | its `WORKER.md`'s `icon:` and `color:` lines, declared on the `agent` flow with `settings` and shown on its `roster()` row with `showSettings` |
| The status line | the worker sessions view and the conversation's items for what it is answering, the board's rows for a running coding task, the worker messages view for a message waiting on a reply |
| A message's popup | the session the message's row says it was delivered to, followed with `react`'s `useSessionFeed`: the turn whose received-message item carries the message's id |
| The working folder | `localWorkspaceHost` with a constant run source, `{ kind: "repo", repo }`, and the folder in `localRepositories`; `projectSourceTools` read it |
| Coding tasks and their runs | the conversation board's rows assigned to the worker on the coding flow, which the list leaves out; the row's `run` link, read as the run session's items |
| A task waiting on you, and your answer | the row's holds through the Inbox's `inboxItems` and `taskView`, answered with the Inbox client's `answerOne`; a review drawn by the UI registry's `review-hold`, installed in `src/components/flow-state/`, from the run's stop read by harness-manager's `reviewDetail` |
| A task's buttons | the Inbox client's `board(at)` on the conversation that filed it (`cancel`, `steer`, `release`, `retry`, and `refile` for a re-run), drawn by the UI registry's `task-actions`, with a failed task's error drawn by its `error` (`ErrorBody`), both installed in `src/components/flow-state/` |
| A run's steps in plain words, in a popup and inline in the conversation | the UI registry's `tool-naming` and `tool-grouping`, installed in `src/components/flow-state/`, over each tool call's name, arguments, status and result: `toolSubject`, `toolStepState` (with `toolOutcome`), `toolRunState`, `withToolState` and `toolRunOpen` |
| Approving what a worker asks | `react`'s `useApproval` on the `user_approval` stop, through the conversation's flow |
| The divider and its *summarized* label | the latest turn's `historyStart` on workforce's session turns view, and the history summary resource (workforce's `historySummaryResource`), read with `useResource` by session id |

The conversation follows its session's stream. Its turns view and the history summary read again
when the server says they changed, and on a host whose push can miss a change, such as the SQLite
store the lab runs on, every 1.5 seconds as well. A long reply costs them no more reads than a
short one.

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
