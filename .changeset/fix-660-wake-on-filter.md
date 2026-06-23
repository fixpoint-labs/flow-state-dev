---
"@flow-state-dev/core": minor
"@flow-state-dev/engine": minor
"@flow-state-dev/tasks": minor
"@flow-state-dev/patterns": minor
---

Add an optional `wakeOn` filter to `.waitForCondition` (forwarded as a per-listener `filter` on `ResponseEmitter.subscribeToItems`) so high-fanout patterns can skip predicate re-evaluation on irrelevant item events. `@flow-state-dev/tasks` ships `onTaskChangeFor(collectionId)` as the canonical filter for collection-bound waiters; the `taskBoard` worker idle-wait uses it to ignore `resource_change` and `block_trace` churn. `eventActors` default `concurrency` drops from 16 to 4 to align with peer patterns; callers wanting more can still pass an explicit value.
