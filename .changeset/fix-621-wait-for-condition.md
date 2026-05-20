---
"@flow-state-dev/core": minor
"@flow-state-dev/server": minor
"@flow-state-dev/patterns": patch
---

Add `.waitForCondition(predicate, { timeoutMs })` to the sequencer DSL for event-driven suspension on the request item stream. Ships with three predicate helpers — `whenResourceChanged`, `whenResourceMatching`, and `whenAnyItem` — exported from `@flow-state-dev/core/items`. The server's `ResponseEmitter` now exposes `subscribeToItems(listener)` so callers can fan out item lifecycle events. The task-board pattern's worker idle-wait is rewired to use `.waitForCondition`, replacing the previous busy-poll and dramatically reducing per-iteration trace noise on quiet boards.
