---
"@flow-state-dev/engine": patch
---

A run's cross-turn history now loads only the requests its session's reads show: the session's own flow (and owning instance, when recorded), owner and organization. A session stored before runs were bound to it no longer hands another flow's or another user's turns to the model. Request rows with no organization are left out of history, as listings already leave them out (FIX-1648).
