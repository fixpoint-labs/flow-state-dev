---
"@flow-state-dev/engine": patch
---

`GET /api/flows` now lists a pinned flow instance that has its own `authentication.resolvePrincipal` to the callers that resolver accepts and the pin matches, the same callers who can already open and run it (FIX-1552).
