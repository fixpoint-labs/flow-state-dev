---
"@flow-state-dev/orchestration": patch
---

A `getTask({ id, wait: true })` on a task that already ended returns it at once, and that answer is the filer's delivery: when the flow's `onTaskSettled` waits behind the turn that filed the task, as Workforce's turns make it, the ending's notice request still runs but no longer calls your block. Task collection refs gain an optional `dropNoticeReadByWait(id)`, which both built-in backings implement; a ref without it keeps the old behaviour (FIX-2112).
