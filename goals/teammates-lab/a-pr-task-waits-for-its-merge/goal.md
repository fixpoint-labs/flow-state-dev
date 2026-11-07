# teammates-lab › a PR task waits for its merge

**Issue:** FIX-2578 (epic FIX-2369), PR 2 (the apps)

**Outcome:** In the Teammates lab, a coding task you accept with **Open a PR** does not complete
when the pull request opens. It stays open, waiting on that pull request. A steer from its popup's
box is one more run on the same attempt and coding session; that run's commit comes back for your
review, and Open a PR again pushes it to the same pull request, so the task waits on it again. Once
GitHub says the pull request merged, a steer completes the task with the pull request on its output
and runs nothing.

**Input:** `fixtures/input.json`: the filing worker and the coder, one task's title and goal, and the
two steers. **Held-out**: no worker file, flow or page names any of it. The task is filed on the
filing conversation's board through its own `createTask`.

**Signal:** `fsdev dev --app @flow-state-dev/teammates` on a fresh store, every coding run on
harness-manager's scripted coder (`GOAL_HARNESS=stub`), no model credential (the judge gives no
verdict and never fails a run), and `goals/lib/github-stub`: the working folder's `origin` is
`git@github.com:acme/app.git`, a stub `ssh` first on the server's `PATH` takes the landing's push
to a local bare repository, and a stub `gh` answers `pr list`, `pr create`, the branch listing and
`repos/acme/app/pulls/N` from a state file. Setup refuses to go on unless the review offers Open a
PR (the GitHub-shaped origin was pinned).

- **a:pushed** pull request 7 exists in the stub, opened from a branch the bare repository holds.
  **a:open** after Accept with Open a PR (`{ verdict: "accepted", land: "pull-request" }`, as the
  popup answers it, through the Inbox client) the row is `in_progress` with an open `external` hold
  whose releaser names `…/7`.
- **b:steer** a steer through the Inbox client's board `steer` (what the popup's Steer box calls)
  brings the row back to a review; **b:one-run** exactly one harness run (the scripted coder's first
  step, counted in the run session's items); **b:same-attempt**, **b:same-session**.
  **b:waits-again** Open a PR again: `in_progress`, a new external hold on `…/7`; **b:one-pr** the
  stub still holds one pull request.
- **c:completed** stub set to merged, a steer: `completed`, its output's `pullRequests` names PR 7
  merged at the stub's link; **c:no-run** no harness run after it.

**Anti-game:** graded on the board's rows (`listTasks`, `getTask`), the run session's items, the
stub's state and call logs, and the bare repository's branches; never on what the manager returned.
Runs are counted from what the scripted coder narrates in the session. The steers go through the
board, as the page sends them, so a board steer that left the wait open fails b:steer.

**Model:** n/a. The server gets no model credential.

**Run:** `pnpm tsx goals/teammates-lab/a-pr-task-waits-for-its-merge/run.mts`

**Controls:** `GOAL_CONTROL=no-wait`: the coder flow built with `awaitPullRequests: false` (a
scratch patch applied as the server loads, `goals/lib/module-patch`). Must FAIL a:open (the accept
completes the task); b and c are then not reached.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-11-07 | on 870b759f, this change pre-commit | n/a | PASS | a: Open a PR pushed the run's branch and opened #7; in_progress on attempt 1, one external hold. b: 1 run, attempt 1, same run session, back to review; Open a PR again: waiting on #7, still 1 PR. c: completed, output PR 7 merged, no run. 9 gh calls, 5 ssh calls |
| 2026-11-07 | same | n/a | FAIL (expected, `no-wait`) | a:open: after Open a PR the row reads completed, no external hold; b and c not reached |
