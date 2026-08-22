---
"@flow-state-dev/engine": patch
"@flow-state-dev/core": patch
---

Request-scope state writes now serialize through the per-scope lock before persisting, and keep their conflict retries underneath it. A wide same-process fan-out of request-state writes no longer throws `ConcurrentModificationError` — serialized writers each read a current version, so they never conflict with one another and never spend a retry attempt. The retry budget stays available for the writer the lock cannot order: a recovery continuation, which re-enters an interrupted request under its own id and writes through a container of its own. Session, user, and org scopes are unchanged and still use CAS unlocked.

Nothing changes about `request.mutationTimeoutMs`. It covers in-memory state writes (target, sequencer, block state) and is applied to no scope that persists, request scope included — same as before. The budget rejects the caller without cancelling the mutation, so putting a durable write on it would let a write the caller had given up on reach the store after the request had already finished. Docs and the exported `RequestConfig` JSDoc that described every persist-backed scope as CAS-driven have been corrected. (FIX-1155)
