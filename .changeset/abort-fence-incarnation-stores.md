---
"@flow-state-dev/store-sqlite": patch
"@flow-state-dev/store-postgres": patch
---

`setFieldsIfStatus` fences a cancel on the request's incarnation instead of its `createdAt`, so a cancel reaches the owner's request after their own retry re-stamped it, and never a later request that reused the id (FIX-1654). No schema change; records written before incarnations existed are matched on their `legacy_<createdAt>` value.
