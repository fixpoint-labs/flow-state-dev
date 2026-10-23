---
"@flow-state-dev/orchestration": patch
---

A `getTask({ id, wait: true })` on a task that already ended returns it at once, and that answer is the filer's delivery: the ending no longer also starts an `onTaskSettled` turn. Task collection refs gain an optional `dropNoticeReadByWait(id)`, which both built-in backings implement; a ref without it keeps the old behaviour (FIX-2112).
