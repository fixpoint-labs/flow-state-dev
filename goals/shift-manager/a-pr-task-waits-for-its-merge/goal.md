# shift-manager › a PR task waits for its merge

**Issue:** FIX-2578 (epic FIX-2369), PR 2 (the apps)

**Outcome:** In Shift Manager's DevTeam Lab, a coding task you accept with **Open a PR** does not
complete when the pull request opens. It stays open, waiting on that pull request. A line in the
task's session (what its composer sends) is one more run on the same attempt and coding session;
that run's commit comes back for your review, and Open a PR again pushes it to the same pull
request, so the task waits on it again. Once GitHub says the pull request merged, a line completes
the task with the pull request on its output and runs nothing.

**Input:** `fixtures/input.json`: the task's goal and the two lines. **Held-out**: no worker file,
flow or page names any of it. The Shift Coordinator files the task for `eng.coder` on Storefront
(its scripted model's one tool call).

**Signal:** in process, the DevTeam Lab (`openLab`) with `reviewChanges`, on SQLite, served over
HTTP so Shift Manager's own reads (`createLabReader`) and send (`sendTurn`) reach it. The coder
runs on harness-manager's scripted harness; Jev, the judge, is scripted to *done*. Storefront names
`git@github.com:acme/app.git`, which the workspace maps to a local checkout (`checkouts`) whose
`origin` is that remote. `goals/lib/github-stub` is first on `PATH`: a stub `ssh` takes the
landing's push to a local bare repository, a stub `gh` answers `pr list`, `pr create`, the branch
listing and `repos/acme/app/pulls/N` from a state file.

- **a:pushed** pull request 7 exists in the stub, opened from a branch the bare repository holds.
  **a:open** after Accept with Open a PR (`{ verdict: "accepted", land: "pull-request" }` on the
  task's Inbox item, as the card answers it) the row is `in_progress` with an open `external` hold
  whose releaser names `…/7`.
- **b:line** a line through `sendTurn` to the run session's door brings the row back to a review;
  **b:one-run** exactly one harness run (the scripted harness's own log); **b:same-attempt**,
  **b:same-session**. **b:waits-again** Open a PR again: `in_progress`, a new external hold on
  `…/7`; **b:one-pr** the stub still holds one pull request.
- **c:completed** stub set to merged, a line: `completed`, its output's `pullRequests` names PR 7
  merged at the stub's link; **c:no-run** no harness run after it.

**Anti-game:** graded on the board's rows (`getTask`), the harness's run log, the stub's state and
call logs, and the bare repository's branches; never on what the manager or the door returned.

**Model:** n/a. Scripted models; no credential is read.

**Run:** `pnpm tsx goals/shift-manager/a-pr-task-waits-for-its-merge/run.mts`

**Controls:** `GOAL_CONTROL=no-wait`: the coder's managers built with `awaitPullRequests: false`
(a scratch patch, applied in a child that loads it). Must FAIL a:open (the accept completes the
task); b and c are then not reached. The parent exits 0 when the child failed on a:open.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-11-07 | on 870b759f, this change pre-commit | n/a | PASS | a: Open a PR pushed the run's branch and opened #7; in_progress on attempt 1, one external hold. b: 1 run, attempt 1, same run session, back to review; Open a PR again: waiting on #7, still 1 PR. c: completed, output PR 7 merged, no run. 9 gh calls, 5 ssh calls |
| 2026-11-07 | same | n/a | FAIL (expected, `no-wait`) | a:open: after Open a PR the row reads completed, no external hold; b and c not reached |
