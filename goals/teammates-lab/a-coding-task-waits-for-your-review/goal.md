# teammates-lab › a coding task waits for your review

**Issue:** FIX-2380

**Outcome:** A coding task in the Teammates lab whose run committed doesn't complete on its own. It waits for your review, and its stop names the branch, the commits and the judge's verdict. **Ask for changes** sends your words to the same coding session for one more run on the same attempt, and that run is reviewed again. **Accept** completes the task, its output saying a person accepted it.

**Input:** `fixtures/input.json`: one coding task (add a line to the README and commit it), filed on the Cursor worker from Chief of Staff's conversation through the board's `createTask`, and the words a revision asks for. **Held out**: nothing in the lab's workers or flows names the task or the revision.

**Signal:** `fsdev dev --app @flow-state-dev/teammates` on a fresh store over a git checkout holding one commit (a README, and a `.gitignore` for `.fsdev/`), driven over HTTP. The run is a real Cursor run; the judge is the real `goalJudge`.

- *review*: the task's row holds a review and isn't completed. The run session's review stop, read with harness-manager's `reviewDetail` as the popup reads it, names a branch, at least one commit and the judge's verdict.
- *revise*: answered through the Inbox client with `{ verdict: "revise", words }`, the row comes back with a new review, still on attempt 1 and in the same run session, over more commits than the first.
- *accept*: answered `{ verdict: "accepted" }`, the row completes with `output.review === "accepted"`.

1 run of 1 (`GOAL_RUNS`, default 1): each run is two real coding runs and two judge reads.

**Anti-game:** Graded on the board's rows and the run session's items, through the public client and the Inbox client a screen answers with. The answers go through the engine's answer route, so a revision the flow didn't take can't pass *revise*.

**Not covered here:** a run's question and its answer box. A real run asks only when it needs to, so that leg is the popup's screen test on the double (`labs/teammates/test/popup-holds.test.tsx`), with the adapter's hold read in `task-holds.test.ts`.

**Model:** real: Cursor `composer-2.5` for the runs (the lab's), `typesafe-ai/jev` for the judge (`goalJudge`'s default).

**Shared:** the lab's boot is `goals/teammates-lab/lab.mts`.

**Run:** `pnpm tsx goals/teammates-lab/a-coding-task-waits-for-your-review/run.mts`. It needs `CURSOR_API_KEY`, `AI_GATEWAY_API_KEY`, and the lab's pages built (`pnpm --filter @flow-state-dev/teammates build`).

**Controls:** on the same command:

- `GOAL_CONTROL=no-review`: the coding flow is built with `reviewChanges: false`, as it was before this change. *review* must FAIL, the task completing on its commit unreviewed.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-11-02 | 8bac6a6c + this change, pre-commit | Cursor composer-2.5, typesafe-ai/jev | PASS (1 of 1) | *review*: 1 commit ("Add welcome line to README."), judge done 0.52. *revise*: a second review in the same run session on attempt 1, 2 commits. *accept*: completed with `review: "accepted"` |
| 2026-11-02 | same | same | control `no-review`: *review* FAIL as required | The task completed on its commit, unreviewed |
