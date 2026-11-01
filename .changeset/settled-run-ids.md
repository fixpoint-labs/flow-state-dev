---
"@flow-state-dev/engine": patch
"@flow-state-dev/core": patch
---

A harness run reported without a `runId` is given one (`settled_…`) as the request counts it. Request-end hooks, `readRequestSpend` and a continuation that recovers the run from the log all see the same id, so a reader that wrote the run down can tell it from a second run (FIX-2398).
