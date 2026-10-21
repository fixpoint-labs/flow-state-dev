# FIX-2056 · Migration lines

[Spec](SPEC.md) · [Decisions](DECISIONS.md)

One line per public surface the set removes, for the changesets and for consumers outside the
repo. Each is removed outright in its owner's PR, with no deprecation release, in a minor bump
([(e)](DECISIONS.md#e)); that PR's changeset carries the row's line and says teams outside the
repo rewrite at upgrade. Each tool's `<tool>_tasks` action follows its tool. Shift Manager's
`errorCapture` is not here: it is kept ([(f)](DECISIONS.md#f)).

| Removed | Use instead | Owner |
|---|---|---|
| `addTask` | `createTask({ …, held: true })` to file without starting; `updateTask({ id, status: "pending" })` releases it | FIX-2081 |
| `dispatchTask` | `createTask`; `{ taskId }` is `updateTask({ id, status: "pending" })`; `{ taskId, assignee }` is `updateTask({ id, assignee })`; wait with `getTask({ id, wait: true })`; a coordinator files a routed task | FIX-2082 removes the wait form, FIX-2083 the post form; the later removes the tool ([FIX-2081 D1](../../issues/FIX-2081/DECISIONS.md#d1)) |
| `readTask({ taskId })` | `getTask({ id })` | FIX-2081 |
| `updateTask`'s `taskId`, `patch`, `addLabel`, `removeLabel` | Flat input: `updateTask({ id, priority, labels, … })`; `labels` replaces the list | FIX-2081 |
| `addDelegate`, `removeDelegate`, `setFallback` on every coordinator | `managesOwnDelegates: true` in the coordinator's `WORKER.md`; otherwise the user edits the list | FIX-2081 |
| A task session's reach to the whole roster | `delegates: [ … ]`, or `delegates: all` | FIX-2081 |
| `assignTask` | `assignee` at filing, or `updateTask({ assignee })` before it starts | FIX-2081 |
| `cancelTask` | `updateTask({ status: "cancelled" })` | FIX-2081 |
| `completeTask`, `failTask` | Return or throw: the claim gate records the ending | FIX-2081 |
| `blockTask`, `TaskCollection.block`, `unblock` | `updateTask({ status: "held" })` and `"pending"` before it starts; `waitForUser` after | FIX-2080 |
| `TaskCollection.reopen` | A follow-up: `createTask` in the task's session | FIX-2086 |
| `DELEGATED_POST_ENTRY` | A routed task through `WORKER_TASK_ENTRY` | FIX-2083 |
| `settleSplitTask` | Nothing: a split task stays running, and the claim gate settles it when a request for it ends with no piece open | FIX-2077 |
| A split task's `{ answer, pieces }` output | The worker's last answer; a piece's result from its own row, through FIX-2081's `listTasks` | FIX-2077 |
| A failed piece failing its task, and the retry marker (`retryOf`) | The worker's turn decides: throw to fail the task, or file a new piece. A turn that ignores a failed piece completes the task | FIX-2077 |
| The agent worker's `run` entry | `respond` | FIX-2084 |

Behaviour that changes without a removed name, carried by the owner's changeset the same way:

| Changed | Now | Owner |
|---|---|---|
| `updateTask` on a started or finished task | Refused, naming the field and the state; a started task takes only a cancel | FIX-2081 |
| Reassigning a running task | Refused: cancel it and file it again | FIX-2081 |
