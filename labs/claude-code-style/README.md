# Claude Code-style lab

A private lab that copies the core layout and interaction of Claude Code, in the Flow State
theme, on the workforce package. It is one half of the evidence that the same package pieces make
familiar apps: an app adds only configuration, React UI and a few small flows, and anything else it
needs is a gap filed against the package.

- **Left:** a Sessions / Projects switch, then your sessions. The view sets the mode: Sessions is
  session mode, and Projects (threads mode) is shown and comes later. Each session in the view is
  with the same main worker. *New session* asks which project the session works in, with no
  default, then opens it in the view's mode.
- **Center:** the main thread. It is the only place you type. The main session does part of the
  work itself and starts background tasks for the long pieces. A background result shows as a card
  at the point the main session took it, even while its turn is still running.
- **Right:** the background tasks, read only. A row opens to show the task's work. To stop or steer
  a task, ask the main session.

Scope is core messaging and session management. There are no file diffs, permission prompts or
harness picker. The design and the decisions behind it are in the
[spec](../../specs/issues/FIX-2153/SPEC.md).

## Run it

Until wiring, the screen runs on fixtures that play the scripted session on a timer:

```bash
pnpm --filter @flow-state-dev/claude-code-style dev
```

Ask the main session for anything. It writes an outline, starts two research tasks, takes the quick
one's result while its turn runs, and ends with the long one still running. Then ask it to stop the
other task.

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
| A result card inside a running turn | the lab's loop-back flow (built at wiring) |
| Sending, interrupting, the thread and the tasks pane | `respond`, aborting a request, session items, `listTasks` |

## What this app adds

Every file in the lab, by kind. `node scripts/inventory.mjs` fails on a file that is none of these,
and on a flow over 200 lines; `--wired` also fails while a fixture is left.

<!-- inventory:start -->
| Kind | Files | Lines |
|---|---:|---:|
| Configuration | 13 | 241 |
| React UI | 15 | 841 |
| Small flows | 0 | 0 |
| Fixtures (deleted at wiring) | 1 | 302 |
| Checks (not app code) | 4 | 385 |
<!-- inventory:end -->
