# shift-manager › it shows and stops a task run

**Issue:** FIX-1664

**Outcome:** A person opens one task in Shift Manager and watches that task's own run live, can stop it, and sees every other act and value the task screen draws either working from a shipped read or saying what arrives and who ships it, or that it is not planned in the first cut.

**Input:** the run-lab (`packages/shift-manager/test/fixtures/run-lab/`), served by Shift Manager's command, with the devtool it serves beside it. Its tree (its `workforce/`) is one mailbox with one board, a member that drains it, and three seats it hands rows to: a per-task seat on the drainer's flow, a per-worker seat on the drainer's flow, and a per-task seat on a flow of its own. At boot the Lab files its rows through the mailbox's `fileTask` and drains the board once. Each run is a scripted stub, no model: it opens with a reasoning item and one tool call with its result, as a coding harness does, then narrates a step a second and holds until aborted. The per-worker seat's two short rows finish in its one shared session. One row is filed after the drain, so nothing claims it. Every seat, mailbox and board name is read from the tree at run time.

**Signal:** each failure tagged `[<row>] <leg>`, over four rows: the held run on the drainer's flow, the held run on a flow of its own, a finished run, and the unclaimed row. Each is reached by clicking, from Tasks or, once done, from its board card, never by a typed URL.

- **store** (precondition): the board holds those four rows.
- **items equal the run session's**: the Session's items equal, by id and in order, the task's items in the run session's stored state plus its request's stream, read through the flow the session records as its owner and filtered by core's `itemsForTask`. The store is read before and after the screen, so the screen must hold everything the first read held and nothing the second doesn't.
- **live**: the next item the request stores for the task is drawn within 2 s, with no reload.
- **the request reads aborted first**: after Interrupt, once the view reads `aborted`, the request record read through its own flow already reads `aborted`, and the view's word is *interrupted*. The row's run link is unchanged afterwards.
- **inspector**: the worker equals the tree's member the row is assigned to. The start time equals the row's. The plan steps and file paths equal what the run recorded under its request id, or the inspector says the harness records none. The trace link is the address of the devtool Shift Manager serves with `?session=` the run's session, and the session id is shown beside it. Clicking it opens a page where the devtool has the run's session open.
- **gaps**: Hand off, reassign, Open PR and *also post* are disabled. The composer takes a message on a running task, since every worker flow has a door (FIX-1789), and on the finished task it is disabled, saying a finished task takes no message. Each of the others, the Diff and Checks tabs, the Brief's missing fields and acceptance, and the inspector's harness, acceptance and reviewer lines carry a gap line that names its owner or says *not planned in the first cut*.
- **no run**: the unclaimed row says no run has started, and Interrupt is disabled.
- **reach**: the page throws nothing.

**Anti-game:** a hollow pass would be a Session showing some other session's items, a view that draws *interrupted* on its own word, or a screen that reads every run through the board's flow. So the check never reads Shift Manager's state. Its oracles are the tree on disk and the store, read by this script through the Lab's routes and through each run's own flow. Items are compared by id, never as text on the page. The third row runs on a flow other than the board's, so a screen that assumes the board's flow can't pass it.

**Model:** n/a (the scripted run stub).

**Run:** `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/shift-manager/it-shows-and-stops-a-task-run/run.mts`

**Controls:** each rebuilds Shift Manager with `src/lib/run.ts` swapped for a module under `controls/`. The build fails if the swap never fired.

- `GOAL_CONTROL=worker-session`: the Session reads the newest other session on the run's flow, or on any flow when the run's flow has no other, and follows no stream. Must fail at **items equal the run session's**.
- `GOAL_CONTROL=optimistic-interrupt`: Interrupt draws *interrupted* without calling abort. Must fail at **the request reads aborted first**.
- `GOAL_CONTROL=board-flow`: every run is opened through the drainer's flow, not the flow its session names. Must fail at **items equal the run session's** on the row whose run is on a flow of its own, and pass the others.

**Before-state:** `GOAL_PAGES=<dir>` serves pages built elsewhere instead of building. Pages built from FIX-1662's shell, which had only the placeholder task frame, fail every leg on every row.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-09-30 | e8f4c7276+wip | n/a | FAIL (before-state, expected) | Pages built from `origin/fix-1662-app-lab-shell`. All four rows fail: the Session never opened the run ("The task screen is not here yet"), there is no inspector, no gap lines and no Interrupt. |
| 2026-09-30 | e8f4c7276+wip | n/a | FAIL | First run of the goal. Only **gaps**, on all three run rows: *also post* named no owner. Its copy now carries the composer's registry entry. |
| 2026-09-30 | e8f4c7276+wip | n/a | PASS | Held on the drainer's flow: items equal, a new item drawn within 2 s, the record `aborted` before *interrupted*. Held on its own flow: the same, plus a plan of 2 steps and 1 file equal to the recorded rows. Finished (per-worker, in a shared session): 3 items equal. Unclaimed: no run, Interrupt disabled. |
| 2026-09-30 | e8f4c7276+wip | n/a | FAIL (control `board-flow`, expected) | Only the row on its own flow: **items equal the run session's**, because the request answered 404 through the drainer's flow. Inspector plan and files were empty, and Interrupt never became available. The drainer's-flow row and the finished row passed. |
| 2026-09-30 | e8f4c7276+wip | n/a | FAIL (control `worker-session`, expected) | **items equal the run session's** on all three rows: nothing drawn while 3 to 16 items were stored. **live** also failed on both held rows. |
| 2026-09-30 | e8f4c7276+wip | n/a | FAIL (control `optimistic-interrupt`, expected) | Only **the request reads aborted first**, on both held rows: the view read *interrupted* while the record read `in_progress`. |
| 2026-09-30 | after merging `main` and FIX-1662's review round | n/a | PASS | Drainer's flow: 4 items drawn and stored, then aborted. Own flow: 8 items, then aborted. Finished: 3 items. |
| 2026-09-30 | after merging `main` and FIX-1662's review round | n/a | FAIL (control `board-flow`, expected) | Same as before: only the own-flow row, at **items equal the run session's** (404 through the drainer's flow), plus its inspector and Interrupt. |
| 2026-09-30 | review round 2 (render filters, next attempt, board failure) | n/a | PASS | The run now also writes a keyed progress snapshot twice. Drainer's flow: 5 items drawn and stored, then aborted. Own flow: 9 items, then aborted. Finished: 4 items. The snapshot's versions share one id, so the stored count and the drawn count agree without extra filtering. |
| 2026-09-30 | review round 2 | n/a | FAIL (control `optimistic-interrupt`, expected) | Only **the request reads aborted first**, on both held rows. |
| 2026-09-30 | review round 2 | n/a | FAIL (control `worker-session`, expected) | **items equal the run session's** on all three rows (nothing drawn), and **live** on both held rows. |
| 2026-09-30 | review round 2 | n/a | FAIL (control `board-flow`, expected) | Only the own-flow row: 404 through the drainer's flow, empty inspector, no Interrupt. |
| 2026-10-01 | a25134ebd+wip (FIX-1691/1692) | n/a | FAIL (before-state, expected) | Inspector with the goal's new link check, TaskInspector as on main: **inspector** fails on all three rows, "the trace link is http://127.0.0.1:4000/, wanted …/?session=<the run's session>". |
| 2026-10-01 | a25134ebd+wip (FIX-1691/1692) | n/a | PASS | The trace link is the `--devtool` address with `?session=` the run's session. Drainer's flow: 5 items, then aborted. Own flow: 9 items, then aborted. Finished: 4 items. `worker-session`, `optimistic-interrupt` and `board-flow` each FAIL at their named signal. |
| 2026-10-01 | fix-1688-app-lab-skin (pre-PR) | n/a | PASS | The run-lab's runs now also store a reasoning item and a tool call, and the Session draws them with Shift Manager's registry copies. held on lab.lead: 8 items drawn = stored; held on lab.auditor: 13; finished: 6. `worker-session`, `optimistic-interrupt` and `board-flow` each FAIL at their named leg only. |
| 2026-10-01 | f46942359+wip (FIX-1691, same-process devtool) | n/a | PASS | No `--devtool`: the trace link is the devtool Shift Manager serves with `?session=` the run's session, and clicking it opens a page where that session is open, on all three run rows. With the devtool served over a second load of the config (its own store), the leg FAILs on every row with the devtool's own 404. `worker-session`, `optimistic-interrupt` and `board-flow` each FAIL at their named signal. |
| 2026-10-01 | 829c2c2dd+wip (FIX-1690 lab) | n/a | PASS | Seats are now registered with their doors. No kind here declares one, so the composer is disabled and says the worker takes no message. Held on lab.lead: 7 items, then aborted. Held on lab.auditor: 11, then aborted. Finished: 6. |
| 2026-10-01 | 475b3cd4b (feat/FIX-1649-shift-manager) | n/a | PASS | After the rename to Shift Manager. DevTeam served from `packages/shift-manager/teams/devteam`; the pages carry the boot-shift code, unset in this run. |
