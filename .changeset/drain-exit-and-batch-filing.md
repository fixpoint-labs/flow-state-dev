---
"@flow-state-dev/orchestration": patch
"@flow-state-dev/workforce": patch
---

A drain cancels a dependent stuck behind a crash-owed cascade before it decides to exit, and a refused batch files nothing (FIX-2096).

- **Drain.** A board pays a cascade a crash left owed once its workers find nothing to claim, before the exit check. An `onIdle: "complete"` board no longer waits to `maxIterations` on such a dependent, and the completion item's counts match the stored board.
- **`updateTask`** decides a release before it writes anything: a release it would refuse leaves the assignee, priority and labels unchanged.
- **Replan.** A replanned task filed skipped carries `error` and `causedBy`, as a cascade's skip does. `TaskInit` takes both, for a row filed already cancelled.
- **Workforce:** a batch of steps and delegates' tasks is checked whole before anything is filed, and its steps are added after the steps they depend on. A follow-up whose root is filed in the same batch is refused `follow_up_of_unrun`.
