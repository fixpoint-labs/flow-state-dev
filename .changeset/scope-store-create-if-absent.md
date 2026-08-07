---
"@flow-state-dev/engine": patch
"@flow-state-dev/store-sqlite": patch
"@flow-state-dev/store-postgres": patch
---

Scope stores can now require that a record does not exist. `set(id, record,
"absent")` writes only when nothing is stored at that id and returns the ordinary
conflict — carrying the winner's record — when something is. It works the same
way on all four adapters: in-memory, filesystem, SQLite, and Postgres.

This closes a create race on `POST /sessions`. The route used to read the id,
find nothing, and write unconditionally, so two requests arriving together both
passed the existence check and both wrote: the second silently overwrote the
first, and each caller believed it had created the session. **Concurrent
duplicate creates now resolve to one `201` and one `409`**, matching what a
sequential duplicate has always returned. Picking a session id derived from your
own data — a customer id, a topic, a date — is now safe to do concurrently.

`"absent"` is a new value on `ExpectedVersion`, alongside the version numbers and
`"any"`. **No existing caller changes.** In particular `expectedVersion: 0` still
means "the stored version is exactly 0" on scope stores, which is what the first
write of every new session, user and org passes; create-if-absent could not reuse
it, because scope records are *created* at version 0 and a v0 record is live
rather than absent.

Two places reject the new value rather than accepting it, both loudly:

- **The CAS delta verbs** (`patchField`, `incField`, `pushToArray`,
  `deleteField`) throw. They update an existing record, so "only if absent" is
  unsatisfiable rather than a race that might go your way. Use `set` to create.
- **`ResourceStateStore`** throws. That store starts its versions at `1` and
  already spells create-if-absent `0`, and the two only agree on `set` — on
  `delete`, `0` means "no live row, so the terminal state already holds" and
  "delete only if absent" means nothing at all.

If you implement `StoreRegistry` yourself, a scope store's `set` should treat
`"absent"` as create-if-absent and let the backend decide the race atomically —
a read followed by an insert passes single-process tests and still loses under
real concurrency. `@flow-state-dev/engine/testing` now exports
`createScopeStoreConformanceTests` to check an adapter against the contract,
including a cross-connection case.
