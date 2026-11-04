# teammates-lab › it tells a stopped task from a working one

**Issue:** FIX-2394 (epic FIX-2369), the Teammates lab. The same check runs on the Claude
Code-style lab (`goals/claude-code-style-lab/tells-a-stopped-task-from-a-working-one`), from one
module, `goals/lib/task-signals.mts`.

**Outcome:** In the Teammates lab, a person tells a task that is working from one whose run has
stopped, and sees how long each running task has worked on this attempt, from the teammate's
panel, without opening the task or asking a model.

**Input:** coding tasks filed on Chief of Staff's conversation board through its own `createTask`
action, as a screen files one, for `teammates.cursor` on the lab's scripted harness
(`GOAL_HARNESS=stub`, a 4-minute pause before each step). It is **held-out**: no worker file, flow
or page names the tasks' titles or goals.

**Signal:** `fsdev dev --app @flow-state-dev/teammates` on a fresh store over a scratch git
checkout, one browser on Chief of Staff's panel. Each leg grades the row's words on the page
against the board's own `listTasks` row.

- **clock**: a task runs 30 s, is cancelled and retried. Within 20 s its row reads `working · …`
  within 5 s of now − the retried run's `run.startedAt`, and 4 s later it reads more.
- **alive**: a run in one 4-minute step (its request renewing the row's lease) reads `working · …`
  on every read of the row, about every 3 s, for those 4 minutes, and never `quiet`.
- **quiet**: the host is killed mid-run (`crashAndRestart`, SIGKILL to its process group), kept
  down 4 minutes, and served again on the same store. Before the board takes the row back (its
  `attempts` changes or its lease is no longer lapsed), the row reads `quiet for` at least 4m.
  The server comes back on the same port, so the page left open reads it again; a page that
  marks the row stale is reloaded once, and a stale read isn't counted. The server is served
  with a silent request taken as interrupted after 5 minutes (the 4 down plus one), not the
  engine's one, so the board takes the lapsed row back about a minute after the server answers
  rather than within a second; reading still starts as the server starts.

**Anti-game:** read the page, never the adapter, the test double or React state. Every read is
compared with the board's row. A row the board took back before the page could be read is CAN'T
TELL (`tell.over`), not PASS; so are no reads of the alive row.

**Model:** n/a. The server gets no model credential; Chief of Staff's turns woken by a task's
ending fail without one, and nothing here waits on them.

**Run:** `pnpm tsx goals/teammates-lab/tells-a-stopped-task-from-a-working-one/run.mts` (about
ten minutes; run on `main`, not on every PR).

**Controls** (each planted in the lab's copy of `taskSignal`,
`src/components/flow-state/task-signals.tsx`, for the build, put back, and the pages rebuilt;
each runs only the leg it must fail):
- `GOAL_CONTROL=task-clock`: the clock reads the task's own `startedAt`. Must FAIL clock. (Until
  FIX-2395's task times reach `listTasks` rows the task's `startedAt` is absent, so the row shows
  no clock; after it, the clock counts the first attempt.)
- `GOAL_CONTROL=quiet-from-age`: quiet once `updatedAt` is 10 s old. Must FAIL alive.
- `GOAL_CONTROL=never-quiet`: quiet is never shown. Must FAIL quiet.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-11-04 | 5f73870d (goal module before the quiet leg read from the server's first answer) | n/a, scripted coder | FAIL (control `task-clock`) | clock only: the retried row read `running`, no clock (rows carry no task-level `startedAt` before FIX-2395) |
| 2026-11-04 | 5f73870d + the same-port restart | n/a | FAIL (control `quiet-from-age`) | alive only: the live run read `quiet for 0m` 13 s into its one step, its lease renewed 6 times |
| 2026-11-04 | 5f73870d + the same-port restart, before the stale rule | n/a | FAIL (goal) | quiet: the one read after the restart was the stale panel's frozen `working · 4m 1s`; the board took the row back before the feed came back. Led to counting only fresh reads and reloading a stale page |
| 2026-11-04 | 46856a3c's module, pre-commit | n/a | FAIL (control `never-quiet`) | quiet only: 2 fresh reads (after one stale read and a reload) of a row lapsed by 125 s read `working · 4m 4s`; the board took it back 1.1 s after the server answered |
| 2026-11-04 | 46856a3c's module, pre-commit | n/a | PASS | clock 0 s against 1 s since the retry's run started, then 4 s; alive 79 reads over 237 s, all working, 6 lease deadlines; quiet `quiet for 4m` 0.6 s after the server answered (after a reload), lease lapsed 124 s before |
| 2026-11-04 | 46856a3c's module, pre-commit | n/a | FAIL (control `task-clock`) | clock only: the retried row read `running`, no clock |
