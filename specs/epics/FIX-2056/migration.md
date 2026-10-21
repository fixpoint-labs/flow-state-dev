# FIX-2056 · Migration lines

[Spec](SPEC.md) · [Decisions](DECISIONS.md)

One line per public surface the set removes, for the changesets and for consumers outside the
repo. Each is removed outright in its owner's PR, with no deprecation release, in a minor bump
([(e)](DECISIONS.md#e)); that PR's changeset carries the row's line and says teams outside the
repo rewrite at upgrade. Each tool's `<tool>_tasks` action follows its tool. Shift Manager's
`errorCapture` is not here: it is kept ([(f)](DECISIONS.md#f)).

| Removed | Use instead | Owner |
|---|---|---|
| `addTask`, `dispatchTask` | `createTask`; wait with `getTask({ id, wait: true })` | FIX-2081 |
| `readTask` | `getTask` | FIX-2081 |
| `assignTask` | `assignee` at filing, or `updateTask({ assignee })` before it starts | FIX-2081 |
| `cancelTask` | `updateTask({ status: "cancelled" })` | FIX-2081 |
| `completeTask`, `failTask` | Return or throw: the claim gate records the ending | FIX-2081 |
| `blockTask`, `TaskCollection.block`, `unblock` | `updateTask({ status: "held" })` and `"pending"` before it starts; `waitForUser` after | FIX-2080 |
| `TaskCollection.reopen` | A follow-up: `createTask` in the task's session | FIX-2086 |
| `DELEGATED_POST_ENTRY`, `delegatedPostEntry`, `delegatedPostHistory`, `delegatedPostOnFinished`, `delegatedPostSchema`, `DelegatedPost` | A routed task through `WORKER_TASK_ENTRY`: declare `work` with `workerTaskEntry`; the turn still gets `{ message }` | FIX-2083 |
| `taskLedgers({ taskTurn })` | Nothing: a routed turn is a task turn | FIX-2083 |
| `defineCoordinatorFlow`'s `delegateFlows`; `defineSessionBoard`'s `postFlows` and `posts`; `posts` and `both` in `listDelegates`' takes | Nothing: a delegate is a worker whose flow takes tasks, checked by its roles at hire | FIX-2083 |
| `TaskCollectionRef.dispatch`, `TaskDispatchOptions`, `Task.dispatchCall`, the `already-dispatched` decline | `createTask`, and `updateTask({ id, status: "pending" })` to release a held row | The later of FIX-2082 and FIX-2083, with `dispatchTask` |
| `settleSplitTask` | Nothing: the claim gate settles a split when its pieces end | FIX-2077 |
| The agent worker's `run` entry | `respond` | FIX-2084 |
