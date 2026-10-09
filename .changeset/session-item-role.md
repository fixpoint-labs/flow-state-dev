---
"@flow-state-dev/core": patch
"@flow-state-dev/engine": patch
---

A message item read through `ctx.session.items.all()`, `client()` or `selectForContext()` carries its `role`, so a block building its own prompt context can tell the caller's messages from the flow's (FIX-1828).
