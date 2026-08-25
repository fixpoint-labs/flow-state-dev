---
"@flow-state-dev/orchestration": patch
---

A task board on a custom `TaskCollectionRef` no longer abandons its other tasks when the store ignores the advisory write-back guards (FIX-964). `taskBoard({ collection: (ctx) => ... })` is a documented extension point, and a store that takes `(id, output)` satisfies the interface structurally — JavaScript drops the third argument in silence, nothing typechecks it, and the first time a worker's result arrived after its task was settled the store threw, the throw escaped the board's per-worker rescue, and every sibling task was left `pending` forever.

Containment now lives in the substrate's own write-back rather than in the store. Both advisory writers — the board's result recorders and `dispatchAndExecuteBlock`, which is handed a ref directly and so has no factory to check at — snapshot the task, attempt the write with the caller's options unchanged, and on a throw ask whether a conforming store would have declined the call before committing anything. If so the late result is dropped and the drain continues; if not the error propagates exactly as before.

The guarantee is board survival, not equivalence, and the limit is worth knowing: it fires on a throw, so a stale write the state machine happens to permit still commits and still overwrites the current holder's result. Honouring the guards is now about your tasks' outcomes being true rather than about the board staying alive. A store outage on a task the worker still holds, a missing task, and a write that committed and then failed on the way out all propagate unchanged — containment is scoped to task-state conflicts, not a blanket error suppressor. Nothing changes for a board on either built-in backing.
