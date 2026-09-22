---
"@flow-state-dev/engine": patch
---

Served requests that die during setup now settle as `failed` instead of hanging at `in_progress` (FIX-1511).
