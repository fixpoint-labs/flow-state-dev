---
"@flow-state-dev/orchestration": minor
---

Task boards can declare a worker as detached — work that runs outside the request that claimed its task.

A registry value may now be a `{ worker, dispatch }` entry instead of a bare block; `dispatch: { mode: "detached" }` marks that worker's tasks as detached work. A bare block still means inline, so no existing board changes. A uniform-worker board declares the same thing through a board-level `dispatch` field, and `defaultWorker` accepts an entry.

Detachment comes with guards that fire at board construction, loudly and by name, rather than at the first restart:

- an explicit `boardId` is required, because it is hashed into the child session's id
- the collection must be durable (`defineTaskCollection()`); request, sequencer, and caller-supplied factory backings are refused
- a detached worker may not declare `sessionStateSchema`, since detached workers share one execution flow

This release ships the declaration and its guards only. A worker marked detached still runs inline until the spawn lands.
