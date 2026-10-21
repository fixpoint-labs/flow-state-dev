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
| The `"blocked"` task status, and `"blocked"` in `listTasks`' status filter | `"held"` | FIX-2080 |
| `Task.undispatched`, `TaskInit.undispatched` | `held` | FIX-2080 |
| Change kinds `blocked`, `unblocked` | `held`, `released` | FIX-2080 |
| The board's `counts.blocked` | `counts.held` | FIX-2080 |
| `createCascadeSkipDependents` | Nothing: every board cancels a failed or cancelled row's dependents | FIX-2080 |
| A follow-up into a busy session being refused | Nothing: it waits, then starts in that session when the open task ends | FIX-2080 |
| A dependency on another board, waiting for good | Refused at filing: cross boards with a wait or a held task | FIX-2080 |
| Plan-and-execute and supervisor cascading only a failed step | A cancelled step's dependents are cancelled too, with the same `skipped` label | FIX-2080 |
| `TaskCollection.reopen` | A follow-up: `createTask` in the task's session | FIX-2086 |
| `DELEGATED_POST_ENTRY` | A routed task through `WORKER_TASK_ENTRY` | FIX-2083 |
| `settleSplitTask` | Nothing: a split task stays running, and the claim gate settles it when a request for it ends with no piece open | FIX-2077 |
| A split task's `{ answer, pieces }` output | The worker's last answer; a piece's result from its own row, through FIX-2081's `listTasks` | FIX-2077 |
| A failed piece failing its task, and the retry marker (`retryOf`) | The worker's turn decides: throw to fail the task, or file a new piece. A turn that ignores a failed piece completes the task | FIX-2077 |
| The agent worker's `run` entry | `respond` | FIX-2084 |
