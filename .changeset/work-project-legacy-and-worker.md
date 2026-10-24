---
"@flow-state-dev/workforce": patch
---

`setWorkProject(worker, project, { sessionId })` now refuses a session that runs a worker other than `worker`, storing nothing (FIX-2161). A follow-up of a task filed before tasks recorded their project, and such a task still waiting on the board, now stay in the project the task was filed in after the conversation's project is set or changed.
