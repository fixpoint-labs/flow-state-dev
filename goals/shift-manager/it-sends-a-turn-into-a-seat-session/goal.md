# shift-manager › it sends a turn into a seat session

**Issue:** FIX-1690

**Outcome:** A person types a line to a worker in Shift Manager: in a task's composer, as `@worker` in a workstream, or as a reply under an ask in Inbox. The line lands in that worker's session, and Shift Manager says *delivered* only once it is there. A coding run that was working stops, and its next attempt continues the same coding session with the line, at no cost to the task's retries.

**Input:** two Labs, each served by Shift Manager's command.

- DevTeam's own tree and `openLab`, configured by `lab/fsdev.config.mts`. The coder seat's harness slot holds this goal's recording harness (`lab/recording-harness.mts`). There is no model. Every attempt writes down what it was handed and holds until it is stopped. At boot the Lab files two rows (`lab/rows.mts`) through the EM seat and drains them, so the coder has two running tasks. The store is a SQLite file. DevTeam raises the EM seat's ask, as its own config does.
- The fixture Lab under `lab/asker/`: one seat whose kind asks a person, and whose `message` door says what it heard.

**Signal:** each failure is tagged `[<route>] <leg>`. A fresh token is typed for each route.

- **delivered**: the run session the task links to holds a user message item with the token. The moment the composer first reads *delivered*, the check reads the store, and the item must already be there. Read again once the next attempt links, the task's run link still names that session.
- **stopped**: the attempt that was running has a request that reads `aborted` through the flow that owns its session.
- **continued**: the harness's own record on disk has a next attempt on that row. Its prompt holds the token, and its resume id equals the coding session the previous attempt named.
- **standing**: once the next attempt is claimed, the stored row's retry standing is unchanged (`attempts − abandonments − turnReentries`).
- **picker**: `@coder` asks which of the coder's two running tasks the line is for. The line reaches the chosen task, not the other.
- **em door**: on DevTeam's EM ask, Inbox's reply is a user item in the EM's own session, and the EM answers there. The line names no feature, so the answer says nothing was filed. (Every worker flow has a door since FIX-1789, the EM's included; before it, this leg graded a disabled reply.)
- **heard**: on the fixture seat's ask, Inbox's reply is a user item in the ask's own session, the seat says *Heard: <token>* there, and Inbox then draws the reply under the ask as the person's own, read back from that session.
- **reach**: the pages throw nothing.

Routes: **task composer** (the first row, reached from Tasks by clicking), **@coder** (the second row, chosen from the picker in the feature workstream), **Inbox, EM door** and **Inbox reply**.

**Anti-game:** the check never reads Shift Manager's state.
- Its oracles are the stores and the harness's record:
  - each Lab's store, read through its routes with the check's own requests;
  - DevTeam's store file, for the retry counters, which the board's browser view doesn't carry;
  - the file the harness appends each attempt to.
- The resume id and the prompt come from what the harness was handed, not from the manager's record of it.
- Tokens are fresh every run.
- *Delivered* is graded at the instant it is drawn, not after the fact.

**Model:** n/a (the recording harness).

**Run:** `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/shift-manager/it-sends-a-turn-into-a-seat-session/run.mts`

**Controls:**

- `GOAL_CONTROL=optimistic-turn`: Shift Manager is rebuilt with `src/lib/send.ts` swapped for `controls/optimistic-turn.ts`. It reports a line delivered without calling the door. Must fail at **delivered**. The build fails if the swap never fired.
- `GOAL_CONTROL=fresh-session`: the harness drops the resume id it is offered, so every attempt starts a new coding session. Must fail at **continued**, naming the resume id.

**Before-state:** `GOAL_PAGES=<dir>` serves pages built elsewhere instead of building them. Pages built before the composers existed fail every route.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-01 | 829c2c2dd+wip (lab) | n/a | FAIL (before-state, expected) | Pages built from the `door` branch (e39b696c3), whose composers were still disabled. Every route fails. The task composer never enables, `@coder` asks nothing, and Inbox shows no reply box. |
| 2026-10-01 | 829c2c2dd+wip (lab) | n/a | PASS | Task composer on turn-1 and `@coder` on turn-2 (chosen from two): each was *delivered* with the line already held, the attempt's request `aborted`, the next attempt resumed the previous attempt's coding session with the line, and standing went 1 → 1 (attempts 2, 1 turn re-entry). EM ask: the reply is disabled, "eng.em takes no message. Answer its ask with Approve or Reject." Fixture ask: the reply was delivered into the ask's session, and the seat heard it. |
| 2026-10-01 | 829c2c2dd+wip (lab) | n/a | FAIL (control `optimistic-turn`, expected) | **delivered** on all three sending routes: *delivered* was drawn while the session held no line. Nothing downstream happened either: the request stayed `in_progress`, there was no next attempt, and the seat heard nothing. |
| 2026-10-01 | 829c2c2dd+wip (lab) | n/a | FAIL (control `fresh-session`, expected) | Only **continued**, on both coding routes: "the next attempt resumed nothing (the resume id), wanted the previous attempt's session sess_turn_goal_…". |
| 2026-10-01 | 829c2c2dd+wip (lab) | n/a | FAIL (planted, expected) | With the turn re-entry not counted (`unparkPatch` planted, then restored), only **standing** fails, on both coding routes: 1 → 2. |
| 2026-10-01 | caf8e92ea+wip (review round) | n/a | PASS | After the shared send state, the tail read and the unconfirmed outcome: both coding routes delivered with the line held, request `aborted`, same coding session resumed, standing 1 → 1; EM reply disabled; fixture reply heard. `optimistic-turn` FAILS at **delivered** on all three routes; `fresh-session` FAILS only at **continued**. |
| 2026-10-01 | f7c87dc2c+wip (door fix: the drain runs in the claiming session) | n/a | PASS | Both coding routes delivered with the line held, and once the next attempt linked, the task still named the session the line went into. Request `aborted`, same coding session resumed, standing 1 → 1. EM reply disabled; fixture reply heard. Planted control (the door drains in the run's own session): FAILS only at **delivered**, on both coding routes ("after delivery the task links session dsx_…, not dsx_… where the line was delivered"). `optimistic-turn` FAILS at **delivered** on all three routes; `fresh-session` FAILS only at **continued**. |
| 2026-10-01 | 475b3cd4b (feat/FIX-1649-shift-manager) | n/a | PASS | After the rename to Shift Manager. DevTeam served from `packages/shift-manager/teams/devteam`; the pages carry the boot-shift code, unset in this run. |
| 2026-10-02 | feat/FIX-1737-d-inbox-tasks-roster (pre-PR) | n/a | PASS | **heard** now also requires Inbox to draw the reply under the ask, read back from the ask's session: drawn. Both coding routes delivered with the line held, request `aborted`, same coding session resumed, standing 1 → 1; EM reply disabled. |
| 2026-10-02 | feat/FIX-1737-d-inbox-tasks-roster (pre-PR), `GOAL_CONTROL=optimistic-turn` | n/a | FAIL (expected) | **delivered** on the sending routes, and on the Inbox reply **heard** now also names the reply never drawn under the ask. |
| 2026-10-08 | fix/closure-children-one-copy (main 0f569d032) | n/a | PASS | The asker Lab builds an installation and registers one copy of `asker`, and the ask is raised in a session on `asker` naming `desk.asker` (FIX-1788 P4). Before, the asker config failed to load: "installation.workerFlows is not a function". `optimistic-turn` FAILs at **delivered**; `fresh-session` only at **continued**. |
