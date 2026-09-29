---
"@flow-state-dev/engine": patch
---

A session's request listing and the conversation history a run in it gives its model now show only that session's own flow, owner and organization, so a session stored before runs were bound to it no longer serves another flow's or another user's turns (FIX-1648).
