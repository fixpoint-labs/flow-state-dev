---
"@flow-state-dev/core": patch
"@flow-state-dev/engine": patch
---

A flow that sets no `tokenCounter` now counts with core's `estimateTokenCounter`, which reads each model's characters-per-token from the model lookup, instead of a flat four characters a token. `{ tokens: N }` history windows on a GPT, Gemini or Llama model count a little higher than before, so they hold slightly fewer turns. Blocks read the flow's counter as `ctx.tokenCounter` (absent on a mock context), and `utility.consultSessionHistoryTool` cuts its `budgetTokens` with it, for the answering model (FIX-2319).
