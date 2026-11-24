# harness-manager › a coding brief names the checks

**Issue:** FIX-2502 (epic FIX-2490). Spec: `specs/issues/FIX-2502/`, leg b of *How we verify*.

**Outcome:** A coding agent in Kitchen Sink or Shift Manager is told, in the prompt it starts
from, the check the app will run after it, by command, before it runs.

**Input:** each run draws a fresh check, `node check-brief<8>.mjs`, **held out**: the command
exists only in this run's repository and in the app's check settings (Kitchen Sink's
`KITCHEN_SINK_HARNESS_CHECKS`, Shift Manager's project row `checks`).

**Signal:** the first prompt the agent was handed names that command.

- **Kitchen Sink:** one turn through Kitchen Sink's own `kitchenSinkHarnessFlow` (its worktree
  host, its `verify`), with an agent that records its prompt and finishes.
- **Shift Manager:** one feature task filed by the EM on a project with that check, run through
  Shift Manager's own host with harness-manager's `harnessStub` in the harness slot.

Only the check is graded. Shift Manager's filing entry takes no task context, so the spec's
context token has no model-free path in; the worker's instructions reach the prompt on the merge
base already, so they are not what this change adds. The two labs are not covered here: their
prompt can't be seen from outside the running lab on either commit. Their evidence is the
closure's coder ask (`goals/closure-smarter-agents`) and the harness-manager unit tests.

**Anti-game:** the command is drawn per run, so a brief can only name it by reading the app's own
check list. Each probe runs inside the tree it grades, so the control grades the merge base's own
code, not this tree's.

**Model:** none.

**Run:** `pnpm tsx goals/harness-manager/a-coding-brief-names-the-checks/run.mts`
(`GOAL_APPS=kitchen-sink` for one app; `GOAL_COMMIT=<sha>` for another tree, installed under the
system temp folder on first use).

A probe placed in another tree goes in a folder of its own beside the goal's and only that folder
is removed, so a tree that already holds this goal keeps its files (`place-probe.check.mts`).

**Control:** `GOAL_COMMIT=5a9ab85f7` (the merge base). Must FAIL "the prompt lacks the check" in
both apps.

## Verdict log
| Date | Commit | Verdict | Notes |
|------|--------|---------|-------|
| 2026-11-14 | 33b218a92 | PASS | Both apps: the prompt names the drawn check. |
| 2026-11-14 | 5a9ab85f7 (control) | FAIL, as it must | Both apps: each agent was handed one prompt, and it lacks the drawn check. |
