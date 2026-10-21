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
| `updateTask`'s `taskId`, `patch` (FIX-2080's interim `patch.status` included), `addLabel`, `removeLabel` | Flat input: `updateTask({ id, priority, labels, status, … })`; `labels` replaces the list | FIX-2081 |
| `addDelegate`, `removeDelegate`, `setFallback` on every coordinator | `managesOwnDelegates: true` in the coordinator's `WORKER.md`; otherwise the user edits the list | FIX-2081 |
| A task session's reach to the whole roster | `delegates: [ … ]`, or `delegates: all` | FIX-2081 |
| `assignTask` | `assignee` at filing, or `updateTask({ assignee })` before it starts | FIX-2081 |
| `cancelTask` | `updateTask({ status: "cancelled" })` | FIX-2081 |
| `completeTask`, `failTask` | Return or throw: the claim gate records the ending | FIX-2081 |
| `blockTask`, `TaskCollection.block`, `unblock` | `updateTask({ status: "held" })` and `"pending"` before it starts; `waitForUser` after | FIX-2080 |
| `TaskCollection.reopen` | A follow-up: `createTask({ goal, followUpOf: id })` | FIX-2086 |
| `Task.reopened` and the worker input's `reopened` | A follow-up, which carries `followUpOf` | FIX-2086 |
| The `reopened` change kind | Nothing: a follow-up is a new task, with its own changes | FIX-2086 |
| `Task.parkedForTurn` and `awaitReview`'s `forTurn` | `updateTask({ id, message })`: a steer parks nothing | FIX-2086 |
| A board's `reopenIn` (harness manager) | A follow-up: `createTask({ followUpOf })` | FIX-2086 |
| `harnessMessageDoor`, `messageDoorInputSchema`, `messageDoorOutputSchema`, a manager's `messageDoor` | `updateTask({ id, message })` on the run's task; a line in an open task's session is a steer through the coding flow's own door (`message`, `respond` after FIX-2084) | FIX-2086 |
| `TurnRefused`, `TurnRefusalReason`, and the types `HarnessMessageDoorOptions`, `MessageDoorAction`, `MessageDoorBoard`, `MessageDoorOptions`, `MessageDoorOutput`, `DoorRunIdentity` | `updateTask`'s refusal, which names the rule | FIX-2086 |
| `DELEGATED_POST_ENTRY` | A routed task through `WORKER_TASK_ENTRY` | FIX-2083 |
| `settleSplitTask` | Nothing: a split task stays running, and the claim gate settles it when a request for it ends with no piece open | FIX-2077 |
| A split task's `{ answer, pieces }` output | The latest `reportProgress` checkpoint, else the worker's last answer; a piece's result from its own row, through FIX-2081's `listTasks({ filedByTask })` | FIX-2077 |
| A failed piece failing its task, and the retry marker (`retryOf`) | The worker's turn decides: throw to fail the task, or file a new piece. A turn that ignores a failed piece completes the task | FIX-2077 |
| The agent worker's `run` entry | `respond` | FIX-2084 |

Behaviour that changes without a removed name, carried by the owner's changeset the same way.
Behaviour lines live here, not in the table above: whichever of FIX-2080 and FIX-2081 merges
second moves FIX-2080's behaviour rows into this table.

| Changed | Now | Owner |
|---|---|---|
| `updateTask` on a started or finished task | Refused, naming the field and the state; a started task takes only a cancel, and a message steer once FIX-2086 lands | FIX-2081 |
| Reassigning a running task | Refused: cancel it and file it again | FIX-2081 |
