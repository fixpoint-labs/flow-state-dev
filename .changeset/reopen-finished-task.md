---
"@flow-state-dev/orchestration": minor
"@flow-state-dev/harness-manager": minor
"@flow-state-dev/workforce": minor
"@flow-state-dev/shift-manager": patch
---

A person's message on a finished task reopens it: task collections gain `reopen(id)`, the harness manager's door reopens a finished run when its board names `reopenIn`, a worker's reply in a finished task's session on a Workforce conversation board reopens that task, and Shift Manager's task composer takes a message on a finished task (FIX-1764).
