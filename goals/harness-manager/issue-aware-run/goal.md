# harness-manager › a coding run told its issue works on it, with the spec in its brief

**Issue:** FIX-2388

**Outcome:** You can tell a coding run which tracker issue it is for (`FIX-2165`). Then its branch carries the issue's id, so a tracker links the pull request, and its brief opens with the issue's spec from the repository. Without that, you paste the spec by hand and the branch is named after a task id. Both coding entries take the issue: a harness session (Kitchen Sink) and a board task (Teammates, Shift Manager, the Claude Code-style lab).

**Input:** A scratch git repository holding `specs/issues/FIX-9001/SPEC.md`, with a marker generated on each run. No prompt can hold the marker unless the file was read.

**Signal:**

- **a:** a session created through the HTTP create route with `issue: "FIX-9001"`. Its first turn's prompt holds the marker (`a:spec`). Its second turn's prompt is the person's words alone (`a:once`). Every place handed to the workspace carries the issue (`a:place`).
- **b:** a `harnessManager` run on a board read from the claim, its task naming `harnessFeature: { issue: "FIX-9001" }`. The run's brief holds the marker (`b:spec`), and its recorded branch contains `fix-9001` (`b:branch`).
- **c:** a session and a task that name no issue get prompts with no issue section (`c:session`, `c:board`).

**Anti-game:** Every assertion reads what the stub harness was handed or what the run record stores, never the manager's own state. The marker is fresh on each run. Each list read is floored with `tell.over`, so an empty read is CAN'T TELL.

**Model:** none. The harness is a stub that records prompts.

**Run:** `pnpm --dir goals exec tsx harness-manager/issue-aware-run/run.mts`

**Controls:**

- `GOAL_CONTROL=no-brief`: the hosts leave `issueSpec` off. It must fail **`a:spec`** and **`b:spec`**.
- `GOAL_CONTROL=task-branch`: the task names its issue in plain `input.issue`, the way a lab filed one before `harnessFeature` took an issue alone. It must fail **`b:branch`** (and `b:spec`).

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-31 | (FIX-2388 impl branch) | none | PASS | First prompt 259 chars with the marker. Second turn "Now add a test." 3 places, all with the issue. Branch `…/fix-9001--task_goal--implement`. `no-brief` FAILS a:spec + b:spec. `task-branch` FAILS b:branch + b:spec. |
