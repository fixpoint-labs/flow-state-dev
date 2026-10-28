# Claude Code-style lab

A private lab that copies the core layout and interaction of Claude Code, in the Flow State
theme, on the workforce package. It is one half of the evidence that the same package pieces make
familiar apps: an app adds only configuration, React UI and a few small flows, and anything else it
needs is a gap filed against the package.

- **Left:** a Sessions / Projects switch, then your sessions. The view sets the mode: Sessions is
  session mode, and Projects is threads mode. Each session in the view is with the view's main
  worker. *New session* asks which project the session works in, with no
  default, offering only projects you may work in (a member of a shared one, or the owner of a
  private one), then opens it in the view's mode.
- **Center:** the main thread. It is the only place you type. The main session does part of the
  work itself and starts background tasks for the long pieces. It reads the project's files itself,
  so a question about the code is answered in the same turn, and a code change goes to `desk.coder`.
  A background result shows as a card at the point the main session took it, even while its turn is
  still running.
- **Right:** the background tasks, read only. A row opens to show the task's work. To stop or steer
  a task, ask the main session.

## Threads mode

In the Projects view, the main session is a coordinator, `desk.lead`. It hands each request to
threads, each a task in a session of its own, and the right pane is the status board, *Threads*.

- **Center:** your line is marked *Sent to a thread*, and each thread is a compact card where the
  lead filed it, with *View thread*, *Answer* when it asks you something, and *Resolve* and
  *Request changes* when it is ready for review.
- **Right:** the board groups threads by what you owe them: *Pinned*, *Working*, *Waiting on you*,
  *Ready for review* and *Resolved*, collapsed to a count. A column is read from the task's
  status and what it waits on, never a mark the lab keeps. A failed thread waits on you; ask the
  main session to retry it.
- **A thread's view** replaces the board, with a back arrow. You can talk in it: your line steers
  the thread's task and answers its open question. You can pin it there.
- **A code change** goes to `desk.thread-coder`, which runs through Claude Code (its `harness` setting).
  Its card and row are tagged, and a run that made changes waits for your review, with the
  judge's verdict shown as information. A run nobody reviews by the deadline lands in *Resolved*
  marked *Not reviewed*, so it never reads as approved.

Scope is core messaging and session management. There are no file diffs, permission prompts,
linked PRs or harness picker. The design and the decisions behind it are in the specs for
[session mode](../../specs/issues/FIX-2153/SPEC.md) and
[threads mode](../../specs/issues/FIX-2157/SPEC.md).

## Run it

The lab runs against a real model, through the AI Gateway (`AI_GATEWAY_API_KEY`), on a SQLite
store. One command builds the pages and serves them with the lab's workers:

```bash
pnpm --filter @flow-state-dev/claude-code-style dev
```

That builds the pages and serves them on `fsdev dev`, from the repository root:

```bash
pnpm --filter @flow-state-dev/claude-code-style build
fsdev dev --config labs/claude-code-style/fsdev.config.mts --app @flow-state-dev/claude-code-style
```

Open the address it prints as `App:`. The pages call the lab's API, so a plain Vite server shows
only 404s.

`desk.coder` and `desk.thread-coder` run through Claude Code, so the host also needs
`ANTHROPIC_API_KEY`. The host is durable: a thread's question and review wait on you across a
restart, and a coding run's review needs durable execution. Its settings
are read from the environment, all optional:

| Setting | Default | What it is |
|---|---|---|
| `CLAUDE_CODE_STYLE_MODEL` | `openai/gpt-5.4` | The model every worker answers with |
| `CLAUDE_CODE_STYLE_DATA` | `.fsdev/claude-code-style` | The SQLite file, and each coding run's worktree under `runs/` |
| `CLAUDE_CODE_STYLE_REPOSITORIES` | the repository the lab starts in | The repositories coding runs work in a worktree of, as paths separated by `:` |
| `CLAUDE_CODE_STYLE_USER` | `u_lab` | The person the pages are served for |
| `CLAUDE_CODE_STYLE_ANSWER_AGAIN` | on | `off` leaves `answerAgain` off the main worker: the goal check's control |

*New session* lists your projects and has a *New project* form: a name and the repository its
coding runs work on. The host allows `file://` repositories only, and the repository must ignore
`.fsdev/` (a run refuses one that doesn't). A run works in a git worktree of the repository under
the data folder, on a branch of its own that you'll find in the repository, so your checked-out
branch and files don't change. A repository not in `CLAUDE_CODE_STYLE_REPOSITORIES` gets a clone
under the data folder instead. Before a run settles, a judge (harness-manager's `goalJudge`) reads
its answer and commits against the task's goal: it can send the run back, ask you a question, or
let it through, and threads mode shows its verdict on the coding thread's card.

Both modes are wired. The screen tests run on a test double, `test/fake-lab.ts`, which the app
never imports.

## How the screen reaches the package

Everything the screen reads and writes goes through one adapter, `src/adapter.ts`, and each verb is
a package call:

| The screen | Package piece |
|---|---|
| The sessions list | `listWorkerSessions("desk.main")` from `@flow-state-dev/workforce/browser` |
| *New session* and a session's project | a session of `desk.main`'s flow, then `setWorkProject` |
| The project picker and *New project* | `listProjects` and `createProject`, from `defineProjectBlocks` (`workforce/flows/projects.mts`) |
| Sending and the thread | the `respond` action, and the session's message and tool items |
| A result card inside a running turn | `answerAgain: true` on the main worker's flow: the settled task's notice, taken into the turn |
| The main session reading the project's files | `projectSourceCapability({ workspace })` on the `agent` flow, over the coding runs' host; `desk.main` and `desk.researcher` name its `read` preset in their `WORKER.md` |
| Interrupting | aborting the session's running turn; its tasks keep running |
| The tasks pane and a task's work | `listTasks_tasks`, and the items of the task's run session |
| Threads mode's sessions | the same, with `desk.lead`, a `coordinator`, as the main worker |
| A thread card, and *Sent to a thread* | the lead's `createTask` call in the session's items |
| The board's columns | each `listTasks_tasks` row's status and its open holds, read with `inboxItems` from `@flow-state-dev/orchestration/inbox` |
| A coding thread's tag | the `harness` action of the coding flow, asked in the thread's run session |
| *Not reviewed* | a finished coding thread's output, `review: "deadline"`, through `getTask_tasks` |
| Answering in a thread | the Inbox client's `answerHold` on its open question; with none, `updateTask_tasks` with your line as a steer |
| *Resolve* and *Request changes* | the Inbox client's `answerHold` on its review: `{ verdict: "accepted" }` or `{ verdict: "revise", words }` |
| *Pin* and *Unpin* | the lab's `pins` flow (`workforce/flows/pins.mts`), your own user state |

`desk.coder` and `desk.thread-coder` are on the lab's one coding flow,
`workforce/flows/harness-thread.mts`: a `harnessManager` per harness, picked by the worker's
`harness:` line, working in the session's project through `projectWorkspace()`. A worker with
`review: true`, as threads mode's `desk.thread-coder` is, runs on the manager built with
`reviewChanges: true`: a run that committed waits for your review before its task completes.
Session mode's `desk.coder` has no review line, since that mode has no review to answer.

## What this app adds

Every file in the lab, by kind. `node scripts/inventory.mjs` fails on a file that is none of these,
and on a flow over 200 lines; `--wired` also fails while a fixture is left in `src/`.

<!-- inventory:start -->
| Kind | Files | Lines |
|---|---:|---:|
| Configuration | 18 | 494 |
| React UI | 27 | 2665 |
| Small flows | 3 | 273 |
| Checks (not app code) | 8 | 1256 |
<!-- inventory:end -->
