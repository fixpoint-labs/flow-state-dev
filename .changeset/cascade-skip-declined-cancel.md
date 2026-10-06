---
"@flow-state-dev/orchestration": patch
---

`cascadeSkipDependents` no longer labels a task `skipped`, or skips that task's dependents, when its cancel was declined because the task had already been settled by something else (FIX-985).
