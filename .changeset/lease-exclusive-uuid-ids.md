---
"@flow-state-dev/engine": patch
"@flow-state-dev/store-sqlite": patch
"@flow-state-dev/store-postgres": patch
---

Postgres lease acquire is now exclusive when the executor supports transactions, so two instances can no longer both take the lease for the same request; lease ids are now UUIDs on every store, and custom `LeaseStore`s can run the shared `createLeaseStoreConformanceTests` from `@flow-state-dev/engine/testing` (FIX-1712).
