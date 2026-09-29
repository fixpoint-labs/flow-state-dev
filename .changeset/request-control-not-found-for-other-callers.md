---
"@flow-state-dev/engine": patch
"@flow-state-dev/store-sqlite": patch
"@flow-state-dev/store-postgres": patch
---

Retry, continue, resume and abort now answer a request that belongs to another user or tenant with the same `404 Request "<id>" not found` as an id nobody has used, and abort only stops the request it checked (FIX-1021).
