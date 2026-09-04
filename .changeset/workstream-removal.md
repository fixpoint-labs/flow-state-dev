---
"@flow-state-dev/core": minor
---

Background work is declared with a task-board dispatcher seat and read back as child sessions; the Workstream surface it replaces is removed, and session-scoped resources shared with background work now use `sharedToLineage` (FIX-1308).
