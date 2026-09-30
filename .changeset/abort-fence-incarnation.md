---
"@flow-state-dev/engine": minor
"@flow-state-dev/store-sqlite": patch
"@flow-state-dev/store-postgres": patch
---

Cancelling a request now only ever cancels the request whose owner was checked, and `RequestStore.setFieldsIfStatus`'s fifth argument is now that request's expected incarnation, which custom stores must honor (FIX-1654).
