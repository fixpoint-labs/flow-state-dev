---
"@flow-state-dev/engine": patch
---

`POST /api/flows/users/:userId/check-interrupted` now only reports and sweeps in-flight requests in the caller's own tenant (the tenant header, `x-tenant-id` by default), so a caller on one tenant can no longer see another tenant's request ids or mark its live requests `interrupted` (FIX-1569).
