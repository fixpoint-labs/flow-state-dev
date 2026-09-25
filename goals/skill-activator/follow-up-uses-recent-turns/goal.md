# skill-activator › it activates the offered skill on a follow-up that needs the last few turns

**Issue:** FIX-1595
**Outcome:** An app writes `createSkillActivator({ initialSkills, evaluator: skillEvaluator(model, { recentMessages: 3 }) })`. After the assistant offers a skill's work, a follow-up like "yes, go ahead", which names no skill and matches no keyword, activates the skill the offer was about. Small talk after the same offer still activates nothing.
**Input:** `fixtures/input.json`: a three-skill catalog (description, `when_to_use`, keywords), an opening turn, and per case one earlier turn (a user ask and an assistant offer) followed by a follow-up. Two targeted cases, one small-talk case after the same offer as the first. Held-out: no follow-up names a skill or a word of one, trips a keyword, or starts with a slash (the run refuses a fixture that does), so different offers and follow-ups must pass a correct implementation.
**Signal:** For each model, per case, one session through `runAction`: the opening turn and the offer turn are written by running a `chat` action in that session (user message, then the assistant's reply), then the follow-up runs the real activator in the same session. Each targeted follow-up activates exactly the skill its offer was about and the turn has an evaluator trace row (tier 3 ran); the small-talk follow-up activates nothing.
**Anti-game:** A hollow pass would be one that asserts only on what the evaluator was handed (a mock could satisfy that while picks on a real model don't move), one that passes the earlier turns in the action input, or one where a keyword or slash tier matched. The check reads only which skill the turn activated; the follow-up's action input carries the message and nothing else; the fixture guard and the evaluator-row assertion rule out the other tiers.
**Model:** real — `typesafe-ai/jev` via Vercel's AI Gateway through the app's default resolver, and `openai/gpt-5.4-mini` as an OpenAI evaluation model instance via the same gateway (`AI_GATEWAY_API_KEY`), as in the sibling `evaluator-picks-a-skill`.
**Run:** `pnpm tsx goals/skill-activator/follow-up-uses-recent-turns/run.mts`
**Controls:** `GOAL_CONTROL=no-recent` builds `skillEvaluator(model)` with no option. Must FAIL on every targeted follow-up, on both models (each activates nothing); small talk is unaffected.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-09-25 | aac5534 + branch | typesafe-ai/jev, openai/gpt-5.4-mini (AI Gateway) | FAIL (expected) | `GOAL_CONTROL=no-recent`: all four targeted follow-ups activated `[]` (evaluator answered NO_SKILL) on both legs; small talk NO_SKILL on both. |
| 2026-09-25 | aac5534 + branch | typesafe-ai/jev, openai/gpt-5.4-mini (AI Gateway) | PASS | a and b: "Yes please, go ahead." -> trip-planner, "Sure, do that." -> recipe-helper, small talk -> NO_SKILL, nothing activated. Three runs, all PASS. |
