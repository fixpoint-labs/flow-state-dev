---
"@flow-state-dev/orchestration": patch
---

A `getTask({ id, wait: true })` on a task whose ending the session already heard as a notice now returns the task, with its output, instead of `arrivesAsNotice` (FIX-2181). `arrivesAsNotice` still answers while that notice is being delivered: still owed, or acknowledged by an `onTaskSettled` request that is still running.
