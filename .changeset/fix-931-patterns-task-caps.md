---
"@flow-state-dev/patterns": minor
---

`planAndExecute`, `supervisor`, `parallelTasks` and `eventActors` now bound how much work their boards take on — task creation is rejected past 100 enqueued at once or 500 over the run, tunable on each pattern via `maxEnqueuedTasks` / `maxTotalTasks` (raise the number, or pass `null` for unbounded) — and an actor output whose entries would together cross the bound dispatches none of them rather than some.
