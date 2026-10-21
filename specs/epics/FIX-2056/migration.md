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
| `DELEGATED_POST_ENTRY` | A routed task through `WORKER_TASK_ENTRY` | FIX-2083 |
| `createScheduledTransportAdapter`'s `idempotencyWindowMs` | Nothing: the dispatch endpoint fires each scheduled time at most once, recorded in the host's store | FIX-2085 |
| `createScheduledTransportAdapter`'s `idempotencyOptions` (the cache's test seam) | Nothing: it goes with the cache | FIX-2085 |
| The dispatch request body's `idempotencyKey` | Nothing: the scheduled time is the key. A body that sends one is refused with `400` | FIX-2085 |
| `settleSplitTask` | Nothing: a split task stays running, and the claim gate settles it when a request for it ends with no piece open | FIX-2077 |
| A split task's `{ answer, pieces }` output | The worker's last answer; a piece's result from its own row, through FIX-2081's `listTasks` | FIX-2077 |
| A failed piece failing its task, and the retry marker (`retryOf`) | The worker's turn decides: throw to fail the task, or file a new piece. A turn that ignores a failed piece completes the task | FIX-2077 |
| The agent worker's `run` entry | `respond` | FIX-2084 |

Behaviour that changes without a removed name, carried by the owner's changeset the same way:

| Changed | Now | Owner |
|---|---|---|
| A scheduled fire for a time already fired, or earlier than one that has | Answered `200` with status `duplicate`, and nothing runs: a late retry of a missed time, or one delivered after the next time fired, never runs ([FIX-2085 D2](../../issues/FIX-2085/DECISIONS.md#d2)) | FIX-2085 |
