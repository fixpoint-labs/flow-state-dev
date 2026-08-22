---
"@flow-state-dev/engine": patch
"@flow-state-dev/core": patch
---

Request-scope state writes now serialize through the per-scope lock before persisting, so a wide same-process fan-out no longer throws ConcurrentModificationError. Session, user, and org scopes still use CAS.

`request.mutationTimeoutMs` continues to cover in-memory state writes only, and is not applied to any scope that persists. The timeout rejects the caller without cancelling the mutation, so a durable write that outran it could still reach the store afterwards — on top of a record the runtime had already written as terminal. (FIX-1155)
