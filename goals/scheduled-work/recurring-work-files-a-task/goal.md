# scheduled-work › it recurring work files a task

**Issue:** FIX-2085 (epic FIX-2056). Its spec's goal: `specs/issues/FIX-2085/SPEC.md` → "The goal, and how we'll know it's met".

**Outcome:** Alice's recurring work arrives as an ordinary task on the board she named, once per scheduled time across restarts and hosts, and she can see every schedule's next run.

**Input:** `fixtures/schedules.json`: a weekly cron (`0 9 * * 1`, `Europe/London`) that files "Refresh the adoption numbers" on `launch`'s board for `researcher`, a start date the four scheduled times are counted from (across the March clock change), and two more schedules in other zones for the list. Held-out: the scheduled times and next runs are worked out in `run.mts` by stepping minutes through the zone's wall clock with `Intl`, not with the library the implementation uses, so another cron, zone or start date must pass too. The app is a Workforce app over one SQLite file with two deterministic workers (launch says "Noted."; researcher works for 1.5 s and reports). Each step is its own process (`host.mts`) with its clock pinned to the moment it stands at; no schedule index is configured.

**Signal:** each failure is tagged `<leg>:<assertion>`.

- **a**: `a:accepted` a fire POSTed with the scheduler's secret and the scheduled time is accepted; `a:one-task-on-launch's-board` Alice's task list with launch then holds exactly one task; `a:the-schedule's-task` it is the schedule's goal, assigned to researcher; `a:it-runs` it ended completed; `a:ending-heard-once` launch's conversation ran exactly one ending request for it; `a:second-week's-task` the next week's fire files a second task, and `a:cancelled-like-any-task` Alice's `updateTask_tasks` with `status: "cancelled"` on it, while it works, leaves it cancelled.
- **b**: `b:exactly-one-task` one scheduled time POSTed by two processes at once, again by a restarted one, and again 20 s late, files exactly one task; `b:early-files-nothing` an untimed POST a minute before the next time files nothing; `b:its-own-fire-still-files` that time's own fire then files one.
- **c**: `c:shows-the-change` Alice's `listSchedules` shows exactly her schedules, before and after one is removed and one added, on the next read; `c:next-run` each one's `nextRunAt` equals the next time of its cron in its zone, from the host's clock.

**Anti-game:** tasks are read through Alice's public task read (`listTasks_tasks` in her conversation with launch, over the router as Alice), never the collection. Schedules are written and read through the roster flow's actions as Alice. Fires go through the router with the scheduler's bearer secret, as a host's cron sends them. Launch's ending requests are read from the engine's request store, read-only, and counted by the task they name. The two concurrent hosts are two OS processes over one SQLite file, not two handlers in one process. A dispatch answer alone never passes a leg: leg b counts tasks in Alice's list. Every list an assertion grades is floored with `tell.over`, so an empty read is CAN'T TELL.

**Model:** n/a

**Run:** `pnpm tsx goals/scheduled-work/recurring-work-files-a-task/run.mts`

**Controls:**

- `GOAL_CONTROL=memory-dedupe` patches the endpoint's claim (`packages/scheduled/src/scheduledTime.ts`) to read and write the fired record in the process's own memory instead of the shared store: today's per-process dedupe. It must FAIL `b:exactly-one-task`. It also fails `b:early-files-nothing`, by the same cause: a fresh process doesn't know the time already fired. No leg has an isolating red state for the two.
- Today's `main` has no schedule actions on the roster flow, so it fails leg a before any task (`a1:` setup, `saveSchedule` not defined) and leg c with it.

## Verdict log

| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-21 | `8b3f56d92` + goal | n/a | PASS | a: one task, researcher, completed, heard once; the next week's task cancelled while in_progress, ended cancelled. b: one time from two hosts, a restart and 20 s late filed one task (answers 202, 200, 200, 200); untimed a minute early filed nothing, the time's own fire filed. c: next runs match each cron in its zone, before and after a remove and an add. Times 2026-03-23T09:00Z, 03-30T08:00Z, 04-06T08:00Z, 04-13T08:00Z |
| 2026-10-21 | `8b3f56d92` + goal | n/a | FAIL (expected) | `GOAL_CONTROL=memory-dedupe`: `b:exactly-one-task — one scheduled time filed 4 tasks (fires answered 202, 202, 202, 202)`; `b:early-files-nothing — … filed 1 task(s)` |
| 2026-10-21 | `8b3f56d92` + mutation | n/a | FAIL (expected) | next run worked out in UTC, not the row's zone: only `c:next-run` fails, for all three zones |
| 2026-10-21 | `8b3f56d92` + mutation | n/a | FAIL (expected) | the fire files through `addTask_tasks` (recorded, not started): only `a:it-runs` (ended pending) and `a:ending-heard-once` (0 ending requests) fail, with CAN'T TELL on launch's ending requests |
| 2026-10-21 | `49159691b` | n/a | PASS | After review fixes (five-field crons, stale fixed times, untimed tolerance, floor, delete with its record): all three legs as before; b answers 200, 202, 200, 200 |
| 2026-10-21 | `49159691b` | n/a | FAIL (expected) | `GOAL_CONTROL=memory-dedupe`: `b:exactly-one-task — one scheduled time filed 4 tasks (fires answered 202, 202, 202, 202)`; `b:early-files-nothing` as before |
| 2026-10-22 | `34c32d4d9` | n/a | FAIL | On main after FIX-2081: `a2` refused, `cancelTask_tasks` is no longer an action |
| 2026-10-22 | `34c32d4d9` + fix | n/a | PASS | Cancel through `updateTask_tasks` with `status: "cancelled"`: every leg green, as on 2026-10-21 |
| 2026-10-22 | `34c32d4d9` + fix | n/a | FAIL (expected) | `GOAL_CONTROL=memory-dedupe`: `b:exactly-one-task` (4 tasks; 202 ×4) and `b:early-files-nothing` |
