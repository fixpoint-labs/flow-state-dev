# claude-code-style-lab › it tells a stopped task from a working one

**Issue:** FIX-2394 (epic FIX-2369), the Claude Code-style lab. The same check runs on the
Teammates lab (`goals/teammates-lab/tells-a-stopped-task-from-a-working-one`), from one module,
`goals/lib/task-signals.mts`.

**Outcome:** In the Claude Code-style lab, a person tells a background task that is working from
one whose run has stopped, and sees how long each running task has worked on this attempt, from
the tasks pane, without opening the task or asking a model.

**Input:** coding tasks filed on a fresh session's board through its own `createTask` action, as
the main session files one, all for `desk.coder` on harness-manager's scripted coder
(`CLAUDE_CODE_STYLE_HARNESS=stub`, a 4-minute pause before each step). It is **held-out**: no
worker file, flow or page names the tasks' titles or goals.

**Signal:** `fsdev dev --config labs/claude-code-style/fsdev.config.mts --app
@flow-state-dev/claude-code-style`, a fresh data folder, one browser on the pane. Each leg grades
the card's words on the page against the board's own `listTasks` row.

- **clock**: a task runs 30 s, is cancelled and retried. Within 20 s its card reads
  `working · …` within 5 s of now − the retried run's `run.startedAt`, and 4 s later it reads more.
- **alive**: a run in one 4-minute step (its request renewing the row's lease) reads `working · …`
  on every read of the card, about every 3 s, for those 4 minutes, and never `quiet`.
- **quiet**: the host is killed mid-run (`crashAndRestart`, SIGKILL to its process group), kept
  down 4 minutes, and served again on the same store. Before the board takes the row back (its
  `attempts` changes or its lease is no longer lapsed), the card reads `quiet for` at least 4m.
  The server comes back on the same port, so the page left open reads it again; a page that
  marks the row stale is reloaded once, and a stale read isn't counted. A restarted server
  takes a lapsed row back within a second of answering, so the leg holds that off by a minute
  without touching the row: while the host is down it moves the store's wakes (the board's, due
  when the lease lapsed) to the restart plus one minute, and the server is served taking a silent
  request as interrupted after 5 minutes (the 4 down plus one), not one. Reading still starts
  as the server starts.

**Anti-game:** read the page, never the adapter, the test double or React state. Every read is
compared with the board's row. A row the board took back before the page could be read is CAN'T
TELL (`tell.over`), not PASS; so are no reads of the alive card.

**Model:** n/a. The server gets no model credential, and no model turn runs.

**Run:** `pnpm tsx goals/claude-code-style-lab/tells-a-stopped-task-from-a-working-one/run.mts`
(about ten minutes; run on `main`, not on every PR).

**Controls** (each planted in the lab's copy of `taskSignal`,
`src/components/flow-state/task-signals.tsx`, for the build, put back, and the pages rebuilt;
each runs only the leg it must fail):
- `GOAL_CONTROL=task-clock`: the clock reads the task's own `startedAt`. Must FAIL clock. (Until
  FIX-2395's task times reach `listTasks` rows the task's `startedAt` is absent, so the card shows
  no clock; after it, the clock counts the first attempt.)
- `GOAL_CONTROL=quiet-from-age`: quiet once `updatedAt` is 10 s old. Must FAIL alive.
- `GOAL_CONTROL=never-quiet`: quiet is never shown. Must FAIL quiet.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-11-04 | 5f73870d (goal module before the quiet leg read from the server's first answer) | n/a, scripted coder | FAIL (control `task-clock`) | clock only: the retried card read `running`, no clock (rows carry no task-level `startedAt` before FIX-2395) |
| 2026-11-04 | 5f73870d + the same-port restart | n/a | FAIL (control `quiet-from-age`) | alive only: the live run read `quiet for 0m` 15 s into its one step, its lease renewed 6 times |
| 2026-11-04 | 5f73870d + the same-port restart | n/a | FAIL (control `never-quiet`) | quiet only: 2 reads of the row while its lease had lapsed (by 124 s) read `working · 4m 3s`, never quiet |
| 2026-11-04 | 5f73870d + the same-port restart | n/a | PASS | clock 1 s against 1 s since the retry's run started, then 5 s; alive 80 reads over 240 s, all working, 7 lease deadlines; quiet `quiet for 4m` 243 s after the kill, lease lapsed 126 s before |
| 2026-11-04 | 46856a3c | n/a | FAIL (control `task-clock`) | clock only, as above |
| 2026-11-04 | 2d5b2b75 | n/a | PASS | clock 1 s against 1 s, then 5 s; alive 80 reads over 240 s, all working, 6 lease deadlines; quiet `quiet for 4m` on the first read as the server answered, lease lapsed 125 s before |
| 2026-11-04 | 2d5b2b75 | n/a | FAIL (control `never-quiet`) | quiet only: 217 fresh reads of a row lapsed by up to 180 s read `working · …`, last `5m 0s`; the board took it back 58.3 s after the server answered |
