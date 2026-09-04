---
"@flow-state-dev/core": minor
"@flow-state-dev/engine": minor
---

Background work is declared with a task-board dispatcher seat and read back as child sessions; the Workstream surface it replaces is removed, `ctx.requestHost.startDetached` with it, and session-scoped resources shared with background work now use `sharedToLineage` (FIX-1308).
