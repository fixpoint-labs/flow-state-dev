---
"@flow-state-dev/orchestration": patch
---

A task's ending reaches the session that filed it once, on the defaults too: a `getTask({ id, wait: true })` that reads a task already ended no longer races that task's `onTaskSettled`. A notice now waits until the request that filed its task has ended (that request sends it as it ends), and `taskSettledEntry` takes a notice in one conditional write before it runs your block. A wait that finds the notice already taken returns `{ ok: true, taskId, arrivesAsNotice: true, message }` instead of the task. Task collection refs gain an optional `takeNotice(id, notice, take)`, which both built-in backings implement; a ref without it admits notices as before (FIX-2123).
