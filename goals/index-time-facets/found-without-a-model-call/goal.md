# index-time-facets › it is found without a model call

**Issue:** FIX-1557 (leg (e) of FIX-1553's assembled goal)
**Outcome:** An app classifies each ticket once, when its body is written, with a real evaluation model, and stores the answers on the ticket. Later, a search for "billing tickets" finds the ticket that was classified billing, and that search runs no model and spends no tokens.
**Input:** `fixtures/input.json`, three held-out support tickets (key, title, body). Held-out: any set of tickets must pass a correct implementation; nothing asserts which topic the model picks.
**Signal:** Through `runAction` on the example flow (`examples/guides/index-time-facets`) and one in-memory store: (e0) every `write` turn succeeds and the writes spend tokens on a real evaluation model; (e1) the first ticket has stored facets, and a `search` for the topic read back from them returns that ticket; (e2) the search turn's trace has no `evaluator` or `generator` row and its model usage totals 0 tokens.
**Anti-game:** A hollow pass would be a search that "just checks" with the evaluator: it returns the right ticket, so e1 alone passes it. e2 is the leg that catches it, and the control below proves e2 can fail. The search value is read from the stored facets, never a label the check expects, so the goal doesn't pass only on these tickets.
**Model:** real. `typesafe-ai/jev` via Vercel's AI Gateway when `AI_GATEWAY_API_KEY` is set, otherwise `openai/gpt-5.4-mini`'s evaluation model (`OPENAI_API_KEY`).
**Run:** `pnpm tsx goals/index-time-facets/found-without-a-model-call/run.mts`
**Controls:** `GOAL_CONTROL=classify-at-query` routes the search through the same evaluator (it classifies the query, then filters). Must FAIL, and must name leg **e2**, not e1.

`run.mts` exports `checkFoundWithoutAModelCall()` so the assembled goal runs this leg unchanged.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-09-25 | fix/FIX-1557-facets (pre-commit, on acc01bb) | typesafe-ai/jev (Vercel AI Gateway) | PASS | 3 tickets classified at write, 1476 tokens; held-out-1 stored topic=billing; search topic=billing returned held-out-1 and held-out-3; 1 trace row, no evaluator or generator row, 0 tokens. |
| 2026-09-25 | fix/FIX-1557-facets (pre-commit, on acc01bb) | typesafe-ai/jev (Vercel AI Gateway) | FAIL (expected) | `GOAL_CONTROL=classify-at-query`: `e2: the search turn ran a model: evaluator:ticket-facets` and `e2: the search turn spent 467 tokens`. e1 passed. |
