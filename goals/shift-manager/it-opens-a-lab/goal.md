# shift-manager › it opens a lab

**Issue:** FIX-1662

**Outcome:** A person runs Shift Manager's start command over a Lab's own `fsdev.config.mts`, one it was never told about, and every screen they reach shows what that Lab holds. The sidebar lists the Lab's teams and seats and its workstreams. Each workstream's board shows the rows its channel's board holds, at their stored status. Tasks lists the rows that aren't done, and Inbox lists what is waiting on them or says plainly that nothing is. A line they post appears once the channel has kept it, and it is still there after a reload.

**Input:** the two goal Labs as they stand, DevTeam (bearer-authenticated, in-memory) and multi-seat-collab (SQLite, no auth). Their configs are not edited. The fixture (`fixtures/input.json`) holds the composer line, the DevTeam filing post, and the multi-seat-collab piece of work. It is held out: other text, another issue slug, or another desk the Lab routes must still pass a correct Shift Manager. Every seat, channel and board name is read from the trees at run time.

**Signal:** per Lab, each failure tagged `[<lab>] <leg>`:

- **store** (precondition): the Lab's inventory holds exactly the tree's seats and channels, and a board holds at least one row.
- **TEAMS equals the store's seats**: the sidebar's TEAMS squares, one per seat, equal the inventory's seat rows, and each team's row has a square for exactly its seats (a seat with no team sits in the Staff row).
- **PROJECTS equals the store's channels**: the workstream list equals the inventory's channel rows, and each workstream panel's team equals its channel's declared members.
- **Board equals the store's rows** (BR-13): each workstream's Board tab draws exactly its declared boards' stored rows, each card with the stored status word. The task frame opened from a card titles the stored row.
- **Tasks equals the store's open rows**: grouped by state, by worker and by stream, the rows are exactly the stored rows that are neither completed nor cancelled and not queued (pending, blocked or of an unknown status). With the Queued toggle on, they are every such row. The toggle's count equals the stored queued rows.
- **Inbox equals the store's pending asks**: the count equals the stored suspensions with no resume, on seat-owned sessions, asking a person. With none pending, Inbox says nothing needs the person, with the store's count of running rows and of seats on call.
- **reach**: every level, tab and panel opens (Chief of Staff with its summary and panel, Inbox by its route, Tasks, No project's four tabs (Stream and Brief say it has neither, Workstreams and Board list the workstreams no project lists), each workstream's four tabs and panel, and the task frame's four tabs and panel slot). Every empty one names what will be there. The page throws nothing.
- **the post appears on screen**: a composer post on the board-holding workstream is drawn.
- **the post is in the stored transcript**: the channel's session holds exactly one `channel-post` with that body, and a reload draws it once.
- **an answer from Inbox lands in the store**: when an ask is pending (DevTeam's EM seat raises one at boot), Shift Manager offers Approve on at least one pending ask, and Approve on Inbox leaves one fewer pending suspension in the store. Asks pending with an answer offered on none is a failure.

The rows come from the Lab's own doors. On multi-seat-collab, the planner files through its action, and the worker seats drain until the row parks. On DevTeam, a `<issue>: <text>` post on the channel wakes the EM, which files the row.

**Anti-game:** a hollow pass would be a Shift Manager that draws names it was built with, draws a post before the channel keeps it, or is graded against its own reads. So the check never asserts on Shift Manager's own data module. The oracles are the tree on disk (`readDeclaredRoster`) and the store, read through the Lab's HTTP routes by this script's own requests, with the bearer the page was handed. The store is read after the page's refresh, so a UI that invents rows or drops them fails. Each control proves one leg can go red.

**Model:** n/a (model-free: the DevTeam harness is the lab's scripted stub, and multi-seat-collab has no model)

**Run:** `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/shift-manager/it-opens-a-lab/run.mts`

**Controls:** each control rebuilds Shift Manager with source modules swapped for a module under `controls/`. The build fails if a swap never fired.

- `GOAL_CONTROL=static-names`: the seat list is written in from the DevTeam tree. A written-in seat the store also holds keeps its stored door, so only the names are written in. Must fail at **TEAMS equals the store's seats** on multi-seat-collab, naming the missing seats.
- `GOAL_CONTROL=optimistic-post`: the workstream composer draws its own line and sends nothing, whether the line is a post (`src/lib/transcript.ts`) or an `@worker` turn (`src/lib/send.ts`). Must fail at **the post is in the stored transcript** on both Labs. This goal sends no `@worker` turn; the turn half is for checks that do, like FIX-1663's a4.
- `GOAL_CONTROL=queued-shown`: Tasks treats no row as queued, so the Queued toggle hides nothing (`src/lib/tasks.ts`). Must fail at **Tasks equals the store's open rows** on DevTeam, whose filed row is queued, naming the extra rows and the toggle's count.
- `GOAL_CONTROL=unanswerable-asks`: every ask is marked as one the Lab won't reopen, so no card offers an answer. Must fail at **an answer from Inbox lands in the store** on DevTeam.

The empty Inbox's two counts have no control here. Neither Lab reaches an empty Inbox with a running row or a seat on call, so both counts read 0 and a sentence that never counts would still pass. `labs/shift-manager/test/inbox-tasks.test.ts` proves the counting.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-09-30 | 9661e4494+wip | n/a | PASS | Before the #2445 merge. devforce: 3 seats, 1 channel, 1 row (pending, filed by the EM from a post), post kept once; multi-seat-collab: 3 seats, 1 channel, 1 row (parked), post kept once; Inbox 0 of 0 pending on both, empty state named. |
| 2026-09-30 | 9661e4494+wip | n/a | FAIL (control `static-names`, expected) | Only `[multi-seat-collab] TEAMS equals the store's seats`: missing [eng.builder, eng.planner], extra [eng.coder, eng.em]. DevForce passes, because the written-in list is its own. |
| 2026-09-30 | 9661e4494+wip | n/a | FAIL (control `optimistic-post`, expected) | Only `the post is in the stored transcript`, on both Labs: 0 stored copies, and gone after a reload. The line *was* drawn, so "appears on screen" stayed green. |
| 2026-09-30 | wip on #2445 merge | n/a | PASS | DevForce now raises the EM's ask at boot: Inbox 1 listed of 1 pending, Approve left 0 pending in the store. devforce: 3 seats, 1 channel, 1 row (pending), post kept once; multi-seat-collab: 3 seats, 1 channel, 1 row (parked), post kept once, Inbox empty state named. |
| 2026-09-30 | wip on #2445 merge | n/a | FAIL (control `static-names`, expected) | Only `[multi-seat-collab] TEAMS equals the store's seats`: missing [eng.builder, eng.planner], extra [eng.coder, eng.em]. |
| 2026-09-30 | wip on #2445 merge | n/a | FAIL (control `optimistic-post`, expected) | Only `the post is in the stored transcript`, on both Labs: 0 stored copies, gone after a reload. |
| 2026-09-30 | 108a83871+wip | n/a | PASS | After the review round (DevForce config assembled through `openLab`, allow-list for answerable asks). devforce: inbox 1 listed / 1 pending, approved 1 of 1, 0 left; 3 seats, 1 channel, 1 row (pending), post kept once; multi-seat-collab: 3 seats, 1 channel, 1 row (parked), post kept once, no ask to answer. |
| 2026-09-30 | 108a83871+wip | n/a | FAIL (control `static-names`, expected) | Only `[multi-seat-collab] TEAMS equals the store's seats`: missing [eng.builder, eng.planner], extra [eng.coder, eng.em]. |
| 2026-09-30 | 108a83871+wip | n/a | FAIL (control `optimistic-post`, expected) | Only `the post is in the stored transcript`, on both Labs: 0 stored copies, and gone after a reload. |
| 2026-09-30 | 108a83871+wip | n/a | FAIL (control `unanswerable-asks`, expected) | Only `[devforce] an answer from Inbox lands in the store`: 1 ask pending and Shift Manager offers an answer on none. |
| 2026-10-01 | 829c2c2dd+wip (FIX-1690 lab) | n/a | PASS | DevForce's coder seat now has a `message` door, and seats are registered with their doors. Every level still matches each tree and store. DevForce: 1 ask listed of 1 pending, 1 approved. |
| 2026-10-01 | 475b3cd4b (feat/FIX-1649-shift-manager) | n/a | PASS | After the rename to Shift Manager. DevTeam served from `labs/shift-manager/teams/devteam`; the pages carry the boot-shift code, unset in this run. |
| 2026-10-01 | feat/FIX-1723-roster (pre-PR) | n/a | PASS | TEAMS re-pointed at the team rows' status squares (one per seat); the worker list under each team is gone. devteam: 3 seats, 1 row [pending], ask approved 1 of 1. multi-seat-collab: 3 seats, 1 row [parked]. |
| 2026-10-01 | feat/FIX-1723-roster (pre-PR), `GOAL_CONTROL=static-names` | n/a | FAIL (expected) | Only `[multi-seat-collab] TEAMS equals the store's seats`: missing [eng.builder, eng.planner], extra [eng.coder, eng.em], for the squares and for team eng's row. |
| 2026-10-02 | feat/FIX-1737-d-inbox-tasks-roster (pre-PR) | n/a | PASS | Tasks graded with Queued hidden and shown; Inbox's empty sentence compared whole. devteam: 3 seats, 1 row [pending, queued: hidden by default, toggle says 1], inbox 1 of 1, approved 1 of 1. multi-seat-collab: 3 seats, 1 row [parked], Inbox empty with the store's sentence. |
| 2026-10-02 | feat/FIX-1737-d-inbox-tasks-roster (pre-PR), `GOAL_CONTROL=queued-shown` | n/a | FAIL (expected) | Only `[devteam] Tasks equals the store's open rows`: the queued row shown with Queued off in all three groupings, and the toggle says 0 of 1. |
| 2026-10-02 | feat/FIX-1737-d-inbox-tasks-roster (pre-PR), `GOAL_CONTROL=static-names` | n/a | FAIL (expected) | Only `[multi-seat-collab] TEAMS equals the store's seats`: missing [eng.builder, eng.planner], extra [eng.coder, eng.em]. |
| 2026-10-02 | feat/FIX-1737-d-inbox-tasks-roster (pre-PR), `GOAL_CONTROL=unanswerable-asks` | n/a | FAIL (expected) | Only `[devteam] an answer from Inbox lands in the store`: 1 pending, no answer offered. |
| 2026-10-02 | feat/FIX-1737-d-inbox-tasks-roster (pre-PR), `GOAL_CONTROL=optimistic-post` | n/a | FAIL (expected) | Only `the post is in the stored transcript`, on both Labs: 0 stored copies, gone after a reload. |
| 2026-10-02 | feat/FIX-1737-d-inbox-tasks-roster (review round) | n/a | PASS | The empty Inbox's running count is per run session. devteam: inbox 1 of 1, approved 1 of 1, queued row hidden; multi-seat-collab: Inbox empty with the store's sentence. `queued-shown` FAILS only at `[devteam] Tasks equals the store's open rows`. |
| 2026-10-02 | f97b906a7+wip (FIX-1718 PR 3) | n/a | PASS | DevTeam now holds 4 channels and two projects; the project-level reach leg grades No project (Stream and Brief say none, Workstreams and Board list eng.triage and ops.oncall, no board). devteam: 3 seats, 4 channels, 1 row [pending], post kept 1, approved 1 of 1. multi-seat-collab unchanged. Controls static-names, optimistic-post, unanswerable-asks each still fail only their leg. |
| 2026-10-03 | merge of 839a5f550 into feat/FIX-1737-d-inbox-tasks-roster | n/a | PASS | devteam: 4 seats (chief-of-staff now among them), 4 channels, 1 row [pending, queued hidden], inbox 1 of 1, approved 1 of 1. multi-seat-collab: 3 seats, Inbox empty. Controls static-names, optimistic-post, queued-shown, unanswerable-asks each fail only their leg; static-names now also lists chief-of-staff as extra. |
