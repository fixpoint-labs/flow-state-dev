# app-lab › it opens a lab

**Issue:** FIX-1662

**Outcome:** A person runs App Lab's start command over a Lab's own `fsdev.config.mts`, one it was never told about, and every screen they reach shows what that Lab holds. The sidebar lists the Lab's teams and seats and its workstreams. Each workstream's board shows the rows its channel's board holds, at their stored status. Tasks lists the rows that aren't done, and Inbox lists what is waiting on them or says plainly that nothing is. A line they post appears once the channel has kept it, and it is still there after a reload.

**Input:** the two goal Labs as they stand, DevForce (bearer-authenticated, in-memory) and multi-seat-collab (SQLite, no auth). Their configs are not edited. The fixture (`fixtures/input.json`) holds the composer line, the DevForce filing post, and the multi-seat-collab piece of work. It is held out: other text, another issue slug, or another desk the Lab routes must still pass a correct App Lab. Every seat, channel and board name is read from the trees at run time.

**Signal:** per Lab, each failure tagged `[<lab>] <leg>`:

- **store** (precondition): the Lab's inventory holds exactly the tree's seats and channels, and a board holds at least one row.
- **TEAMS equals the store's seats**: the sidebar's seat set equals the inventory's seat rows, and each team lists exactly its seats.
- **PROJECTS equals the store's channels**: the workstream list equals the inventory's channel rows, and each workstream panel's team equals its channel's declared members.
- **Board equals the store's rows** (BR-13): each workstream's Board tab draws exactly its declared boards' stored rows, each card with the stored status word. The task frame opened from a card titles the stored row.
- **Tasks equals the store's open rows**: grouped by state, by worker and by stream, the rows are exactly the stored rows that are neither completed nor cancelled.
- **Inbox equals the store's pending asks**: the count equals the stored suspensions with no resume, on seat-owned sessions, asking a person. With none pending, the empty state is named.
- **reach**: every level, tab and panel opens (Inbox, Tasks, the project level's four tabs, each workstream's four tabs and panel, and the task frame's four tabs and panel slot). Every empty one names what will be there. The page throws nothing.
- **the post appears on screen**: a composer post on the first workstream is drawn.
- **the post is in the stored transcript**: the channel's session holds exactly one `channel-post` with that body, and a reload draws it once.
- **an answer from Inbox lands in the store**: when an ask is pending (DevForce's EM seat raises one at boot), App Lab offers Approve on at least one pending ask, and Approve on Inbox leaves one fewer pending suspension in the store. Asks pending with an answer offered on none is a failure.

The rows come from the Lab's own doors. On multi-seat-collab, the planner files through its action, and the worker seats drain until the row parks. On DevForce, a `<issue>: <text>` post on the channel wakes the EM, which files the row.

**Anti-game:** a hollow pass would be an App Lab that draws names it was built with, draws a post before the channel keeps it, or is graded against its own reads. So the check never asserts on App Lab's own data module. The oracles are the tree on disk (`readDeclaredRoster`) and the store, read through the Lab's HTTP routes by this script's own requests, with the bearer the page was handed. The store is read after the page's refresh, so a UI that invents rows or drops them fails. Each control proves one leg can go red.

**Model:** n/a (model-free: the DevForce harness is the lab's scripted stub, and multi-seat-collab has no model)

**Run:** `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/app-lab/it-opens-a-lab/run.mts`

**Controls:** each control rebuilds App Lab with one source module swapped for a module under `controls/`. The build fails if the swap never fired.

- `GOAL_CONTROL=static-names`: the seat list is written in from the DevForce tree. Must fail at **TEAMS equals the store's seats** on multi-seat-collab, naming the missing seats.
- `GOAL_CONTROL=optimistic-post`: the composer draws its own line and sends nothing. Must fail at **the post is in the stored transcript** on both Labs.
- `GOAL_CONTROL=unanswerable-asks`: every ask is marked as one the Lab won't reopen, so no card offers an answer. Must fail at **an answer from Inbox lands in the store** on DevForce.

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
| 2026-09-30 | 108a83871+wip | n/a | FAIL (control `unanswerable-asks`, expected) | Only `[devforce] an answer from Inbox lands in the store`: 1 ask pending and App Lab offers an answer on none. |
