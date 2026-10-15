---
"@flow-state-dev/core": patch
"@flow-state-dev/engine": patch
---

An `{ id }` dispatch target may carry `state`, which creates the session at that id when none exists, through the target flow's create check (FIX-1989).
