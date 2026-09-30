---
"@flow-state-dev/orchestration": minor
"@flow-state-dev/workforce": patch
---

A handed-off task now names the run working it: its row carries `run: { sessionId, requestId, attempt }`, written by the run before its worker starts and published as a `run_linked` task change, and a channel board's `readBoard` and browser read both return it. `TaskCollectionRef` gains a required `linkRun` verb, so a hand-written collection must implement it (FIX-1668).
