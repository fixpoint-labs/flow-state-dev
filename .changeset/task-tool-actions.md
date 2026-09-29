---
"@flow-state-dev/orchestration": patch
"@flow-state-dev/workforce": patch
"@flow-state-dev/devtool": patch
---

New `taskToolActions(board)` exposes a durable task board's eight task tools as flow actions named `<tool>_<board>` (with `taskToolSuffix` for the naming rule). A `CHANNEL.md` can declare `boardActions: true` to expose its boards' task tools as channel actions, off by default. The DevTool's Tasks tab now opens a task in place with its whole record, and runs the flow's actions that take a `taskId` from the row, showing a refusal as a refusal (FIX-1629).
