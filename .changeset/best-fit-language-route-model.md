---
"@flow-state-dev/workforce": patch
---

Best fit now routes when the coordinator flow's `routeModel` is a language model, such as `openai/gpt-5.4-mini` through Vercel's AI Gateway, by asking the same question once more as a language model when the evaluator call fails (FIX-1889).
