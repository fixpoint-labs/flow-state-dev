# skill-activator › it picks a skill on an evaluation model

**Issue:** FIX-1559
**Outcome:** An app writes `createSkillActivator({ initialSkills, evaluator: skillEvaluator(model) })`, and a message that matches no slash command or keyword still gets the right skill, picked by the evaluation model. It works on Jev, which reports a confidence, and on an OpenAI evaluation model, which doesn't: the pick activates either way, carrying the model's confidence only when it gave one. Small talk activates nothing.
**Input:** `fixtures/input.json`, a three-skill catalog (description, `when_to_use`, keywords), two messages each aimed at one skill, and one small-talk message. Held-out: none of the messages contains a keyword or a slash (the run refuses a fixture that does), so a different catalog and messages must pass a correct implementation.
**Signal:** For each model, through `runAction` on the real activator: each targeted message activates exactly its skill, and the turn has an evaluator trace row (tier 3 ran); small talk activates nothing. Leg (a), `typesafe-ai/jev` through the app's default resolver: the match carries a numeric `confidence` in [0, 1]. Leg (b), `openai.evaluationModel("openai/gpt-5.4-mini")` on the gateway's OpenAI-compatible endpoint: the match has **no** `confidence` key.
**Anti-game:** A hollow pass would be an activator that invents a confidence for adapters (leg b's absent-key assertion catches it), one that fails closed on absent confidence (the control catches it), or a check that passes because a keyword tier matched (the fixture guard and the evaluator-row assertion rule that out). The check asserts the activated skill is a catalog name and the targeted one for the two targeted messages only; it never asserts a confidence value.
**Model:** real — `typesafe-ai/jev` via Vercel's AI Gateway, and `openai/gpt-5.4-mini` as an OpenAI evaluation model via the same gateway (`AI_GATEWAY_API_KEY`). The gateway's own evaluation ids cover Jev only, so leg (b) passes the activator an evaluation model instance.
**Run:** `pnpm tsx goals/skill-activator/evaluator-picks-a-skill/run.mts`
**Controls:** `GOAL_CONTROL=fail-closed` wraps both evaluation models so a pick that carries no confidence reads as "no skill": the fail-closed reading of absent confidence. Must FAIL, on leg **b**'s targeted messages only.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-09-25 | 7bb76a6 + branch | typesafe-ai/jev, openai/gpt-5.4-mini (AI Gateway) | PASS | a: trip-planner (confidence 1), recipe-helper (confidence 1), small talk answered NO_SKILL, nothing activated; b: trip-planner and recipe-helper with no confidence key, small talk NO_SKILL. Three runs PASS; four other runs hit Jev's upstream "Service temporarily unavailable" on one call each (the activator failed with that error, as specified). |
| 2026-09-25 | 7bb76a6 + branch | typesafe-ai/jev, openai/gpt-5.4-mini (AI Gateway) | FAIL (expected) | `GOAL_CONTROL=fail-closed`: both leg-b targeted messages activated `[]` (evaluator answered NO_SKILL); leg a unaffected. |
