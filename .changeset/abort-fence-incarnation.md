---
"@flow-state-dev/engine": minor
---

A cancel now lands on the request its caller checked, identified by incarnation rather than `createdAt` (FIX-1654). Before, a cancel issued while the owner's own retry re-stamped the request answered 404 and never stopped the run, and a request created in the same millisecond under a reused id could receive another caller's cancel.

**Store authors:** `RequestStore.setFieldsIfStatus`'s fifth parameter is now `expectedIncarnation?: string`, replacing `expectedCreatedAt?: number`. Compare it with the stored record's `resolveRequestIncarnation(record)` (newly exported) inside the same atomic step as the status check, and report a mismatch as an absent record. See the engine README, "Abort intent on `RequestStore`".

The in-process abort registry takes the incarnation too: `registerAbortController(id, incarnation?)`, `abortRequest(id, expectedIncarnation?)` and `hasActiveAbortController(id, expectedIncarnation?)`. Callers that pass no incarnation behave as before.
