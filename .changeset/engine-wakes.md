---
"@flow-state-dev/engine": minor
"@flow-state-dev/store-sqlite": minor
"@flow-state-dev/store-postgres": minor
"@flow-state-dev/node": minor
---

Wakes: a debt's due time the engine keeps, one per session and internal entry (FIX-2078). The durability sweeper fires each due wake's entry in its session, as the session's owner, and re-arms on the earliest one; a pass in that session moves or clears it. `StoreRegistry.wakes` (`WakeStore`) is optional: the in-memory, filesystem, SQLite and Postgres stores keep wakes, and a custom store without them still loads, with debts paid on their fast paths only (the host says so once at start). `createFlowState({ maxDebtAgeMs })` sets how long a debt may stay outstanding past its due time, 24 hours by default. A host's shutdown waits for the requests its wakes started, up to `createFlowApiRouter({ shutdownDrainMs })` (10 s by default; `disposeFlowApiRouter(router, { drainMs })` per call), then aborts the rest and logs how many: each wake stays, and the next host fires it again. `@flow-state-dev/node`'s `serve()` passes what is left of its shutdown grace, through the server app's `dispose({ drainMs })`. At start the host reads its wake store once: one it can't read (a database upgraded without the migration that adds the wakes table) is treated as keeping none, with a one-time warning. **A Postgres or SQLite host that runs its migrations itself (`skipSchemaInit`) reruns them after upgrading**, or its wakes stay off. Custom store adapters can check theirs with `createWakeStoreConformanceTests` from `@flow-state-dev/engine/testing`.
