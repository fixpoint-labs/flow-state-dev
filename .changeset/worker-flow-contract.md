---
"@flow-state-dev/workforce": minor
---

`hireWorkforce` now takes your worker flows as `workerFlows` (renamed from `kinds`), checks each one against the worker contract before any worker runs, can keep a flow for standard workers, and ships `workerFlowProblems`, `sharedResource` and `writeShared` (FIX-1789).
