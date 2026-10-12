---
"@flow-state-dev/workforce": patch
---

When best fit's evaluator call fails on a `routeModel` id, it asks the same question once more as a language model (`coordinator-route-ask`), so a gateway that serves `openai/gpt-5.4-mini` only as a language model still routes; the pick has no confidence, so under `minConfidence:` it is never used (FIX-1889).
