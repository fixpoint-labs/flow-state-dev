# FIX-2056 · Migration lines

[Spec](SPEC.md) · [Decisions](DECISIONS.md)

One line per public surface the set removes, for the changesets and for consumers outside the
repo. Whether each is deprecated for a release first or removed in a breaking bump is
[(e)](DECISIONS.md#open), **pending the owner's answer**. Each tool's `<tool>_tasks` action follows its tool.

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
| `settleSplitTask` | Nothing: the claim gate settles a split when its pieces end | FIX-2077 |
| The agent worker's `run` entry | `respond` | FIX-2084 |
| `errorCapture` into the Error Reporter | Pending [(f)](DECISIONS.md#open) | FIX-2078 |
