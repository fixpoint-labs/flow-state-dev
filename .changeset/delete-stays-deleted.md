---
"@flow-state-dev/engine": minor
"@flow-state-dev/store-sqlite": minor
"@flow-state-dev/store-postgres": minor
---

Deleting a resource now keeps it deleted (FIX-1258). A `patchState` / `setState` /
`updateState` that ran after the delete could bring the resource back — holding
whatever that write computed from the resource's schema default, with no error
to the caller. It happened whenever the write executed with no live cached
entry for the key, which includes the ordinary cases: a request that never read
the resource, and a request that deleted it and then wrote through a reference
it was still holding. A session delete is the sharpest version, since a request
already in flight could resurrect data the user asked to have removed.

Those writes now fail with `ResourceDeletedError` instead of committing, and the
resource stays gone. Two behaviours are deliberately unchanged: recreating a
deleted resource with `create()` still works, and the first write to a resource
that was never persisted (one living on its schema default) still creates it.

For custom `ResourceStateStore` adapters, `set` gains a third `expectedVersion`
spelling: `"absent"` means "no row at all", so a tombstone conflicts, where `0`
continues to mean "no live row" and admits one. `delete` still rejects
`"absent"`. Adapters that delegate to the engine's shared write predicate get
this automatically; a hand-written predicate needs the new branch, and the
shared conformance suite covers it.
