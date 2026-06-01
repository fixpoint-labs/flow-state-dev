---
"@flow-state-dev/server": minor
---

Add `runFlow`, a sanctioned entry point for executing a flow action from non-HTTP code (background jobs, cron handlers, queue consumers, custom integrations). It returns a handle with the run's `requestId`, a `status`, and a `finished` promise, plus an optional `onItem` callback for observing items live. Identity follows the same trust contract as the HTTP layer: the caller supplies a resolved `userId`.
