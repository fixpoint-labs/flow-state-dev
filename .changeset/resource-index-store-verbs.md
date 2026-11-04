---
"@flow-state-dev/engine": minor
"@flow-state-dev/store-sqlite": minor
"@flow-state-dev/store-postgres": minor
---

Resource state stores can keep index entries, so a collection can later be looked up by a declared field without reading its rows (FIX-2532, first of three changes).

- **engine:** `ResourceStateStore.set` takes an optional sixth argument, `{ indexEntries }`, and the store may have an optional `indexes` member (`state`, `beginBuild`, `completeBuild`, `findKeys`). New types: `ResourceIndexEntry`, `ResourceStateSetOptions`, `ResourceIndexBuildState`, `ResourceIndexBuildEntry`, `ResourceStateIndexes`. Both are optional, so an existing adapter or test double still type-checks and behaves as before. `createResourceStateStoreConformanceTests` takes `indexes: true` to run the index cases against a store that implements them. The memory and filesystem stores implement no index verbs.
- **store-sqlite / store-postgres:** implement the index verbs, with two new tables, `resource_index` and `resource_index_built`, created on open like every other table. Every resource write now also maintains them in the same commit, so **a database opened with `skipSchemaInit: true` must have had `initializeSchema` run against this version first**, or resource writes fail. On Postgres a successful `set` then runs one more statement that clears build markers its write could not see, so it costs one extra round trip.
