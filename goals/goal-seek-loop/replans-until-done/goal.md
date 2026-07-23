# goal-seek-loop › it replans until done, not until the cap

**Issue:** FIX-910
**Outcome:** A real `goalSeekLoop` with an LLM evaluator judge, run on a task that genuinely needs one replan (research X, then — if the first pass missed a sub-topic — research that too), iterates more than once and terminates because the goal was reached (`reason: "converged"`), not because it ran out of budget (`reason: "max-iterations"`).
**Input:** a goal whose first plan is deliberately incomplete, so a correct evaluator asks to replan once before converging. Held-out: the specific topic can be swapped; the assertion reads the emitted termination reason + drain count, never a hardcoded topic.
**Signal:** the emitted `goal-seek-loop-termination` item reports `reason: "converged"` AND `iterations >= 2`. Also drive the re-expressed `planAndExecute` via `fsdev run` against a real model and confirm a multi-step plan completes and synthesizes.
**Anti-game:** the gameable pass asserts the loop *ran* — that it drained, or hit the cap, or emitted a `TaskInit[]`. Those pass on a loop that never converges and lands on `max-iterations`. The check MUST assert the terminal reason is `converged` (goal reached) with `iterations >= 2` (a real replan happened), so a single-pass or a cap-landing run fails.
**Model:** real — openai/gpt-5.4-mini

**Runner.** Contract only. The `run.mts` is not authored here because this environment has no inference credential (see the `plan-and-execute` goal and README → Credentials); it must be authored against a real `fsdev run` / `pnpm tsx` capture and its verdict recorded below. Read the termination reason from the `goal-seek-loop-termination` component item (`data.reason`, `data.iterations`), not from board-meta.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| _not yet run_ | | | | contract only; no inference credential in this environment |
