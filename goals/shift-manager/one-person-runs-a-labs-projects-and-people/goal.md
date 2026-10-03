# shift-manager › one person runs a Lab's projects and people

**Issue:** FIX-1720 (closure of FIX-1650, Org primitives)

**Outcome:** On one `main` commit, a person running the DevTeam Lab alone in Shift Manager asks the chief of staff for two projects, one spanning two teams, and finds them under PROJECTS, each with four tabs and a room its members share and an outsider can't read. They hire through the chief of staff at once and fire only on their own Approve in Inbox. They clear a seat whose kind a release cut. Every change survives a restart. Someone building the next Lab gets the same from the published docs alone, and every child's own check passes on that commit.

**Input:** the DevTeam profile (`labs/shift-manager/teams/devteam`) over `goals/devforce-lab/lab/` as the children leave it, served by Shift Manager's own start script in real Chromium, as the profile's owner, with the second member and the outsider in their own browser contexts. Held out: the two project titles, the seats hired and fired, leg c's seat and its scratch kind, and the room's token are picked at run time, so no file names them. Leg a's workstreams are read from the store at run time: one on each of two teams that no default project holds (FIX-1720 D1). Every store file is fresh: one for legs a and b across their restarts, one for leg c's three boots, one per control. All are deleted when the run ends.

**Signal:** per step, each compared by id with what the Lab's store holds through its routes, never with Shift Manager's state (FIX-1720 PLAN.md → Checks).

- **a1** CoS's turn holds two `createProject` calls with ok results; the new `projects` rows are exactly the two asked for, owned by the person, the first with the second member and one workstream from each of two teams, each with the person's talk session. The default rows are unchanged.
- **a2** PROJECTS lists both under their titles, the first with exactly its two workstreams.
- **a3** Brief, Workstreams (each entry opens its workstream), Board (its named no-board state) and Stream for each; a token posted in the first project's composer is a room line under the person, a template seat's answer is a later line with an author, and both are drawn. No gap copy on any tab.
- **a4** The second member reads both lines in the Stream; the outsider's PROJECTS lists both projects and the Stream draws the members-only state with no line of the room in the page.
- **a5** a2 to a4 again on a new process over the same store; the rows unchanged.
- **b1** Asked for a coder seat, CoS's `hire` is ok, no `human_approval` is raised, and TEAMS lists the seat with its new roster and inventory rows.
- **b2** Asked to fire it, the turn suspends on one `human_approval` naming `fire`, the seat and its kind; Inbox lists it with the seat on its card; nothing changes. After a restart the seat and the ask are both still there.
- **b3** Approve in Inbox: the seat leaves TEAMS, the roster and the inventory, and is still gone after a restart.
- **b4** Asked in the board's workstream, the EM seat hires nothing.
- **c1** On boot 1 (`extra-kind`), CoS hires a seat on the scratch kind and TEAMS lists it.
- **c2** On boot 2 (as shipped), the boot names the seat; asked which seats won't start, CoS's `brokenSeats` lists it as `kind-gone`, its answer on screen names it, and its roster row is unchanged.
- **c3** Asked to retire it, the turn suspends; Approve in Inbox.
- **c4** Boot 3 names no problem; TEAMS doesn't list the seat; neither store has its row.
- **J4** A docs-only writer adds CoS, the hire capability with `askBefore: ["fire"]`, the projects collection and the project tools to a scratch copy of the pentest Lab; Shift Manager over it boots, PROJECTS lists the project CoS created with a room the person posts in, and TEAMS lists the seat CoS hired. Each step the writer logs as *doc silent* fails.
- **P3.1 to P3.4** every child's check on its green path, with the controls part 1 hasn't already failed (`manifest.mts`).
- **Part 4** the seam rows, each a scripted assertion (`seams.mts`).

**Anti-game:** no assertion on a child's output or on Shift Manager's state. Only rows CoS created in this run are graded; the profile's default projects are left alone and must be unchanged. Every change goes through a CoS turn typed in the Chief of Staff view, a post in a composer, or a click in Inbox: no hire, fire or project block is called by the check. Each CoS turn and the room's answer runs once (FIX-1720 D2); a provider error re-runs that one turn and is reported. The second member's and the outsider's browsers are the same page handed their own user id and verified bearer (the Lab has no sign-in), and the outsider is in the same organization, so only the membership check keeps the room from it.

**Model:** `openai/gpt-5.4-mini` (the DevTeam chief of staff's own) through the default resolver; needs one of `AI_GATEWAY_API_KEY`, `OPENAI_API_KEY` or `OPENROUTER_API_KEY`, or the run is blocked, not failed. J4's writer is a Claude Code agent through the Agent SDK and needs `ANTHROPIC_API_KEY` (or `MY_ANTHROPIC_API_KEY`).

**Run:** `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/shift-manager/one-person-runs-a-labs-projects-and-people/run.mts`. The report is written to the run's scratch directory, and is the closure PR's body. `GOAL_ONLY=legs,deny-fire,no-cos,no-tool,today,j4,p3,p4` runs a subset.

**On demand only:** run at this closure, and at the closure of each later epic that touches the chief of staff. It is not a CI gate and has no schedule: it rests on a real model with no retry (FIX-1720 QR-5).

**Controls:** each runs inside the plain run, on its own fresh store, and must fail its leg at its own step and leave the rest green. The patches (`controls/patches.mts`) are applied to a scratch copy of the Lab beside the original, never committed, and printed in full in the report.

- `deny-fire`: Reject instead of Approve at b3. Must fail **b3** ("seat gone"); a, b4 and c stay green.
- `no-tool`: `createProject` removed from CoS's `tools:`. Must fail **a1** ("two rows"); b and c stay green.
- `no-cos`: CoS's `WORKER.md` removed; the Chief of Staff view draws its no-CoS state, and the person asks the EM seat instead. Runs b1 only. Must fail **b1** ("seat appears").
- today's `main` (`1afe16ffe`, the commit before FIX-1650's first child merged), its own checkout and build: must fail **a1**, **b1** and **c1**, with no chief of staff to ask.
- `extra-kind` is not a control: it is leg c's boot 1.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
