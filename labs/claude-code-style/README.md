# Claude Code-style lab

A private lab that copies the core layout and interaction of Claude Code, in the Flow State
theme, on the workforce package. It is one half of the evidence that the same package pieces make
familiar apps: an app adds only configuration, React UI and a few small flows, and anything else it
needs is a gap filed against the package.

- **Left:** a Sessions / Projects switch, then your sessions. The view sets the mode: Sessions is
  session mode, and Projects is threads mode. Each session in the view is with the view's main
  worker. *New session* asks which project the session works in, with no
  default, offering only projects you may work in (a member of a shared one, or the owner of a
  private one), then opens it in the view's mode. A session whose tasks wait on you (a question,
  a review, or a failed task) shows how many under its title.
- **Center:** the main thread. It is the only place you type. The main session does part of the
  work itself and starts background tasks for the long pieces. It reads the project's files itself,
  so a question about the code is answered in the same turn, and a code change goes to `desk.coder`.
  A background result shows as one line, its title and status, at the point the main session took
  it, even while its turn is still running. Click it to read the task's reply; the main session
  adds only what's new rather than repeating it. *Open task* on the line opens the task's sheet,
  the same one its row in the pane opens, and so does *Open task* on the line where the main
  session started the task. The dot on either line shows the task's status now: a task retried
  after it failed reads "failed · now running", since the line's words keep what it reported.
  A line from a task the board doesn't list has no *Open task*. Tool calls read as plain words ("Waiting for your
  answer", "Sent for review"). Enter sends; Cmd+Enter (Ctrl+Enter) sends from every box in the lab.
- **The *Coder* chip** beside Send picks who makes a code change you ask for, in either mode:
  *Auto* (Claude Code, as above), *Plan first* (Claude Code in plan mode, which reads, changes
  nothing and answers with a plan), *Codex* or *Cursor*. Any choice but *Auto* adds one line to
  what you send, such as `Coder: Codex`, and the main session hands the change to that coder. It
  holds while the session is open. You can also say it in words ("plan it first", "use Cursor").
- **Right:** the background tasks. A row opens a sheet with the task's work and a row of actions
  by its status: *Cancel* (it asks once, since tasks waiting on it go too) and a *Steer* box while
  it runs or waits, *Release* when it is held, *Retry* once it failed or was cancelled. A failed
  task shows its error. Each action is the board's own, and a refusal shows in the board's words.
  You can still ask the main session to stop or steer a task. The open task's row is marked,
  whether you opened it here or from the main thread; *Done* opens to show it when it is finished.
- **Keys:** ⌘K (Ctrl+K) finds any session by its title, in either view, or starts a new one.
  Alt+↑ and Alt+↓ move to the previous or next session in the view. `/` puts the cursor in the
  composer, and `?` lists every key. Opening a session puts the cursor in its composer. The view
  switch is one Tab stop; ← and → change the view.

## Threads mode

In the Projects view, the main session is a coordinator, `desk.lead`. It hands each request to
threads, each a task in a session of its own, and the right pane is the status board, *Tasks*.

- **Center:** your line is marked *Sent to a task*, and each thread is a compact card where the
  lead filed it, with *View task*, *Answer* when it asks you something, and *Resolve* and
  *Request changes* when it is ready for review. A result line's *Open task* opens the thread's
  view, as *View task* does.
- **Right:** the board groups threads by what you owe them: *Pinned*, *Working*, *Waiting on you*,
  *Ready for review* and *Resolved*, collapsed to a count. A column is read from the task's
  status and what it waits on, never a mark the lab keeps. A failed thread waits on you; its view
  shows the error and offers *Retry*.
- **The right pane** is as wide as you drag its left edge (or move it with the arrow keys once it
  has focus), and keeps that width across reloads.
- **The page's address** names the view, the open session and the task open in its pane
  (`?session=<id>&task=<id>`), so a reload or a link reopens them, and Back returns to what you
  had open before. A link to a session or task that is gone opens *New session* instead.
- **A thread's view** opens as a sheet over the main thread, the same flyout a session's background task opens in, and the board stays in the pane beside it. You can talk in it: your line steers
  the thread's task and answers its open question. Cmd+Enter (Ctrl+Enter) answers, or requests
  changes when it is ready for review; plain Enter is a new line. You can pin it there. Under its
  header, the same actions as a sheet's, without the *Steer* box, since the composer steers.
- **A thread's goal** carries what it needs, since a thread sees nothing else: what to do, the ids,
  links and branches you named, where the work lives, and what done means. A thread starts at
  once and looks before it asks: it asks you only what depends on you, a choice only you can make
  or a check you asked it to make with you.
- **A code change** goes to `desk.thread-coder`, which runs through Claude Code (its `harness` setting),
  or to the plan, Codex or Cursor coder the *Coder* chip names.
  Its card and row are tagged, and a run that made changes waits for your review. The thread's
  view says so once, in a card: the commit count, the branch shown short (the full name on hover)
  and the judge's verdict on one line, as information. A run nobody reviews by the deadline lands in *Resolved*
  marked *Not reviewed*, so it never reads as approved.

Scope is core messaging and session management. There are no file diffs, permission prompts,
linked PRs or harness readiness. The design and the decisions behind it are in the specs for
[session mode](../../specs/issues/FIX-2153/SPEC.md) and
[threads mode](../../specs/issues/FIX-2157/SPEC.md).

## Run it

The lab runs against a real model, through the AI Gateway (`AI_GATEWAY_API_KEY`), on a SQLite
store. One command builds the pages and serves them with the lab's workers:

```bash
pnpm --filter @flow-state-dev/claude-code-style dev
```

It is the same as running these two from the repository root:

```bash
pnpm --filter @flow-state-dev/claude-code-style build
fsdev dev --config labs/claude-code-style/fsdev.config.mts --app @flow-state-dev/claude-code-style
```

Open the address it prints as `App:`. The pages call the lab's API, so a plain Vite server shows
only 404s.

`desk.coder` and `desk.thread-coder` run through Claude Code, so the host also needs
`ANTHROPIC_API_KEY`. The Codex and Cursor coders, and any worker you give `harness: codex` or
`harness: cursor`, need that harness signed in too (Cursor reads `CURSOR_API_KEY`).
A coding run starts with only the variables its harness
needs (`CLAUDE_CODE_PASS`, `CODEX_PASS` or `CURSOR_PASS` from its package), never the rest of the
host's environment. That filters what a run starts with; it isn't a security boundary. At start
the lab logs which harnesses this machine can run, with what to run for one that can't
(`✗ Codex: … Run \`codex login\`, or set CODEX_API_KEY.`), and the `harness-readiness` flow's
`read` action returns the same rows; `{ refresh: true }` checks again. The host is durable: a thread's question and review wait on you across a
restart, and a coding run's review needs durable execution. Its settings
are read from the environment, all optional:

| Setting | Default | What it is |
|---|---|---|
| `CLAUDE_CODE_STYLE_MODEL` | `openai/gpt-5.4` | The model every worker answers with |
| `CLAUDE_CODE_STYLE_DATA` | `.fsdev/claude-code-style` | The SQLite file, and each coding run's worktree under `runs/` |
| `CLAUDE_CODE_STYLE_REPOSITORIES` | the repository the lab starts in | The repositories coding runs work in a worktree of, as paths separated by `:` |
| `CLAUDE_CODE_STYLE_USER` | `u_lab` | The person the pages are served for |
| `CLAUDE_CODE_STYLE_ANSWER_AGAIN` | on | `off` leaves `answerAgain` off the main worker: the goal check's control |
| `CLAUDE_CODE_STYLE_SETUP` | none | One command each fresh worktree runs before its coding run starts, such as `pnpm install --frozen-lockfile`, with no shell |
| `CLAUDE_CODE_STYLE_HARNESS` | the harness each coder names | `stub` runs every coding task on harness-manager's scripted coder, with no model, for a goal check |
| `CLAUDE_CODE_STYLE_HARNESS_STEP_MS` | `2000` | With `stub`, the pause before each of the scripted coder's five steps |

*New session* lists your projects and has a *New project* form: a name and the repository its
coding runs work on. The host allows `file://` repositories only, and the repository must ignore
`.fsdev/`. The form checks the repository as you leave its field, with the same check a run's
checkout gets, and keeps Create off with the problem shown when it fails; the server refuses the
same project (`repository-unusable`). The picker also says what its view does and shows which
coding harnesses can run here, with Re-check, and an empty session offers starter lines that fill
the composer. A run works in a git worktree of the repository under
the data folder, on a branch of its own that you'll find in the repository, so your checked-out
branch and files don't change. A repository not in `CLAUDE_CODE_STYLE_REPOSITORIES` gets a clone
under the data folder instead. Before a run settles, a judge (harness-manager's `goalJudge`) reads
its answer and commits against the task's goal: it can send the run back, ask you a question, or
let it through, and threads mode shows its verdict on the coding thread's card. A run is also done only when
its project's checks pass: the commands the project names in `checks` (none by default) run in the
run's worktree after the harness finishes, and a red one sends the run back with the command's
output in its next brief. A run that changed no files, such as one that answers a question, skips
them, so you can still ask about a project whose branch is already red.

Every task card shows the model its run uses and a token count that rises while the run works,
and the harness tag names the harness the run reported. Finished rows keep the final total, and a
task's sheet or thread view splits it into input and output. A count no run has reported reads
"no tokens reported yet", never 0, and one still missing a source is marked partial. All of it comes from the `spend` the
board's `listTasks` rows carry; the lab sums nothing itself.

Every task also shows its time. A running card reads *working · 4m 12s*, counted from when this
attempt's run started, so a retried task starts again from zero. A running task whose run has
stopped answering reads *quiet for 40m* in amber: the run stopped renewing its claim on the task
(the board's lease lapsed), as when the server running it died, and it stays quiet until the
board hands the task to a new run. A run that is alive but slow keeps renewing, so it never reads
quiet; a long clock is the sign there. While the page can't read the tasks (its connection
dropped), it keeps the last rows and never calls a task quiet from them. A finished row says how long ago it ended, the threads
board's rows carry the same time, and the pane's heading counts the tasks running, waiting, failed
and done.

Both modes are wired. The screen tests run on a test double, `test/fake-lab.ts`, which the app
never imports.

## How the screen reaches the package

Everything the screen reads and writes goes through one adapter, `src/adapter.ts`, and each verb is
a package call:

| The screen | Package piece |
|---|---|
| The sessions list | `listWorkerSessions("desk.main")` from `@flow-state-dev/workforce/browser` |
| *New session* and a session's project | a session of `desk.main`'s flow, then `setWorkProject` |
| The project picker and *New project* | `listProjects`, `createProject` and `checkRepository`, from `defineProjectBlocks` with the workspace host's check (`workforce/flows/projects.mts`) |
| The picker's harness chips | the `harness-readiness` flow's `read` action |
| Sending and the thread | the `respond` action, and the session's message and tool items |
| A result card inside a running turn | `answerAgain: true` on the main worker's flow: the settled task's notice, taken into the turn |
| The main session reading the project's files | `projectSourceCapability({ workspace })` on the `agent` flow, over the coding runs' host; `desk.main` and `desk.researcher` name its `read` preset in their `WORKER.md` |
| Interrupting | aborting the session's running turn; its tasks keep running |
| A failed turn and *Retry* | the engine's `error` item for the turn, drawn by the UI registry's `request-recovery` (installed in `src/components/flow-state/`); Retry is the client's `request(id).retry()`, on the newest turn only |
| The tasks pane and a task's work | the `listTasks_tasks` read (stores nothing per poll), and the items of the task's run session |
| Threads mode's sessions | the same, with `desk.lead`, a `coordinator`, as the main worker |
| A thread card, and *Sent to a task* | the lead's `createTask` call in the session's items |
| The board's columns | the status of each row the `listTasks_tasks` read returns, and its open holds, read with `inboxItems` from `@flow-state-dev/orchestration/inbox` |
| A coding thread's tag | the `harness` action of the coding flow, asked in the thread's run session |
| A coding thread's review card | the `data` of the review stop (`suspension` item) in the thread's run session: branch, commits, subjects and the judge's verdict |
| *Not reviewed* | a finished coding thread's output, `review: "deadline"`, through `getTask_tasks` |
| Answering in a thread | the Inbox client's `answerOne` on its open question; with none, `updateTask_tasks` with your line as a steer |
| Pins | the `pins` flow's `listPins` read, so reading them stores nothing |

The thread and a task's work follow their session's stream. The rest reads when something changes,
through `client.subscribe`: a row of the sessions list on its session's notices (a turn, a board
change, a resource), the thread's running turn on a request notice, and pins on a change to your
user state. A session you open in another tab joins the list at the next reload. On a host whose
push can miss a change, such as the SQLite store the lab runs on, each also reads at its old pace:
the list and pins every 3 seconds, the running turn every 1.5.
| *Resolve* and *Request changes* | the Inbox client's `answerOne` on its review: `{ verdict: "accepted" }` or `{ verdict: "revise", words }` |
| *Pin* and *Unpin* | the lab's `pins` flow (`workforce/flows/pins.mts`), your own user state |

`desk.coder` and `desk.thread-coder`, and their plan, Codex and Cursor siblings, are on the lab's one coding flow,
`workforce/flows/harness-thread.mts`: a `harnessManager` per harness, picked by the worker's
`harness:` line, working in the session's project through `projectWorkspace()`. A worker with
`review: true`, as threads mode's `desk.thread-coder` is, runs on the manager built with
`reviewChanges: true`: a run that committed waits for your review before its task completes.
Session mode's coders have no review line, since that mode has no review to answer.

| Worker (session mode · threads mode) | Its `WORKER.md` | The chip |
|---|---|---|
| `desk.coder` · `desk.thread-coder` | `harness: claude-code` | *Auto* |
| `desk.coder-plan` · `desk.thread-coder-plan` | `harness: claude-code`, `permissionMode: plan`, no review (it commits nothing) | *Plan first* |
| `desk.coder-codex` · `desk.thread-coder-codex` | `harness: codex` | *Codex* |
| `desk.coder-cursor` · `desk.thread-coder-cursor` | `harness: cursor` | *Cursor* |

The threads-mode coders but the plan one carry `review: true`. `desk.main` and `desk.lead` name
them all as delegates, and their files say which one a `Coder:` line or your words pick.

The flow builds Claude Code, Codex and Cursor, so a coding worker on any of them is one more
`WORKER.md` with that `harness:` line. A Claude Code worker can also name a `permissionMode:`:
`acceptEdits` (the default) or `plan`. The flow builds a manager for each. `default` isn't offered:
the manager turns no tool approval into a wait on you, so a run in it would only be refused its
tools. Nor is `bypassPermissions`, which a worker's own line shouldn't be able to turn on. A worker on another harness that names a `permissionMode:` is
refused when its task runs.
