---
"@flow-state-dev/engine": patch
---

The request host implements `sessions.read(id)`: a block can read another session of its own principal, cut to that session's flow's read-only state fields (FIX-2160).
