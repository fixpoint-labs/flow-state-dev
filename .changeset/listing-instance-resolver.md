---
"@flow-state-dev/engine": patch
---

`GET /api/flows/sessions` and `GET /api/flows/active-requests` now list the rows of a flow instance that has its own `authentication.resolvePrincipal` to the callers that resolver accepts as their owner (and the instance's pin admits), the same callers who can already open those sessions (FIX-1566).
