---
"@flow-state-dev/workforce": patch
---

Adds `mergeSeatFlows(flows, seats)`, which refuses a hired seat whose id is already a flow's instead of replacing that flow, and exports `newIncarnation()` and `tagIncarnation()` so a host that writes roster rows itself can stamp its hires (FIX-1719).
