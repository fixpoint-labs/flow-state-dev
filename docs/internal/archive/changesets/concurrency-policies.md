---
"@flow-state-dev/core": minor
"@flow-state-dev/engine": minor
"@flow-state-dev/mcp": patch
"@flow-state-dev/scheduled": patch
---

Add a declarative concurrency policy to actions. Set `concurrency` on an action (or `request.concurrency` as a flow-wide default) to control what happens when a second request arrives while one is already in flight on the same key: `allow` (default, run in parallel), `queue` (serialize in arrival order), or `reject` (drop the newcomer). The policy keys on the session by default and is overridable to `user`, `none`, or a custom function. It is enforced once at the shared dispatch seam, so every transport inherits it: over HTTP a rejected request returns 409 with the in-flight request id; webhooks get a benign skipped response so the provider stops retrying. New exports: `ConcurrencyConfig`, `ConcurrencyKey`, `ConcurrencyKeyContext`, `ConcurrencyPolicyName`, and `validateConcurrencyConfig` from `@flow-state-dev/core`; `ConcurrencyRejectedError` and `ConcurrencyQueueTimeoutError` from `@flow-state-dev/engine`.
