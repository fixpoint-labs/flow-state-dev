---
"@flow-state-dev/orchestration": patch
"@flow-state-dev/workforce": patch
"@flow-state-dev/devtool": patch
---

A durable task board's task tools can now run as flow actions (`taskToolActions(board)`, or `boardActions: true` in a `CHANNEL.md`), and the DevTool's Tasks tab opens a task's full record and runs those actions from the row, showing a refusal as a refusal (FIX-1629).
