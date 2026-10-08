---
"@flow-state-dev/engine": patch
"@flow-state-dev/store-sqlite": patch
"@flow-state-dev/store-postgres": patch
---

The stale-request sweep no longer marks a request `interrupted` when it finished while the sweep was running, and `RequestStore.setFieldsIfStatus` can now move a record's status together with its result, which custom request stores must support (FIX-1128).
