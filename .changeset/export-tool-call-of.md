---
"@flow-state-dev/orchestration": patch
---

`checkWaitable(ctx, { key, deadlineMs?, step?, binding?, own?, unavailable })` and `toolCallOf(ctx)` are exported from `@flow-state-dev/orchestration/task-board`. `checkWaitable` runs the checks every wait makes before anything is written (`wait_unavailable`, `wait_deadline_out_of_range`, `wait_too_deep`, `wait_already_pending`), so a tool that waits shares `getTask`'s rules (FIX-2239). The step is now claimed after the depth check, so a wait refused for its depth no longer holds its model step.
