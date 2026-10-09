---
"@flow-state-dev/engine": patch
---

With route-level authentication on, session delete, child and request listings, and resource-content routes now return 404 when the session behind the id has changed hands since access was checked (FIX-1616).
