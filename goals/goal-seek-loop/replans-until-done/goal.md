# goal-seek-loop › it replans until done, not until the cap

**Issue:** FIX-910
**Outcome:** A real `goalSeekLoop` with an LLM evaluator judge, run on a task that genuinely needs one replan (research X, then — if the first pass missed a sub-topic — research that too), iterates more than once and terminates because the goal was reached (`reason: "converged"`), not because it ran out of budget (`reason: "max-iterations"`).
**Input:** a goal whose first plan is deliberately incomplete, so a correct evaluator asks to replan once before converging. Held-out: the specific topic can be swapped; the assertion reads the emitted termination reason + drain count, never a hardcoded topic.
**Signal:** the emitted `goal-seek-loop-termination` item reports `reason: "converged"` AND `iterations >= 2`. Also drive the re-expressed `planAndExecute` via `fsdev run` against a real model and confirm a multi-step plan completes and synthesizes.
**Anti-game:** the gameable pass asserts the loop *ran* — that it drained, or hit the cap, or emitted a `TaskInit[]`. Those pass on a loop that never converges and lands on `max-iterations`. The check MUST assert the terminal reason is `converged` (goal reached) with `iterations >= 2` (a real replan happened), so a single-pass or a cap-landing run fails.
**Model:** real — openai/gpt-5.4-mini

**Run:** `pnpm tsx goals/goal-seek-loop/replans-until-done/run.mts`

**Runner.** Two arms. (1) The primitive: a real `taskBoard` whose seed creates a task for only ONE of the fixture goal's two required aspects, so a correct LLM judge must replan once before converging. `maxIterations` is 4 — well above the 2 a correct run needs — so landing on the cap means genuine non-convergence, not budget starvation. The termination reason is read from the `goal-seek-loop-termination` component item (`data.reason`, `data.iterations`), never board-meta. (2) The re-expressed `planAndExecute` driven via `fsdev run` against the app's own ladder, asserting the run completes, goes through the task-board substrate, and synthesizes.

A third assertion beyond the stated Signal closes a gap in it: **the board must end with more tasks than the seed created**. `iterations >= 2` alone is also satisfied by a `continue` verdict re-draining a settled board with no new work — which is not a replan, and this goal is titled "replans until done".

Judge wiring, for whoever edits this next: a block / sub-sequencer judge is handed the RAW DRAIN RESULT and must read the board from `ctx` via `cap.tasks()`; only an inline-fn judge receives `{ collection, drainResult }`. Getting that wrong surfaces only as an opaque `judge-error` under the default `onError: "skip"` — set `onError: "fail"` temporarily to see the real message.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| _not yet run_ | | | | contract only; no inference credential in this environment |
| 2026-07-25 | ce749d0 | openai/gpt-5.4-mini | PASS | Runner authored. Primitive arm: `reason: "converged"`, `iterations: 2`, board grew 1→2 tasks (the judge's replan added real work for the missing aspect). Cap was 4, so termination was goal-reached, not budget. planAndExecute arm: completed with 3 task-board items and a 3,283-char synthesized answer on the app ladder. |
| 2026-07-25 | ce749d0 | openai/gpt-5.4-mini | PASS | Second consecutive run — identical primitive result (converged / 2 / 2 tasks) on the first attempt; planAndExecute arm 3 task-board items, 4,077-char answer. |
