# shift-manager › it shows who is on shift

**Issue:** FIX-1723

**Outcome:** A person running a Lab in Shift Manager opens Roster and sees every worker the Lab has, each on shift or off shift as the Lab's own records say, with the tasks it holds and what it waits on, for all teams or one. The sidebar's Roster entry, its footer and its TEAMS rows agree with the page.

**Input:** the shift-lab (`lab/`), served by Shift Manager's command: two teams (`eng`, `ops`) and one org-level seat (`chief-of-staff`) with no team. `eng.lead`'s `delegates:` names every worker of both teams that takes a task, and it files every task on its own conversation's board, through that conversation's `createTask_tasks`; `eng.desk` and `ops.desk` are coordinators nothing posts to. At boot it builds a **spread** (`fixtures/input.json`): per worker, tasks its scripted run holds until stopped, tasks its run holds on a question for a person (`askQuestion`; `asked` in the spread, `parked` before FIX-2131), tasks that wait on a held or asked task so nothing starts them, and pending approvals in a session of its own. Every assignee names exactly one worker. The check runs two spreads; another spread over the same tree must pass a correct Shift Manager too. No seat, team or board name is written in the check.

**Signal:** per spread, each failure tagged `[spread <n>] <leg>`. Reached by clicking Roster, then each team in the picker, then each TEAMS row.

- **store** (precondition): the store holds the rows and asks the spread built, every assignee resolves to one seat by the check's own rule, Staff and two teams exist, every status has a worker, and the store reads the same after grading as before.
- **roster**: All lists exactly the inventory's seats; a team lists exactly its seats.
- **status**: each worker's group equals what the store gives: a running row (one held on a question included) or a pending ask is on shift; otherwise off shift. Nothing reads on call.
- **slots**: each worker's slots read `<n> in use` with n squares, n its running rows, those held on a question included.
- **holding**: its HOLDING chips are exactly those rows, or it says *nothing assigned*.
- **waits**: its waits-on entries are exactly its rows held on a question and its pending asks.
- **summary**: *N on shift · K off shift · J waiting on you* equals the store's, for the workers shown.
- **sidebar**: the Roster entry's on-shift count and the footer's equal the store's, and the sidebar never says on call.
- **TEAMS**: one row per group, Staff first, each with a square per seat carrying the store's status, and its on-shift count over its seats.
- **filter**: each TEAMS row opens Roster for exactly that team, names it in the title, and is marked current.

**Anti-game:**
- No assertion reads Shift Manager's modules. The oracle is the store, read by this script through the Lab's HTTP routes (the inventory, the person's conversation ledger, each seat session's suspensions). A row's board is the conversation whose partition keeps it, `<sessionId>.tasks`, by the script's own match against the listed sessions, so a HOLDING chip is graded against the real board ref.
- The script resolves a row to a seat by its own rule (the assignee equals the seat's id, or its name after the team), never by Shift Manager's best match. The fixtures are built so both agree; the **store** leg fails if any assignee names no single seat.
- Two spreads, so a screen tuned to one arrangement fails the other. Every status is present in each, so no group is graded empty.

**Model:** n/a (scripted runs that hold until stopped or park themselves).

**Run:** `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/shift-manager/it-shows-who-is-on-shift/run.mts`

**Controls:** each rebuilds Shift Manager with `src/lib/derive.ts` swapped for a module under `controls/`.
- `GOAL_CONTROL=ignore-asks`: status reads board rows only. Must fail at **status** on the worker whose only wait is an ask.
- `GOAL_CONTROL=count-queued`: queued rows count as slots. Must fail at **slots** on the worker holding a queued row.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-01 | feat/FIX-1723-roster (pre-PR) | n/a | PASS | Spread 1: 7 workers in [Staff, eng, ops]: eng.coder on shift (1 held), eng.reviewer on call (1 parked), ops.asker on call (1 ask), ops.waiter off shift (1 queued), eng.lead, eng.spare and chief-of-staff off shift. Spread 2: eng.reviewer on shift (2 held, 1 parked), ops.waiter on shift, eng.coder on call (1 parked, 1 queued), eng.spare on call (2 asks), ops.asker off shift (1 queued). |
| 2026-10-01 | feat/FIX-1723-roster (pre-PR), `GOAL_CONTROL=ignore-asks` | n/a | FAIL (expected) | **status** on ops.asker (spread 1) and eng.spare (spread 2), drawn off shift where the store says on call, with the **summary**, **sidebar** and **TEAMS** counts that follow from it. slots, holding, waits, roster and filter pass. |
| 2026-10-01 | feat/FIX-1723-roster (pre-PR), `GOAL_CONTROL=count-queued` | n/a | FAIL (expected) | **slots** and **holding** on ops.waiter (spread 1), eng.coder and ops.asker (spread 2): "1 in use" where the worker holds 0 rows and 1 queued. status, summary, sidebar, TEAMS and filter pass. |
| 2026-10-09 | fix/FIX-1824-goals-one-copy on 9d136d21a, before the fix | n/a | FAIL | Red on `main` since FIX-1788 P4, before any leg: *"Shift Manager's command never served the shift-lab … Failed to load fsdev config …/lab/fsdev.config.mts: installation.workerFlows is not a function"* (`lab.mts` called `hireWorkforce(tree.workers, { workerFlows })`). |
| 2026-10-09 | fix/FIX-1824-goals-one-copy on 9d136d21a | n/a | PASS | The lab runs every worker on one copy of `lead` or `seat` (`installWorkers`); the drain and each ask open their session on that copy naming the worker, and a row's run session names the lead that drained it. The **store** oracle reads asks through `goals/lib`'s `pendingSeatAsks`: a session on a seat's kind that names that seat, or names none. Spread 1: eng.coder on shift (1 held), eng.reviewer on call (1 parked), ops.asker on call (1 ask), ops.waiter off shift (1 queued), eng.lead, eng.spare and chief-of-staff off shift. Spread 2: eng.reviewer on shift (2 held, 1 parked), ops.waiter on shift, eng.coder on call (1 parked, 1 queued), eng.spare on call (2 asks), ops.asker off shift (1 queued). |
| 2026-10-09 | same, `GOAL_CONTROL=ignore-asks` | n/a | FAIL (expected) | **status** on ops.asker (spread 1) and eng.spare (spread 2), drawn off shift where the store says on call, with the **summary**, **sidebar** and **TEAMS** counts that follow. slots, holding, waits, roster and filter pass. The store saw each ask on its own seat, through the session's `workerId`. |
| 2026-10-09 | same, `GOAL_CONTROL=count-queued` | n/a | FAIL (expected) | **slots** and **holding** on ops.waiter (spread 1), eng.coder and ops.asker (spread 2). status, summary, sidebar, TEAMS and filter pass. |
| 2026-10-10 | FIX-1792 P3 on 8d64a67b, the tree converted and `lab.mts` not yet | n/a | FAIL | Before any leg: *"Failed to load fsdev config …/lab/fsdev.config.mts: the shift-lab tree declares no mailbox holding a board"*. The old lab found its board through a `MAILBOX.md`, and the tree has none. |
| 2026-10-10 | FIX-1792 P3, ea9ebdf2 | n/a | PASS | `eng.desk` and `ops.desk` are coordinator worker files; `eng.lead` files every task through its conversation's `addTask_tasks` for its `delegates:`, and the store reads every row off the person's conversation ledger, on the lead's `<sessionId>.tasks` board. A parked task parks on its question (`parkOnQuestion`); a queued one waits on a held or parked task. Spread 1: 9 workers in [Staff, eng, ops]: eng.coder on shift (1 held), eng.reviewer on call (1 parked), ops.asker on call (1 ask), ops.waiter off shift (1 queued); eng.desk, eng.lead, eng.spare, ops.desk and chief-of-staff off shift. Spread 2: eng.reviewer on shift (2 held, 1 parked), ops.waiter on shift, eng.coder on call (1 parked, 1 queued), eng.spare on call (2 asks), ops.asker off shift (1 queued). The two desks are workers now, so the roster has 9 rows where it had 7. |
| 2026-10-10 | same, `GOAL_CONTROL=ignore-asks` | n/a | FAIL (expected) | **status** on ops.asker (spread 1) and eng.spare (spread 2), drawn off shift where the store says on call, with the **summary**, **sidebar** and **TEAMS** counts that follow. slots, holding, waits, roster and filter pass. |
| 2026-10-10 | same, `GOAL_CONTROL=count-queued` | n/a | FAIL (expected) | **slots** and **holding** on ops.waiter (spread 1), eng.coder and ops.asker (spread 2); the extra chip names the queued task on the lead's `<sessionId>.tasks` board. status, summary, sidebar, TEAMS and filter pass. |
| 2026-10-11 | FIX-1792 P4 on 617aeabb + uncommitted | n/a | PASS | No change needed beyond P4's own edit to `lab/lab.mts` (the inventory write's new shape). Both spreads as on P3: 9 workers in [Staff, eng, ops] each time, every row on the lead's `<sessionId>.tasks` board. Spread 1: eng.coder on shift, eng.reviewer and ops.asker on call, ops.waiter off shift with 1 queued. Spread 2: eng.reviewer and ops.waiter on shift, eng.coder and eng.spare on call, ops.asker off shift with 1 queued. |
| 2026-10-13 | FIX-1964 on 321a97b0 + uncommitted | n/a | PASS | On Call removed: two statuses. A running row, a parked row or a pending ask is on shift. Spread 1: eng.coder, eng.reviewer and ops.asker on shift; spread 2: eng.coder, eng.reviewer, eng.spare and ops.waiter on shift. The sidebar's Roster entry and footer carry the on-shift count alone. |
| 2026-10-13 | same, `GOAL_CONTROL=ignore-asks` | n/a | FAIL (expected) | **status** on the workers whose only wait is an ask (eng.spare in spread 2, among others), drawn off shift where the store says on shift, with the **summary** and **TEAMS** counts that follow. |
| 2026-10-26 | `fix/fix-2131` on `f32747683`, uncommitted | n/a | PASS | The `parked` state is `asked` (FIX-2131): the run holds its task on a question with `askQuestion`. Spread 1: eng.coder, eng.reviewer (1 held, 1 wait) and ops.asker on shift; spread 2: eng.coder, eng.reviewer, eng.spare and ops.waiter on shift. |
