---
"@flow-state-dev/orchestration": minor
"@flow-state-dev/workforce": minor
"@flow-state-dev/harness-manager": minor
"@flow-state-dev/shift-manager": patch
---

Words sent into an open task now take one path, `updateTask({ id, message })`, and a finished task's output never changes (FIX-2086).

- **Steer an open task.** `updateTask`'s `message` (tool and `updateTask_<board>` action), sent alone (`message_takes_no_edits` otherwise), keeps the message on the task (`Task.steers`, at most 20; `getTask` lists them as `steers`). A task that hasn't started gets every message in its first brief; a running request takes it before its next model call (`createSteerContext`); a task waiting on work it filed gets a turn now; one that lands after the last model call, even while the task settles, gets one more turn first (`taskLedgers({ endRules: { steerTurn } })`, with `complete`'s new `refuseUntakenSteers` guard, reason `untaken-steers`; on Workforce, `steerTurnEntry` declared under `STEER_TURN_ENTRY`). No attempt is used. A message taken mid-run shows in the task's session as a line from its sender (`showTakenSteers`). The collection write is `TaskCollectionRef.steer`, with `takeSteers` for the request holding the claim; the change kind is `"steered"`.
- **Correct a finished task with a follow-up.** `updateTask({ message })` on a finished task is refused (`task_finished: a finished task takes no message; file a follow-up`). `getTask` shows the latest completed follow-up as `current: { id, output }`, and `listTasks` rows carry `current: { id }`.
- **A line in a task's session.** On the built-in `agent` flow, a line in an open task's session is a steer from the user (`{ steered: <taskId> }`), with no reply beside it; in a finished one it is an ordinary turn and the task doesn't change.
- **Coding runs.** `harnessSessionDoor({ board, harness, onSteered?, talkTimeoutMs? })` is a coding flow's one door: a steer while the task or a follow-up is open, talk (one run resuming the confirmed coding session, outside any attempt, holding the checkout) once all have finished. Its refusals are `not-started`, `cannot-continue`, `steer-limit`, `finished` and `not-supported`, the last three worded as Workforce's door words them (`LINE_STEER_REFUSALS`, `steerFromLine`). A steer reaches the run's next step in the same request and attempt; with `harnessManager({ stopsOnAbort: true })` it stops the running step once the harness has confirmed a session.

**Migration.**

- `TaskCollectionRef.reopen`, `Task.reopened`, the worker input's `reopened` and the `"reopened"` change kind are removed: file a follow-up, `createTask({ goal, followUpOf: id })`. A stored row with `reopened: true` reads unmarked; still open, it carries one steer pointing at the latest line in its session.
- `Task.parkedForTurn` and `awaitReview`'s `forTurn` are removed: send `updateTask({ id, message })`. A stored row parked for a turn reads as `pending`, its next attempt uncharged.
- `harnessMessageDoor`, a manager's `messageDoor`, `messageDoorInputSchema`, `messageDoorOutputSchema`, `TurnRefused`, `TurnRefusalReason`, a board's `reopenIn`, and the types `HarnessMessageDoorOptions`, `MessageDoorAction`, `MessageDoorBoard`, `MessageDoorOptions`, `MessageDoorOutput`, `DoorRunIdentity` are removed: declare `harnessSessionDoor` as the coding flow's `message` action. `harnessManager` now returns a `TaskWorker`.
- The harness manager's `turns` collection is no longer written or read. Run `upgradeKeptTurns(stores, { userCell, ledgers })` once at host start to write each kept line no attempt took onto its task as a steer. Shift Manager's DevTeam host runs it at every start; a second run adds nothing.
