---
"@flow-state-dev/core": patch
"@flow-state-dev/testing": patch
"@flow-state-dev/memory": patch
"@flow-state-dev/orchestration": patch
"@thought-fabric/core": patch
---

Add `updateStateWith(ref, updater)` and `withOutcome(run, updater)` to
`@flow-state-dev/core/helpers`, for a state update whose callback needs to report
what it did. The updater returns `{ state, result }`, and the helper hands back
the `result` from the invocation that committed — or `undefined` if none did — so
a write retried after a conflict reports the attempt that was saved rather than
an earlier one that was discarded.

Memory, identity/perspective, the graph edge store, and both task-collection
backings now use it. Single-invocation behaviour is unchanged; what changes is
what these helpers report on a retried write. `evict`, `pin`, `unpin`, `refresh`
and the perspective helpers no longer return `true` for an entry they did not
touch; the memory janitor's culled and marked ID lists no longer accumulate
across attempts; and a task write no longer reports `recorded` or emits a
`task-change` for an attempt that lost — including the claim path, which could
report one task as claimed to two workers.

`@flow-state-dev/testing` gains `createReplayingRef`, a test double that invokes
an updater twice so this class of defect is testable.
