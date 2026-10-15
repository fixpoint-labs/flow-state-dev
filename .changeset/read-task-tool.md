---
"@flow-state-dev/orchestration": patch
"@flow-state-dev/workforce": patch
"@flow-state-dev/shift-manager": patch
---

Task tools gain `readTask`, which returns one task whole: its goal, input, status, and what it came back with (its result, its error, or the question it is parked on). `listTasks` still lists without results. `taskToolActions` exposes it as `readTask_<board>`. A conversation board now shows a browser the question a task parked on a question waits on (`feedback`, with `parkedOnQuestion`). Shift Manager's shift summary lists tasks parked on a question for the user under Needs you, and its DevTeam chief of staff answers from what a finished task found (FIX-1972).
