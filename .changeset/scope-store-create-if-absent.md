---
"@flow-state-dev/engine": minor
"@flow-state-dev/store-sqlite": minor
"@flow-state-dev/store-postgres": minor
---

Scope stores can now require that a record does not exist. `set(id, record,
"absent")` writes only when nothing is stored at that id and returns the ordinary
conflict — carrying the winner's record — when something is. All four adapters
accept it and mean the same thing by it: in-memory, filesystem, SQLite, and
Postgres. How strongly each one can hold the line differs, which matters here —
see the caveat below.

This closes a create race on `POST /sessions`. The route used to read the id,
find nothing, and write unconditionally, so two requests arriving together both
passed the existence check and both wrote: the second silently overwrote the
first, and each caller believed it had created the session. **Concurrent
duplicate creates now resolve to one `201` and one `409`**, matching what a
sequential duplicate has always returned. Picking a session id derived from your
own data — a customer id, a topic, a date — is now safe to do concurrently.

**On SQLite and Postgres that holds across processes**, because the database
decides the race. **On the filesystem store it holds only among writes that go
through the same store instance.** That store serializes on a per-id lock kept in
its own memory, so two registries pointed at one `rootDir` still race — whether
they sit in two Node processes or in the same one. This is the limitation the
store contract already carries for compare-and-swap generally, and the create
path simply inherits it. For anything beyond a single store instance, reach for
SQLite or Postgres.

`"absent"` is a new value on `ExpectedVersion`, alongside the version numbers and
`"any"`. **If you use the bundled stores, nothing you call changes.** In
particular `expectedVersion: 0` still means "the stored version is exactly 0" on
scope stores, which is what the first write of every new session, user and org
passes; create-if-absent could not reuse it, because scope records are *created*
at version 0 and a v0 record is live rather than absent.

**If you implement `StoreRegistry` yourself, this one needs your attention.**
Session creation now passes `"absent"` to your `SessionStore.set`, so an adapter
written against the previous contract sees a value it does not recognise — and
depending on how it validates, that can turn into a rejected create rather than
a clear error. Handle it before upgrading. A scope store's `set` should treat
`"absent"` as create-if-absent and let the backend decide the race atomically: a
read followed by an insert passes single-process tests and still loses under real
concurrency. `@flow-state-dev/engine/testing` now exports
`createScopeStoreConformanceTests` to check an adapter against the contract,
including a cross-connection case.

Two places reject the new value rather than accepting it, both loudly:

- **The CAS delta verbs** (`patchField`, `incField`, `pushToArray`,
  `deleteField`) throw. They update an existing record, so "only if absent" is
  unsatisfiable rather than a race that might go your way. Use `set` to create.
- **`ResourceStateStore`** throws. That store starts its versions at `1` and
  already spells create-if-absent `0`, and the two only agree on `set` — on
  `delete`, `0` means "no live row, so the terminal state already holds" and
  "delete only if absent" means nothing at all.
