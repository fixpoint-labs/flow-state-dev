# evaluator › it answers on a real evaluation model

**Issue:** FIX-1554
**Outcome:** An author writes `evaluator({ model: "typesafe-ai/jev", questions })` and gets typed answers from Jev through the app's own gateway: a choice among the options they declared, a score on their scale, and P(true) for a yes/no question. Jev's confidence arrives on the choice and the score, and nothing invents one for the boolean. Passing a model that can only generate text, like `openai("gpt-5.4-mini")`, is refused before anything is sent.
**Input:** `fixtures/input.json`, a held-out support ticket plus the three questions (options, levels, and the yes/no instructions). Held-out: any ticket and any valid question set must pass a correct implementation; nothing asserts on which option or score the model picks.
**Signal:** Leg (a), through `runAction` on the default model resolver: (a0) the run succeeds; (a1) `answers.team.choice` is one of the fixture's option keys; (a2) `team` and `frustration` each carry a numeric `confidence` in [0, 1] and the score is within the scale; (a3) `urgent` has `probability` in [0, 1] and **no** `confidence` key; (a4) the `block_trace` row has `blockKind: "evaluator"`, the requested model string, and the model that answered. Leg (b): (b1) building the evaluator with `openai("gpt-5.4-mini")` throws naming `evaluationModel(...)`; (b2) zero requests leave the process.
**Anti-game:** A hollow pass would be an evaluator that fills in a confidence it was never given (every consumer's gate would then open on a number nobody reported), or a check that asserts a specific option and so only passes on this ticket. The check asserts shape and presence only, and asserts the boolean's confidence is **absent**. The control below proves that assertion can fail.
**Model:** real — `typesafe-ai/jev` via Vercel's AI Gateway (`AI_GATEWAY_API_KEY`). Leg (b) uses a real text model instance, `openai("gpt-5.4-mini")`, which is never called.
**Run:** `pnpm tsx goals/evaluator/answers-on-a-real-evaluation-model/run.mts`
**Controls:** `GOAL_CONTROL=synthetic-confidence` wraps the resolved evaluation model so every answer gets a confidence (the model's, or `0` where it reported none): the seam behaviour this goal exists to catch. Must FAIL, and must name leg **a3** (the boolean carries a confidence), not a0.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-09-24 | 211679a | typesafe-ai/jev (Vercel AI Gateway) | PASS | team=billing (confidence 1), frustration=0.98 (confidence 0.95), urgent P(true)=0.84, no confidence key; trace row kind evaluator, answered by typesafe-ai/jev, 509 tokens; openai("gpt-5.4-mini") refused at build, 0 requests. |
| 2026-09-24 | 211679a | typesafe-ai/jev (Vercel AI Gateway) | FAIL (expected) | `GOAL_CONTROL=synthetic-confidence`: `a3: urgent carries a confidence Jev does not report for booleans: {"type":"boolean","probability":0.85,"confidence":0}`. Only a3 failed. |
