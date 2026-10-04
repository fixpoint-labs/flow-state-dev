# shift-manager › it shows who is on shift

**Issue:** FIX-1723

**Outcome:** A person running a Lab in Shift Manager opens Roster and sees every worker the Lab has, each on shift, on call or off shift as the Lab's own records say, with the tasks it holds and what it waits on, for all teams or one. The sidebar's Roster entry, its footer and its TEAMS rows agree with the page.

**Input:** the shift-lab (`lab/`), served by Shift Manager's start script: two teams (`eng`, `ops`) whose workers are all members of the one board's mailbox, and one org-level seat (`chief-of-staff`) with no team. At boot it builds a **spread** (`fixtures/input.json`): per worker, rows its scripted run holds until stopped, rows its run parks for a person, rows filed after the only drain so nothing claims them, and pending approvals in a session of its own. Every assignee names exactly one worker. The check runs two spreads; another spread over the same tree must pass a correct Shift Manager too. No seat, team or board name is written in the check.

**Signal:** per spread, each failure tagged `[spread <n>] <leg>`. Reached by clicking Roster, then each team in the picker, then each TEAMS row.

- **store** (precondition): the store holds the rows and asks the spread built, every assignee resolves to one seat by the check's own rule, Staff and two teams exist, every status has a worker, and the store reads the same after grading as before.
- **roster**: All lists exactly the inventory's seats; a team lists exactly its seats.
- **status**: each worker's group equals what the store gives: a running row is on shift; otherwise a parked row or a pending ask is on call; otherwise off shift.
- **slots**: each worker's slots read `<n> in use` with n squares, n its running and parked rows.
- **holding**: its HOLDING chips are exactly those rows, or it says *nothing assigned*.
- **waits**: its waits-on entries are exactly its parked rows and its pending asks.
- **summary**: *N on shift · M on call · K off shift · J waiting on you* equals the store's, for the workers shown.
- **sidebar**: the Roster entry's `on shift·on call` and the footer's counts equal the store's.
- **TEAMS**: one row per group, Staff first, each with a square per seat carrying the store's status, and its on-shift count over its seats.
- **filter**: each TEAMS row opens Roster for exactly that team, names it in the title, and is marked current.

**Anti-game:**
- No assertion reads Shift Manager's modules. The oracle is the store, read by this script through the Lab's HTTP routes (the inventory, each board's rows, each seat session's suspensions).
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
