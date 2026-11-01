---
"@flow-state-dev/engine": minor
"@flow-state-dev/core": minor
---

A harness run reported without a `runId` gets a `settled_…` id when the request counts it. Request-end hooks, `readRequestSpend`, and a continuation that recovers the run from the log all see that same id. A request's record now carries its harness runs across a suspension or an interruption (`spentHarnessRuns`), as it already carried model calls. The new `readRequestTotalSpend(ctx)` reads everything the request has spent across all its runs, so a record of the whole request, such as a harness turn, reads the same after a resume (FIX-2398).
