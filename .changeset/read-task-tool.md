---
"@flow-state-dev/orchestration": patch
"@flow-state-dev/workforce": patch
---

Task tools gain `readTask`, which returns one task whole: its goal, input, status, and what it came back with (its result, its error, or the question it is parked on). `listTasks` still lists without results. `taskToolActions` exposes it as `readTask_<board>`. A conversation board now shows a browser the question a task parked on a question waits on (`feedback`, with `parkedOnQuestion`) (FIX-1972).
