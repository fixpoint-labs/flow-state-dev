---
"@flow-state-dev/core": patch
"@flow-state-dev/engine": patch
"@flow-state-dev/claude-code": patch
"@flow-state-dev/codex": patch
"@flow-state-dev/cursor": patch
"@flow-state-dev/orchestration": patch
"@flow-state-dev/workforce": patch
---

A dispatched task records what its runs spent on its row (`spend`), every attempt counted, rising while a run works: the board writes it every 2 s and as the request ends, through the new `recordSpend` verb on `TaskCollectionRef`. `listTasks` from `taskToolActions` returns it folded (`taskSpendView`: harness, model, input and output tokens, `null` until reported). Harness runs report spend as they go, keyed by a `runId` with the model the run named, each report replacing the run's last; `readRequestSpend(ctx)` reads a running request's spend so far, and `requestSpendSources` moves from Workforce into core (FIX-2288).
