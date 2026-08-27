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
resource stays gone. Three behaviours are deliberately unchanged: recreating a
deleted resource with `create()` still works, the first write to a resource that
was never persisted (one living on its schema default) still creates it, and
**deleting a session and then creating a new one under the same id still gives
that new session fully writable resources.**

That last one is why a session's birth now clears the resource-state tombstones
left under its id. Session ids are caller-supplied, so a stable id like
`chat-42` or a document id can be deleted and used again — and the session store
keeps no tombstone of its own, so the id really is free. Without the clear, the
dead session's tombstones would outlive it and refuse the new session's first
write to every **static** resource, permanently: a static resource reference has
no create-if-absent verb to fall back on the way a collection instance does. The
tombstones are cleared when the new session record is created, not when the old
one is deleted — while the session is gone they are still what keeps a delete
deleted. This covers every way a session is created: the create-session route, a
first action against an id that has none, and a detached child spawn. The spawn
matters most, since a child's key is derived from its seed and so is reused by
design.

The clear runs immediately **before** the record is written, and only after a
check that no record exists. There is no transaction across the two stores, so
writing the record first would strand a live session on the old one's tombstones
whenever the clear then failed — permanently, since a retried create answers 409
and an action-driven create adopts the existing record.

**Known limit.** With no cross-store transaction the clear is not fenced against
a concurrent creator. If two callers both find no session and one wins, the
loser can clear a tombstone the winner's session just made, and the next
ordinary write to that resource will recreate it. Closing this needs a
generation or ownership fence on session birth, which is a larger change than
this one.

For custom `ResourceStateStore` adapters, two changes:

- `set` gains a third `expectedVersion` spelling: `"absent"` means "no row at
  all", so a tombstone conflicts, where `0` continues to mean "no live row" and
  admits one. `delete` still rejects `"absent"`. Adapters that delegate to the
  engine's shared write predicate get this automatically; a hand-written
  predicate needs the new branch.
- `purgeTombstones(scopeType, scopeId)` is a **new required method**: remove the
  scope's tombstoned rows outright, leaving every live row untouched. In SQL it
  is one statement (`DELETE … WHERE scope_type = ? AND scope_id = ? AND
  lifecycle = 'deleted'`). A hand-written adapter will fail to compile until it
  is added, and a hand-written **test double** of the store will fail at runtime
  — a double is an implementer of the interface too.

The shared conformance suite covers both.
