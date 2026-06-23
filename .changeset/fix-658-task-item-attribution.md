---
"@flow-state-dev/core": minor
"@flow-state-dev/engine": patch
"@flow-state-dev/tasks": patch
"@flow-state-dev/ui": patch
"@flow-state-dev/patterns": patch
---

Attribute task-board items to the task that emitted them, even under concurrent fan-out. Items now carry an emit-time `taskId` (`OutputItem.taskId`), set by the worker scope, so a sibling worker spawned mid-run no longer renders inside the queueing task's expansion and `task.items()` no longer mixes a sibling's output into another task's slice. A new shared algorithm — `attributeItemsToTasks`, `itemsForTask`, `collectAttributedItemIds` in `@flow-state-dev/core/items` — backs both the substrate and the `<TaskPlan />` UI so they always agree. Attribution stays correct across sequential turns of one worker and across retries or resume-after-review.
