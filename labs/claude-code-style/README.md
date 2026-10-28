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
  work itself and starts background tasks for the long pieces. A background result shows as a card
  at the point the main session took it, even while its turn is still running.
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
- **A code change** goes to `desk.coder`, which runs through Claude Code (its `harness` setting).
  Its card and row are tagged, and a run that made changes waits for your review, with the
  judge's verdict shown as information. A run nobody reviews by the deadline lands in *Resolved*
  marked *Not reviewed*, so it never reads as approved.

Scope is core messaging and session management. There are no file diffs, permission prompts,
linked PRs or harness picker. The design and the decisions behind it are in the specs for
[session mode](../../specs/issues/FIX-2153/SPEC.md) and
[threads mode](../../specs/issues/FIX-2157/SPEC.md).

## Run it

Until wiring, the screen runs on fixtures that play the scripted session on a timer:

```bash
pnpm --filter @flow-state-dev/claude-code-style dev
```

Ask the main session for anything. It writes an outline, starts two research tasks, takes the quick
one's result while its turn runs, and ends with the long one still running. Then ask it to stop the
other task.

In the Projects view, any ask starts three threads: one asks which region matters and waits for
your answer in its view, and one becomes ready for review. Ask for a code change, or a CHANGELOG
line, and one thread runs through Claude Code instead. The older *Billing triage* session shows a
pinned thread and a failed one.

After wiring, the lab runs against a real model and a durable store:

```bash
fsdev dev --app @flow-state-dev/claude-code-style
```

## Fixtures

Everything the screen reads and writes goes through one adapter, `src/adapter.ts`. Its verbs stand
for package calls, and until wiring they run on `src/fixtures.ts`, marked `fixture:`. At wiring the
fixtures are deleted and each verb calls the package.

| Fixture stands in for | Package piece |
|---|---|
| The sessions list and *New session* | FIX-2158, a user's sessions of one worker |
| The project picker and a session's project | FIX-2161, an ordinary session opened on a project |
| A result card inside a running turn | FIX-2159, `answerAgain: true` on the main worker (set at wiring) |
| Sending, interrupting, the thread and the tasks pane | `respond`, aborting a request, session items, `listTasks` |
| Threads and the board's columns | the lead's `createTask` calls, task statuses and what a task waits on |
| Talking in a thread and answering its question | `updateTask_tasks` with your line as a steer, naming the open question (FIX-2131) |
| *Resolve* and *Request changes* | answering the thread's review wait (FIX-2129) |
| A harness thread's review | FIX-2163, a harness run that made changes waits for a person's review |
| Step progress on a row (*2/7*) | FIX-2164, or the run session's plan rows if they can be read |
| Pins | the lab's `pins` flow, built at wiring |

The `harness-thread` worker flow and the `pins` flow are written at wiring, with the host.

## What this app adds

Every file in the lab, by kind. `node scripts/inventory.mjs` fails on a file that is none of these,
and on a flow over 200 lines; `--wired` also fails while a fixture is left.

<!-- inventory:start -->
| Kind | Files | Lines |
|---|---:|---:|
| Configuration | 16 | 301 |
| React UI | 20 | 1325 |
| Small flows | 0 | 0 |
| Fixtures (deleted at wiring) | 1 | 471 |
| Checks (not app code) | 6 | 681 |
<!-- inventory:end -->
