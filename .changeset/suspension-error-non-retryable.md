---
"@flow-state-dev/server": patch
---

Fix `SuspensionError` being retried. A retry-configured durable action that calls `ctx.suspend()` was re-executing the whole action on every suspension (because `SuspensionError` was classified retryable) instead of pausing. `isRetryableError` now treats `SuspensionError` as non-retryable, so it propagates untouched and the runtime suspends the request.
