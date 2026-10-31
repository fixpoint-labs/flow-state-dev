---
"@flow-state-dev/orchestration": minor
"@flow-state-dev/workforce": patch
---

A failed or cancelled task can be retried as the same task (FIX-2383). `TaskCollectionRef.retry(id)` (optional, on both built-in backings) puts an `errored` or `cancelled` row back to `pending`, keeping its id, steers, output and spend, with the grant counted in `retryLedger`; it publishes a `retry_requested` change and declines `disallowed`, `settling`, `dependency-ended` or `retry-budget`. `taskToolActions` adds `retryTask_<suffix>`, an action only: a model's task tools are unchanged. Workforce's conversation board starts a retried row at once, as it does a released one.
