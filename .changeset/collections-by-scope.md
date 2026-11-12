---
"@flow-state-dev/core": minor
"@flow-state-dev/engine": minor
"@flow-state-dev/client": minor
"@flow-state-dev/react": minor
"@flow-state-dev/workforce": minor
---

User and org collections are read by entry with no session, and a client writes an entry only through the flow the collection names (FIX-2624).

- **core:** `defineResourceCollection` takes `runBy` and `canWrite`, with the same rules as a single resource: an org collection on `runBy: "default"` with no `canWrite` refuses to start. A collection's `canWrite({ key, prev, next, userId, orgId })` gets the entry's storage key, no `prev` on a create and no `next` on a delete. Also refused at definition: `runBy` without `client: { state: { read: true } }`, and `runBy: "default"` with `writable: false` or an eviction policy.
- **engine:** `GET /api/flows/resources/:scope/:pattern/entries` lists the caller's entries (`{ items: [{ topic, storageKey, value, version }], nextCursor }`, with `limit`, `cursor` and `topicPrefix`), and `GET .../entries/:entry` reads one (`null` when absent). The default write flow's `set` takes an `entry` for a collection, and its new `delete` deletes one, each at the version the client read, behind the owner rule of an owner-keyed collection and the collection's `canWrite`. Each entry write publishes the entry's change on its user or org topic. A collection's address is its pattern; reading it at `GET /resources/:scope/:key` answers 400.
- **client:** `client.resource(collection)` returns `list()`, `entry(key)` (with `read()`, `set()`, `update()` and `delete()`) and `send(action, input)`. A single resource's handle gets `send` too: a named action of the resource's own `runBy` flow, with no session.
- **react (breaking):** `useResource(def, { session })` replaces `useResource(session, ref)`; the old form is gone, with no alias. Migrate `useResource(session, "soul")` to `useResource(soul, { session })`. It returns `{ value, stale }` instead of `{ clientData, fetchContent }`: a user or org resource or collection is read with no session and kept current on its scope's change notices, with `set` and `update` (a collection's take an entry, and it has `delete`). For a session resource's content, use `useResourceContent`.
- **workforce:** the workers collection is written through the roster flow (`runBy: { flow: "workforce-roster" }`). `createWorkforceClient`'s `hire`, `fork`, `edit`, `reset` and `fire` no longer find or make a roster session, and the organization a worker's conversation is derived under comes from the roster flow's identity read. The client it's built over needs `resource` (any `createClient` client has it).

Docs: apps/docs/docs/resources/client-access.md (listing and reading a collection's entries by scope; the two entries routes in the endpoint table; the reshaped `useResource`), apps/docs/docs/resources/client-writes.md (collection entries: `set` and `delete`, the collection `canWrite` check), apps/docs/docs/client/react.md (`useResource(def, { session })` and its result), apps/docs/docs/client/overview.md (`client.resource` on a collection, `send`), packages/core/README.md, packages/client/README.md, packages/react/README.md (`useResource`), packages/workforce/README.md (roster writes)
