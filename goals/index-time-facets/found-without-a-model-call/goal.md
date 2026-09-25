# index-time-facets › it is found without a model call

**Issue:** FIX-1557 (leg (e) of FIX-1553's assembled goal)
**Outcome:** An app classifies each ticket once, when its body is written, with a real evaluation model, and stores the answers on the ticket. Later, a search for "billing tickets" finds the ticket that was classified billing, and that search runs no model and spends no tokens.
**Input:** `fixtures/input.json`, three held-out support tickets (key, title, body). Held-out: any set of tickets must pass a correct implementation; nothing asserts which topic the model picks.
**Signal:** Through `runAction` on the example flow (`examples/guides/index-time-facets`) and one in-memory store: (e0) every `write` turn succeeds, the writes spend tokens on a real evaluation model, and **every** written ticket has stored facets (a ticket without them fails e0 and names the evaluator's error, so a provider outage reads as one); (e1) a `search` for the first ticket's topic, read back from its stored facets, returns that ticket; (e2) the search turn's trace has no `evaluator` or `generator` row and its model usage totals 0 tokens.
**Anti-game:** One hollow pass would be reporting PASS when only the searched ticket was classified; e0 checks every written ticket, not just the first. Another would be a search that "just checks" with the evaluator: it returns the right ticket, so e1 alone passes it. e2 is the leg that catches it, and the control below proves e2 can fail. The search value is read from the stored facets, never a label the check expects, so the goal doesn't pass only on these tickets.
**Model:** real. `typesafe-ai/jev` via Vercel's AI Gateway when `AI_GATEWAY_API_KEY` is set, otherwise `openai/gpt-5.4-mini`'s evaluation model (`OPENAI_API_KEY`).
**Run:** `pnpm tsx goals/index-time-facets/found-without-a-model-call/run.mts`
**Controls:** `GOAL_CONTROL=classify-at-query` routes the search through the same evaluator (it classifies the query, then filters). Must FAIL, and must name leg **e2**, not e1.

`run.mts` exports `checkFoundWithoutAModelCall()` so the assembled goal runs this leg unchanged.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-09-25 | 48df030 | typesafe-ai/jev (Vercel AI Gateway) | PASS | 3 tickets classified at write, 1476 tokens; held-out-1 stored topic=billing; search topic=billing returned held-out-1 and held-out-3; 1 trace row, no evaluator or generator row, 0 tokens. Same result on 3 of 5 runs. |
| 2026-09-25 | 48df030 | typesafe-ai/jev (Vercel AI Gateway) | FAIL (provider) | 2 of 5 runs: Jev answered `Service temporarily unavailable` while classifying held-out-1. The write turn still succeeded and the ticket was left with no facets, as designed; e1 names the cause. Not a mechanism failure; re-run. |
| 2026-09-25 | 48df030 | typesafe-ai/jev (Vercel AI Gateway) | FAIL (expected) | `GOAL_CONTROL=classify-at-query`: `e2: the search turn ran a model: evaluator:ticket-facets` and `e2: the search turn spent 467 tokens`. e1 passed. (One control run hit the same provider outage and failed on e1 instead; re-run.) |
| 2026-09-25 | 435778a | typesafe-ai/jev (Vercel AI Gateway) | PASS | e0 now checks stored facets on every written ticket. 3 of 3 runs: all 3 tickets classified (1476 tokens); held-out-1 stored topic=billing; search returned held-out-1 and held-out-3; 1 trace row, no evaluator or generator row, 0 tokens. |
| 2026-09-25 | 435778a | typesafe-ai/jev (Vercel AI Gateway) | FAIL (provider) | 2 control runs hit Jev outages on a later ticket: `e0: held-out-2 has no stored facets after its write (classification failed: Service temporarily unavailable…)`, and the same for held-out-3. The case the old check let through as PASS. Re-run. |
| 2026-09-25 | 435778a | typesafe-ai/jev (Vercel AI Gateway) | FAIL (expected) | `GOAL_CONTROL=classify-at-query`: `e2: the search turn ran a model: evaluator:ticket-facets` and `e2: the search turn spent 467 tokens`. e0 and e1 passed. |
| 2026-09-25 | 435778a (fixture edited locally, not committed) | typesafe-ai/jev (Vercel AI Gateway) | FAIL (red check) | held-out-3's body blanked so it is never classified while held-out-1 is: `e0: held-out-3 has no stored facets after its write (no evaluator error recorded)`. Proves e0 reaches tickets after the first. |
