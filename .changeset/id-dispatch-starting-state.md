---
"@flow-state-dev/core": patch
"@flow-state-dev/engine": patch
---

An `{ id }` dispatch target may carry `state`. When no session exists at that id, the seam creates it there as a session of its own, from that state, judged by the target flow's `session.createCheck` with `via: "dispatch"` (refused `create-refused`, with nothing written). A session that exists is delivered into as before and keeps its own state. An `{ id }` with no `state` is still never created (FIX-1989).
