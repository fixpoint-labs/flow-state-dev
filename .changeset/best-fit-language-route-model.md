---
"@flow-state-dev/workforce": patch
---

Best fit now routes when the coordinator flow's `routeModel` is a language model. When its evaluator call fails on a model id (Vercel's AI Gateway serves `openai/gpt-5.4-mini` only as a language model, for one), best fit asks the same question once more as a language model, through the generator block `coordinator-route-ask`. Its pick carries no confidence, so under `minConfidence:` it is never used. Before, every such post missed best fit and went to the fallback or the coordinator's own turn.
