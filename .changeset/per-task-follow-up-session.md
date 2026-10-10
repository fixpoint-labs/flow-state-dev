---
"@flow-state-dev/core": patch
---

A `per-task` hand-off keys a follow-up task's child session by the task it follows (`followUpOf` on the worker input), so the follow-up runs in that task's session (FIX-1817).
