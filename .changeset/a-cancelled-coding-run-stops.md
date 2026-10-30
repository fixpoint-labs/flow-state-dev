---
"@flow-state-dev/harness-manager": patch
---

A coding run stops when its task is cancelled. The manager reads the task's row every `STEER_POLL_MS` while a step runs, and aborts the harness within that second once the task is cancelled, finished, or claimed again. Before, a cancelled run kept working until the lease's next renewal or the run's deadline (FIX-2349).
