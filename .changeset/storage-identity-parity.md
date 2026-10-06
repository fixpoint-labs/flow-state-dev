---
"@flow-state-dev/core": patch
---

`defineFlow`'s build-time resource collision check now keys each declaration on the cell the engine actually writes (FIX-1257). Two collections sharing a `pattern` are refused whatever `ref` each carries, a `defineResource` carrying a `pattern` is checked as the collection it is stored as, and an aliased resource is checked only under the slot it persists to. A flow that previously built only because a collection carried a `ref` now throws `Resource collision` at definition time. The shared rule is exported as `isCollectionConfig` and `resourceStorageKeys` from `@flow-state-dev/core/types`.
