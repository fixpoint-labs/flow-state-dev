---
"@flow-state-dev/server": minor
---

`runAction` now serves as the sanctioned entry point for running a flow action from non-HTTP code (background jobs, cron handlers, queue consumers, custom integrations). It accepts an optional `onItem` callback for observing items live as they are added/updated/done, and returns the run's `requestId` on the `ExecutionResult` so callers can correlate logs or attach a stream. Identity follows the same trust contract as the HTTP layer: the caller supplies a resolved `userId`.
