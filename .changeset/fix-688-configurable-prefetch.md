---
"@flow-state-dev/core": minor
"@flow-state-dev/server": minor
"@flow-state-dev/client": minor
"@flow-state-dev/react": minor
"@flow-state-dev/store-postgres": minor
"@flow-state-dev/store-sqlite": minor
---

Add a configurable `prefetchMode` knob controlling how resource/collection instances load into the execution context at request start (FIX-688). Default is `'eager'` — every declared instance loads at scope startup, the prior behavior. `'lazy'` preloads nothing and reads from the store on demand; `'partial'` (collections only) eagerly loads the `recentLimit` lexicographically-highest keys and leaves the rest lazy, pairing with a sortable key convention for "most-recent N" semantics. `recentLimit` is required for `'partial'`, must not exceed `maxInstances`, and is capped at 10000. Single resources accept `'eager' | 'lazy'` (`'partial'` throws), but a declared single resource is always preloaded before the block runs — declaring it is a statement of need — so `'lazy'` is a no-op for single resources today and only collections genuinely defer per-instance loads. `prefetchMode` is distinct from the existing `prefetchWindow`, which shapes the client SSE snapshot rather than server-side loading.

To support lazy loading, a collection's lookup accessors are async: `await coll.get(key)` / `await coll.getOptional(key)`, `await coll.count()`, the cursor-paginated `await coll.list({ limit?, cursor?, prefix? }) → { items, nextCursor? }`, and the new auto-paging `coll.scan({ prefix?, signal?, pageSize? })` async iterator. The `ResourceRef` these hand back already has its state loaded, so `ref.state` stays a synchronous property — you await the lookup, not the read. Write helpers and `create`/`getOrCreate`/`upsert` were already async. The handler-facing per-resource context (`ctx.state`) and the scope-state handles stay synchronous. `ContentStore` and `ResourceStateStore` gain a keyset-paginated `getByPrefixPaged`; the Postgres and SQLite adapters implement it as keyset queries over the resource key. This is internally breaking for our own call sites, but there are no external consumers yet.

The client and React collection-list surfaces switch from offset pagination to keyset cursors: `CollectionListPage` now carries `{ items, pagination: { limit, nextCursor } }` (was `offset`/`total`/`hasMore`/`nextOffset`), `listCollectionItems` / `useResourceCollectionList` take a `cursor` instead of an `offset`, and list items now include their raw `storageKey`.
