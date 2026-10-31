---
"@flow-state-dev/workforce": minor
---

A task's session stays open until the task is done and after: a follow-up filed with `createTask({ followUpOf })` runs in the same session (FIX-1817).
