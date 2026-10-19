---
"@flow-state-dev/orchestration": minor
---

Removed `classifierDispatcher` and `eventDispatcher`; nothing used them (FIX-2057). `fifoDispatcher`, `topologicalDispatcher` and `priorityDispatcher` remain. Removed exports: `classifierDispatcher`, `ClassifyFn`, `ClassifierDispatcherOptions`, `eventDispatcher`, `EventDispatcherOptions`. To pick a task by your own rule, write a `TaskDispatcher` whose `claim` calls `collection.claim(workerId, { eligibility })`.
