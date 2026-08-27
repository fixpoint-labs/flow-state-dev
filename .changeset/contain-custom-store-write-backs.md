---
"@flow-state-dev/orchestration": patch
---

A task board built on a custom `TaskCollectionRef` no longer loses its remaining tasks when the store ignores the advisory write-back guards (FIX-964). `taskBoard({ collection: (ctx) => ... })` is a documented extension point, and a store written as `complete(id, output)` satisfies the interface structurally — JavaScript drops the guards argument in silence and nothing typechecks it. The first time a worker's result arrived after its task had been settled by someone else, such a store threw, the throw escaped the board's per-worker rescue, and every sibling task was left `pending` forever. The board now contains that write-back conflict and finishes its other work.

**The guarantee is narrow, and worth knowing before you rely on it.** It contains a *throw* the substrate can attribute to a conflict a conforming store would have declined. A stale write the state machine happens to permit still commits and still overwrites the current holder's result, because it raises no error to contain. A store outage on a task the worker still holds, and a write that commits and then fails on the way out, still propagate. Honouring the guards is now about your tasks' outcomes being correct rather than about the board staying alive.

Nothing changes for a board on either built-in backing.
