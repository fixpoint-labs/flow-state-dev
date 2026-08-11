---
"@flow-state-dev/core": minor
"@flow-state-dev/engine": minor
"@flow-state-dev/orchestration": minor
---

Session-scoped resources can now span a session and the background work it starts (FIX-1068). Declare `sharedToWorkstream: true` on a `defineResource` / `defineResourceCollection` at session scope and the session, its workstreams, and their workstreams all resolve one copy of it through the ordinary resource API. Session state stays private to each session, and sharing does not serialize writes. `defineTaskCollection` accepts the same option, so a detached task board can be session-scoped and still be settled from inside its workstream.
