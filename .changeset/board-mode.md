---
"@flow-state-dev/orchestration": minor
---

A task board declares whether its drain waits on its tasks: `taskBoard({ mode })`, `"plan"` by default, or `"delegation"`, read back as `board.mode` (with `board.onReview` beside it). A plan board runs every task inline and waits on each; a delegation board hands every task to another session through a dispatcher assignee and waits on none. `taskBoard()` refuses a board whose assignees contradict its mode, naming the fix, and `goalSeekLoop()` refuses a delegation board and an `onReview: "exit"` board (FIX-2076).

Migration, at upgrade, for teams outside the repo:

- A board with a dispatcher assignee adds `mode: "delegation"`, the fix its refusal names. A board that mixed inline and dispatching assignees splits into a plan board and a delegation board.
- `dispatchedTaskPredicate` is removed: use the board's `mode`.

The task tools now answer a wrapping ref's own refusal, `TaskWriteRefusedError` (exported from `@flow-state-dev/orchestration/tasks`), as a soft `{ ok: false, error: "<code>: <message>" }`, with nothing written.
