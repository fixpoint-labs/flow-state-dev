---
"@flow-state-dev/engine": minor
"@flow-state-dev/store-sqlite": minor
"@flow-state-dev/store-postgres": minor
---

Wakes: a debt's due time the engine keeps, one per session and internal entry (FIX-2078). The durability sweeper fires each due wake's entry in its session, as the session's owner, and re-arms on the earliest one; a pass in that session moves or clears it. `StoreRegistry.wakes` (`WakeStore`) is optional: the in-memory, filesystem, SQLite and Postgres stores keep wakes, and a custom store without them still loads, with debts paid on their fast paths only (the host says so once at start). `createFlowState({ maxDebtAgeMs })` sets how long a debt may stay outstanding past its due time, 24 hours by default. A host's shutdown waits for the requests its wakes started. Custom store adapters can check theirs with `createWakeStoreConformanceTests` from `@flow-state-dev/engine/testing`.
