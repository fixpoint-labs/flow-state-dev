# shift-manager › it groups workstreams under their projects

**Issue:** FIX-1718

**Outcome:** A person opening Shift Manager on a Lab finds every project the Lab holds, each with the workstreams its record names, then No project with the rest. Each project's four tabs show that project's work, and its Stream is one room its members share and nobody else reads.

**Input:** the DevTeam profile (`labs/shift-manager/teams/devteam/fsdev.config.mts`), unedited, on a fresh store. At boot it creates two default projects through the project writes' own `createProject`: one holding a workstream from each of two teams, one holding none. Three verified users: the owner (the page's person), a member, and an outsider in the same organization. The fixture (`fixtures/input.json`) holds the lines posted and the burst sizes, and is held out: other text and other sizes must still pass. Project, workstream and seat names are read from the store and the tree at run time.

**Signal:** each failure is tagged with its leg.

- **store** (precondition): the Lab holds at least one project row, each owned by the profile's person with a talk session bound, and one row lists workstreams from two teams.
- **PROJECTS equals the store's rows:** the sidebar's project groups, in order, are the `projects` rows, each with exactly the workstreams it lists, then No project with every inventoried channel no row lists (shown only when there is one).
- **the cross-team project:** PROJECTS groups both teams' workstreams under it, and its Workstreams tab lists both.
- **a project's four tabs:** for every row, Brief draws the row's brief; Board draws a lane per board-holding workstream it lists; Workstreams lists exactly its workstreams; a line posted from Stream's composer is drawn and is in the room once, under the owner. No tab draws a `project-*-empty` state or copy naming FIX-1650.
- **the inventory equals the tree's channels:** no talk session shows up as a channel.
- **a burst of joins leaves one session per member:** the member joins every project they're in from several new sessions at once. Every join completes, every join on a project answers the same session, and the row lists exactly one session per member.
- **members read each other's lines:** the owner's line is in the member's read, and the member's reply is in the owner's read after the owner's cursor.
- **a seat's answer is in the room for both:** the EM's answer to the owner's line is in both members' reads.
- **the outsider is refused:** the outsider's `join` is refused, and so are its `read` and `post` from a session it created with the project's `resourceId` in its state. The room holds none of its lines and the row lists no session of its.
- **a burst of posts lands whole:** both members post a burst at once. Every post completes, and the room holds each line exactly once, each at its own sequence number.

**Anti-game:** expected values come from the store and the tree, never from the check or from Shift Manager's own data module. Rows are written by the profile's own code at boot. The page's lines go through its composer and the owner's talk session; the room is read back over HTTP through each member's own talk session, with each user's own bearer. The outsider legs run in the same organization, so only the membership check stands between it and the room.

**Not here:** the `cos` leg (asked for two projects, the chief of staff creates two rows through its `createProject` tool) and its `no-tool` control need FIX-1719's chief-of-staff seat and a model. They land with FIX-1718's last PR.

**Model:** n/a (model-free: the DevTeam harness is the lab's scripted stub, and the EM answers a room line without a model)

**Run:** `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/shift-manager/it-groups-workstreams-under-their-projects/run.mts`

**Controls:** the page controls rebuild Shift Manager with one source module swapped for one under `controls/`, as `it-opens-a-lab` does; the build fails if the swap never fired. The server controls load the Lab with a Node module hook (`controls/swap-hook.mjs`) that swaps one workforce source module, and the run fails if no import was swapped.

- `GOAL_CONTROL=unread`: the grouping ignores the rows and lists every workstream on its own. Must fail at **PROJECTS equals the store's rows**.
- `GOAL_CONTROL=gap-tabs`: the project level as it was before projects, every tab a FIX-1650 empty state. Must fail at **a project's four tabs**.
- `GOAL_CONTROL=no-gate`: `membership-gate.ts` answers yes for everyone. Must fail at **the outsider is refused**.
- `GOAL_CONTROL=no-retry`: `cas-retry.ts` makes one attempt, so the room's sequence counter and a join's append to `sessions` get only the engine's own retries. Must fail at both **a burst of posts lands whole** and **a burst of joins leaves one session per member**.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
