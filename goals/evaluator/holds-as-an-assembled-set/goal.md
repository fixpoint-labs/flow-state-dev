# evaluator › it holds as an assembled set

**Issue:** FIX-1556 (epic FIX-1553; leg e: FIX-1557; leg f: FIX-1555)
**Outcome:** The evaluator epic's pieces work together in the app a reader copies, not only one at a time. The Routing with evaluators example asks Jev typed questions, refuses a model that can only generate, routes a ticket through a two-level tree on Jev and hands every ticket to review on a model that reports no confidence, and lets the skill activator pick a skill with an evaluator, while an activator built without one never builds or resolves one. Index-time facets (e) and memory (f) join when their issues wire them.
**Input:** `fixtures/input.json`: held-out tickets (one to classify, one urgent billing, one off-topic, two for the no-confidence model), a message that matches a skill only by its description, a slash command, and small talk. The skill catalog is the example's own. Nothing asserts on a score or a probability value.
**Signal:** every failure line starts with its leg letter. This issue's bar is no `[a]` to `[d]` line; the run stays FAIL until (e) and (f) are wired.
(a) `fsdev run … classify` on Jev: `team` is one of the question's options; `team` and `frustration` carry a confidence in [0, 1]; `urgent` has a probability and **no** `confidence` key; the trace row shows `typesafe-ai/jev` answered.
(b) The example's `classifyTicket(openai("gpt-5.4-mini"))` throws `Evaluator "classify-ticket": the model can generate but not evaluate.` naming `evaluationModel(...)`, with zero requests sent.
(c) `route` on Jev: the urgent billing ticket returns `{ queue: "billing-urgent" }` through edges `billing` then `urgent`, each on Jev's confidence; the off-topic ticket returns `{ queue: "review" }` with a `below-floor` or `no-branch` verdict. `routeWithoutConfidence` on OpenAI's evaluation model: every ticket returns `{ queue: "review" }`, with one verdict, `no-confidence` at the root, and the answer carries no `confidence` key.
(d) `activate` on Jev: the description message activates the expected skill with source `classifier` and an evaluator row; the slash command activates its skill with source `slash` and no evaluator row; small talk activates nothing after the evaluator answered. Without an evaluator, the example's own `test/activate-without-evaluator.test.ts` passes: spies on `skillEvaluator`, core's `evaluator` and `resolveEvaluationModel` record zero calls.
(e) Placeholder: `not yet wired — owned by FIX-1557`.
(f) Placeholder: `not yet wired — owned by FIX-1555`.
**Anti-game:** a hollow pass would count a leg green because it was skipped, read a verdict from the router's internals instead of what the action returned, or retry a wrong answer until the model gives a right one. So a missing or rejected credential is a `blocked` failure line, never a skip; every routing assertion reads the action's output first and the gate verdict second; and only a provider-unavailable error is retried, each retry printed and counted in the evidence. Leg (c)'s no-confidence half asserts the confidence is **absent**, and the control below proves it can fail. An unwired leg is a failure line, so the goal cannot pass on four legs of six.
**Model:** real. `typesafe-ai/jev` through Vercel's AI Gateway (`AI_GATEWAY_API_KEY`). OpenAI's evaluation model `gpt-5.4-mini` for `routeWithoutConfidence`: directly with `OPENAI_API_KEY`, otherwise through the gateway's OpenAI-compatible endpoint (the gateway serves no `openai/...` evaluation model strings). Leg (b) uses a real text model instance that is never called.
**Run:** `pnpm tsx goals/evaluator/holds-as-an-assembled-set/run.mts`
**Controls:** `GOAL_CONTROL=fake-confidence` runs `routeWithoutConfidence` through `control.fsdev.config.ts`, which injects a confidence of 1 into every answer the no-confidence model returns. Must FAIL leg (c), and no other leg beyond the (e) and (f) placeholders.
**Wiring a leg:** replace its one placeholder line in `run.mts` with the leg's assertions, each pushed with `fail("<letter>", …)`. Nothing else in the file has to change.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
