# memory-evaluator-seam › it captures without an evaluator

**Issue:** FIX-1555 (the evaluator epic FIX-1553's leg (f); FIX-1556 assembles it)
**Outcome:** An app that uses memory and never installs an evaluator keeps capturing as it always has: a turn that states a durable fact lands in working memory, and nothing about evaluators appears in its trace. Memory needs no evaluation model and no provider package to work.
**Input:** `fixtures/input.json`, one held-out user turn stating durable facts about the user. Held-out: any turn that states a durable fact must pass a correct implementation; nothing asserts on what was extracted.
**Signal:** One request through `runAction` with capture as a side chain, on the app's default model resolver: (f1) the capture succeeds; (f2) at least one working-memory entry is added; (f3) the observer ran and no row of kind `evaluator` is in the trace.
**Anti-game:** A hollow pass would assert on the entry's wording (passes only on this turn and this model) or skip reading the capture's outcome. The check asserts that an entry exists, never what it says, and reads the capture's own trace row for its error. The control proves the check reads the capture's outcome.
**Model:** real — `openai/gpt-5.4-mini` (the observer), via the default resolver (Vercel's AI Gateway when `AI_GATEWAY_API_KEY` is set).
**Run:** `pnpm tsx goals/memory-evaluator-seam/captures-without-an-evaluator/run.mts`
**Controls:** `GOAL_CONTROL=throwing-evaluator` builds the same capture with an evaluator whose model throws. Must FAIL, naming **f1** (the capture failed) and **f2** (nothing added).

The check is `checkCapturesWithoutAnEvaluator({ turn, model, control? })` in `check.mts`, so the epic's assembled goal can run it as leg (f) without copying it.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-09-25 | e621f2a (+ FIX-1555 working tree) | openai/gpt-5.4-mini (Vercel AI Gateway) | PASS | Capture traced `memory/capture, memory/observe, memory/reflect, memory/tick, memory/janitor`; no evaluator row; 3 working-memory entries and 3 episodes added. |
| 2026-09-25 | e621f2a (+ FIX-1555 working tree) | openai/gpt-5.4-mini (Vercel AI Gateway) | FAIL (expected) | `GOAL_CONTROL=throwing-evaluator`: `f1: the capture failed: GOAL_CONTROL=throwing-evaluator: the evaluation model failed`, `f2: no working-memory entry was added`, and f3 (observer did not run; an evaluator row traced). |
| 2026-09-25 | 0aa7669 | openai/gpt-5.4-mini (Vercel AI Gateway) | PASS | After rebasing on main. Capture traced `memory/capture, memory/observe, memory/reflect, memory/tick, memory/janitor`; no evaluator row; 2 working-memory entries and 2 episodes added. |
| 2026-09-25 | 0aa7669 | openai/gpt-5.4-mini (Vercel AI Gateway) | FAIL (expected) | `GOAL_CONTROL=throwing-evaluator`: f1 (capture failed with the control's error), f2 (nothing added), f3. |
