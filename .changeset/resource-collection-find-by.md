---
"@flow-state-dev/core": minor
"@flow-state-dev/engine": minor
---

Resource collections can declare field indexes and look rows up by them with `findBy` (FIX-2532).

- **core:** `defineResourceCollection` takes `indexes: { name: (key, state) => value }`, or `{ version, value }` to version an index. `ResourceCollectionRef` gains `findBy(index, value)`, which returns the matching instances in key order. New types `ResourceIndexDeclaration`, `ResourceIndexFunction`, `ResourceIndexValue`. `findBy` is a required member of `ResourceCollectionRef`, so a hand-written object typed as one (a test double, a partition view) needs it too.
- **engine:** the stores `createFlowState` resolves, and those a router built with `createFlowApiRouter` resolves, write every resource row with the entries of every registered index whose scope and pattern match it. On SQLite and Postgres `findBy` reads the index, building it from the collection's rows on the first lookup in each scope; on the memory and filesystem stores it scans. Registration refuses one index name at two versions on collections in one scope whose patterns can match the same keys. `FlowRegistry` gains `indexedCollections()`. `createFindByConformanceTests` in `@flow-state-dev/engine/testing` runs the shared `findBy` cases against a store registry.
