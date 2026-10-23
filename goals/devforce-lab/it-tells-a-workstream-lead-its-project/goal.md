# devforce-lab › it tells a workstream lead its project

**Issue:** FIX-1970

**Outcome:** In the DevTeam lab, a person asks a project's coordinator for a feature, and the
coordinator hands it to the person's workstream in that project, led by the EM. The EM files the
coder's task naming that project, or naming none, because its task tools tell it which project its
conversation works in. Before, nothing told it, and it named a project it guessed (the person's
user id, or the coordinator's name), which the board then threw away.

**Input:** `fixtures/input.json`: the ask, the workstream's id and title, and a second project of
the person's with a repository. **Held-out**: the ask and both ids are read from the fixture, so
another wording or another second project passes a correct implementation.

**Signal:** one turn on the DevTeam lab opened as its profile opens it, driven over its HTTP door
as the lab's owner. The owner has a workstream in Storefront led by `eng.em`, and is on Storefront
and the second project, both with a repository. The ask goes to the owner's Storefront project
coordinator, which hands it on. Read from the workstream session's `tool_output` items:

- `files-for-coder`: the EM made at least one `createTask` call for `eng.coder`.
- `names-no-other-project`: every such call's `input.project` is Storefront, or absent.

**Anti-game:** graded on the arguments the model wrote, not on the stored row, because the board
writes the conversation's project over whatever the model named (FIX-1969): a stored row names
Storefront even when the model guessed. A second project with a repository is on the person's
list, so a wrong guess has somewhere real to land.

**Controls:** `GOAL_CONTROL=list` prints them.

| Control | Perturbs | Goes red on |
|---|---|---|
| `no-project-context` | the EM's model is handed its prompt with the line naming its conversation's project cut out; `control-took` fails when there was no line to cut | `names-no-other-project` |

Said directly to the EM in its workstream session, not handed on by a coordinator, the one
control run tried named no project even without the line, so that path showed no red state and is
not a leg.

**Model:** `openai/gpt-5.4-mini` for every turn, through the AI Gateway. One turn, graded once.
Reports `blocked` when no key serves it. The coder's harness is the lab's stub; what a filed task
does next is not graded.

**Run:** `pnpm tsx goals/devforce-lab/it-tells-a-workstream-lead-its-project/run.mts`. Needs
`git`, a writable temp directory and `AI_GATEWAY_API_KEY`.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-14 | `9ab10298` + this change, uncommitted | `openai/gpt-5.4-mini` | `no-project-context` FAIL (expected) | Control first, 4 of 4 runs red on `names-no-other-project`: the EM named `project-coordinator` three times and `u_devforce_lab` once, the two guesses the FIX-1797 closure runs saw. |
| 2026-10-14 | `9ab10298` + this change, uncommitted | `openai/gpt-5.4-mini` | PASS | 6 of 6 runs: one coder task for `save-for-later-button`, naming Storefront once and no project five times. |
