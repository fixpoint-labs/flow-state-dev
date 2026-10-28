---
"@flow-state-dev/orchestration": patch
---

`getTask({ id, wait: true })` on a row a plan board's drain handed to another session and waits on is now refused with `wait_on_plan_step`, which tells the agent to wait on the plan instead, for as long as the drain waits, deadlines included. Before, a wait that landed at one of the drain's deadlines took the row's wait slot and failed the plan (FIX-2105).
