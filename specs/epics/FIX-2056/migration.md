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
| A board's `reopenIn` (harness manager) | A follow-up: `createTask({ followUpOf })` | FIX-2086 |
| `harnessMessageDoor`, `messageDoorInputSchema`, `messageDoorOutputSchema`, a manager's `messageDoor` | `updateTask({ id, message })` on the run's task; a line in an open task's session is a steer through the flow's own door | FIX-2086 |
| `TurnRefused`, `TurnRefusalReason`, and the types `HarnessMessageDoorOptions`, `MessageDoorAction`, `MessageDoorBoard`, `MessageDoorOptions`, `MessageDoorOutput`, `DoorRunIdentity` | `updateTask`'s refusal, which names the rule | FIX-2086 |
| `DELEGATED_POST_ENTRY` | A routed task through `WORKER_TASK_ENTRY` | FIX-2083 |
| `settleSplitTask` | Nothing: the claim gate settles a split when its pieces end | FIX-2077 |
| The agent worker's `run` entry | `respond` | FIX-2084 |
