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
  down 4 minutes, and served again on the same store; the page reopens Chief of Staff. Before the
  board takes the row back (its `attempts` changes or its lease is no longer lapsed), the row
  reads `quiet for` at least 4m.

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
