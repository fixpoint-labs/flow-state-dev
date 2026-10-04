# org-seats › the chief of staff changes the roster

**Issue:** FIX-1719

**Outcome:** A Lab that declares a chief of staff gets it as a running seat, and a person changes
who works there by asking it. A hire lands at once. A fire lands only after the person approves it.
Both hold across restarts.

Before this, a Lab's seats were whatever its files declared. Adding or removing one meant editing
a folder and restarting the server. No seat could do it, and no person could ask for it.

**Input:** the DevTeam profile (`labs/shift-manager/teams/devteam`), whose tree
(`goals/devforce-lab/lab/workforce`) declares `org/workers/chief-of-staff`. The check serves it
three times through Shift Manager's own start script, over one SQLite file it owns. The seat it
asks for is **held out**: `coder-<random hex>`, picked at run time, so no file in the repository
can name it. The mailbox and its members are read off the tree, never spelled in the check.

**Signal:** nine legs, read through the routes Shift Manager reads. The seat inventory comes through
the mailbox's session, the stored roster through the chief of staff's, and whether a seat answers
comes from opening a session on its address.

1. **boot**: the chief of staff is listed from the tree, on the `agent` kind, with a door. No
   other declared seat names `hire`, `fire` or `rehire`.
2. **discover**: asked who is on the feature mailbox, it names every declared member by its full
   seat id (`eng.em`, not `em`), and the line naming each one also names the kind its file
   declares (`em`, `coder`, `agent`), both matched exactly.
3. **hire**: asked for a coder under the held-out id, it hires one at once. No approval is raised.
   The seat is listed, its roster row is written, and its address answers.
4. **discover hired** (BR-23): in a fresh session, asked which seats the organization has hired
   (the question names neither the seat nor a kind), the line of the answer naming the held-out
   seat by its full id also names its kind, `coder`, both matched exactly.
5. **restart**: after a restart the hired seat is still listed, still rostered, and still answers.
6. **ask**: asked to fire it, the turn suspends on one `human_approval` naming the verb, the seat
   and its kind. Nothing has changed yet.
7. **answer**: the approval goes through the engine's resume route, as Inbox sends it. The route
   takes it and the turn completes.
8. **seat gone**: after a second restart the seat has no inventory row and no roster row, and its
   address no longer answers.
9. **a seat asks** (BR-21): a declared seat, not the person, asks the chief of staff for a hire,
   and the hire lands. DevTeam has no seat that messages another (its EM files rows, its coder and
   reviewer run a harness), so this leg runs its own small host in process (`seat-asks.mts`): a
   chief of staff holding `hire` on a real model, and an `ops.lead` seat whose one job posts its
   own file's request into `ops.room` as itself. The held-out seat id lives only in that file; the
   check starts the seat with an empty input. Nothing new carries the request: the post goes
   through the mailbox's own `post` with the seat's `seatId` as author, and the mailbox's notify
   hands it to the chief of staff's `onMailboxPost`, where the agent kind hears a post. Graded on
   what the mailbox handed the chief of staff (exactly one delivery, author `ops.lead`) and on all
   three of a hire's outcomes for the held-out id: its roster row and its inventory row, both on
   kind `agent`, and its address answering a session opened through the session route.

**Anti-game:** no hire or fire block is called by the check. Every change goes through the chief
of staff's own turn on a real model, and every restart is a new process over the same file. The
grade is read off the stores through the HTTP routes, never off the model's words.

**Control** (`GOAL_CONTROL=list` prints it). It must go red:

| Control | Perturbs | Goes red on |
|---|---|---|
| `deny-fire` | the person's answer: Deny instead of Approve | **seat gone** only: the seat is still listed, rostered and answering. **answer** stays green, since the route takes a Deny and the turn completes |
| `hide-hired-from-discover` | the hired seat's roster row, which discover reads a hire from, is moved aside for the discover-hired turn and put back after | **discover hired** only: the answer lists the declared seats and not the hire; every later leg stays green |
| `no-seat-delivery` | the mailbox's notify hands the seat's post to nobody | **a seat asks** only: no delivery to the chief of staff, and no roster row, no inventory row and no address for the held-out id |

The tree with no chief of staff (today's `main`) goes red at **boot**: `Unknown flow
"chief-of-staff"`.

**Model:** `openai/gpt-5.4-mini` for the chief of staff, through the default resolver. Needs one of
`AI_GATEWAY_API_KEY`, `OPENAI_API_KEY` or `OPENROUTER_API_KEY`. With none set, the check fails
with a precondition message and grades nothing.

**Run:** `pnpm tsx goals/org-seats/cos-changes-the-roster/run.mts`

**Controls:** `GOAL_CONTROL=deny-fire pnpm tsx goals/org-seats/cos-changes-the-roster/run.mts`,
`GOAL_CONTROL=no-seat-delivery pnpm tsx goals/org-seats/cos-changes-the-roster/run.mts`,
`GOAL_CONTROL=hide-hired-from-discover pnpm tsx goals/org-seats/cos-changes-the-roster/run.mts`

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-02 | a65594ee1+wip (FIX-1719 PR 2) | openai/gpt-5.4-mini | PASS | All six legs green. `deny-fire` FAILS at seat gone (listed, rostered, answering). With `org/` removed from the tree it FAILS at boot (`Unknown flow "chief-of-staff"`). The fire only suspended once core's lazily loaded models carried `generateStep`/`streamStep`; before that, the ask came back to the model as a failed tool call and the turn completed with no approval raised. |
| 2026-10-02 | 3307072fd (FIX-1719 PR 2, Codex round 2 + #2649 round 5) | openai/gpt-5.4-mini | PASS | All six legs green; the ask now carries `owner: null` and the row's incarnation. `deny-fire` FAILS at seat gone (listed, rostered, answering). One earlier `deny-fire` run stopped at discover instead, the model answering without naming the members; the rerun reached seat gone. |
| 2026-10-02 | 145c1eac7 (FIX-1719 PR 2, Codex round 4 + #2649 93da431f5 + #2645 c1ee781d0) | openai/gpt-5.4-mini | PASS | All six legs green; discover now names `chief-of-staff` among eng.feature's members. `deny-fire` FAILS at seat gone (listed, rostered, answering). One earlier run stopped at discover, the model answering without calling `discover`; the rerun passed. |
| 2026-10-02 | 29c794d58+round 5 (FIX-1719 PR 2, Codex review 5394601632) | openai/gpt-5.4-mini | PASS | All six legs green with the stricter checks: the hired row is kind `coder` in the roster and the inventory, before and after the restart, and the fire raised exactly one `human_approval` naming verb, seat, kind and message. `deny-fire` FAILS at seat gone (listed, rostered, answering). |
| 2026-10-02 | a27de5337+round 6 (FIX-1719 PR 2, Codex reviews 5394840713 + 5394907534) | openai/gpt-5.4-mini | PASS | All seven legs green; the resume and the turn settling are now their own **answer** leg. `deny-fire` FAILS at seat gone only (listed, rostered, answering); answer stays green. |
| 2026-10-02 | fb1b751cd+BR-21 (FIX-1719 PR 2, Codex 5395145040) | openai/gpt-5.4-mini | PASS | All eight legs green, including **a seat asks**: `ops.lead` posted its own request as itself, the mailbox handed the chief of staff one post from `ops.lead`, and the held-out seat has a roster row on kind `agent`. `deny-fire` FAILS at seat gone only. `no-seat-delivery` FAILS at a seat asks only (no delivery, no row); every DevTeam leg stays green. |
| 2026-10-02 | 79440ac14+round 10 (FIX-1719 PR 2, Codex round 10) | openai/gpt-5.4-mini | PASS | All eight legs green with the stricter checks: **a seat asks** now needs the roster row, the inventory row (both kind `agent`) and the address answering 201 on the session route; **discover** needs every member's full seat id. `deny-fire` FAILS at seat gone only. `no-seat-delivery` FAILS at a seat asks only (no delivery, no roster row, no inventory row). |
| 2026-10-02 | 5f89fc3c9+round 11 (FIX-1719 PR 2, Codex round 11) | openai/gpt-5.4-mini | PASS | All nine legs green, including **discover hired**: a fresh session's answer named the held-out seat by its full id with kind `coder`. `hide-hired-from-discover` FAILS at discover hired only (the answer listed the declared seats and not the hire; restart, ask, answer and seat gone stay green). `deny-fire` FAILS at seat gone only. `no-seat-delivery` FAILS at a seat asks only. One earlier control run also stopped at **discover**, the model answering without the members; the rerun did not. |
| 2026-10-02 | b97efb4c6+round 12 (FIX-1719 PR 2, local, not pushed) | openai/gpt-5.4-mini | PASS | **discover** now also needs each member's declared kind on its line. With the first wording ("list each seat's id and the worker kind") one run FAILED at discover, the model declining to give kinds from the mailbox lookup; the question now says to look up each seat. On that wording, 4 of 5 runs PASS all nine legs; one FAILED at **hire**, the model refusing to hire without a `document` setting it had read on `eng.coder`. Controls on the final code: `hide-hired-from-discover` FAILS at discover hired only, `deny-fire` at seat gone only, `no-seat-delivery` at a seat asks only. |
| 2026-10-02 | 484158ba2+P1s (FIX-1719 PR 2, local, merged with main fe3d41fe1, not pushed) | openai/gpt-5.4-mini | PASS | All nine legs green on the tree merged with main (#2645, #2649, #2647). `deny-fire` FAILS at seat gone only, `no-seat-delivery` at a seat asks only, `hide-hired-from-discover` at discover hired only. |
