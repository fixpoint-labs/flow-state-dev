---
"@flow-state-dev/memory": patch
---

When memory consolidation or prune output can't be recovered, the step now fails with an output validation error on the trace instead of returning an empty result that looked like "nothing to record"; a genuine empty result still succeeds, and the turn it runs beside is unaffected (FIX-1326).
