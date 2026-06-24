---
"@flow-state-dev/engine": minor
"@flow-state-dev/store-postgres": minor
"@flow-state-dev/store-sqlite": minor
---

Resource state (single resources and collection instances) now persists per-resource in a new `ResourceStateStore`, keyed by `(scopeType, scopeId, resourceKey)` and separate from the scope record — the state-layer twin of `ContentStore`. A state mutation writes only the affected key instead of rewriting the whole scope record, removing the write amplification a large collection previously paid on every change. The resource and collection APIs are unchanged. `StoreRegistry` gains a required `resourceState` slot; custom registries must supply one (use `createInMemoryResourceStateStore` / `createFilesystemResourceStateStore`). Postgres adds a `resource_state` table (`JSONB`); the SQLite adapter is in-memory for now, matching its content store.
