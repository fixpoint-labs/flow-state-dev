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
can name it. The channel and its members are read off the tree, never spelled in the check.

**Signal:** six legs, read through the routes Shift Manager reads. The seat inventory comes through
the channel's session, the stored roster through the chief of staff's, and whether a seat answers
comes from opening a session on its address.

1. **boot**: the chief of staff is listed from the tree, on the `agent` kind, with a door. No
   other declared seat names `hire`, `fire` or `rehire`.
2. **discover**: asked who is on the feature channel, it names the declared members.
3. **hire**: asked for a coder under the held-out id, it hires one at once. No approval is raised.
   The seat is listed, its roster row is written, and its address answers.
4. **restart**: after a restart the hired seat is still listed, still rostered, and still answers.
5. **ask**: asked to fire it, the turn suspends on one `human_approval` naming the verb, the seat
   and its kind. Nothing has changed yet.
6. **seat gone**: the approval goes through the engine's resume route, as Inbox sends it. After a
   second restart the seat has no inventory row and no roster row, and its address no longer
   answers.

**Anti-game:** no hire or fire block is called by the check. Every change goes through the chief
of staff's own turn on a real model, and every restart is a new process over the same file. The
grade is read off the stores through the HTTP routes, never off the model's words.

**Control** (`GOAL_CONTROL=list` prints it). It must go red:

| Control | Perturbs | Goes red on |
|---|---|---|
| `deny-fire` | the person's answer: Deny instead of Approve | **seat gone**: the seat is still listed, rostered and answering |

The tree with no chief of staff (today's `main`) goes red at **boot**: `Unknown flow
"chief-of-staff"`.

**Model:** `openai/gpt-5.4-mini` for the chief of staff, through the default resolver. Needs one of
`AI_GATEWAY_API_KEY`, `OPENAI_API_KEY` or `OPENROUTER_API_KEY`. With none set, the check fails
with a precondition message and grades nothing.

**Run:** `pnpm tsx goals/org-seats/cos-changes-the-roster/run.mts`

**Control:** `GOAL_CONTROL=deny-fire pnpm tsx goals/org-seats/cos-changes-the-roster/run.mts`

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-02 | a65594ee1+wip (FIX-1719 PR 2) | openai/gpt-5.4-mini | PASS | All six legs green. `deny-fire` FAILS at seat gone (listed, rostered, answering). With `org/` removed from the tree it FAILS at boot (`Unknown flow "chief-of-staff"`). The fire only suspended once core's lazily loaded models carried `generateStep`/`streamStep`; before that, the ask came back to the model as a failed tool call and the turn completed with no approval raised. |
| 2026-10-02 | 3307072fd (FIX-1719 PR 2, Codex round 2 + #2649 round 5) | openai/gpt-5.4-mini | PASS | All six legs green; the ask now carries `owner: null` and the row's incarnation. `deny-fire` FAILS at seat gone (listed, rostered, answering). One earlier `deny-fire` run stopped at discover instead, the model answering without naming the members; the rerun reached seat gone. |
