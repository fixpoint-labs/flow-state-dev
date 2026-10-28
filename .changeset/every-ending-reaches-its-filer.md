---
"@flow-state-dev/orchestration": minor
"@flow-state-dev/workforce": minor
"@flow-state-dev/core": minor
---

Every ending of a delegated task reaches the session that filed it once, on any flow, and nothing a board owes waits for someone to touch it (FIX-2078).

- **`onTaskSettled`.** A board that hands rows out records each ending's notice in the ending's own write and sends it to the filing session's `onTaskSettled` internal action. Build that action with `taskSettledEntry({ block })` (exported with `taskSettledInputSchema` from `@flow-state-dev/orchestration`): it takes each notice once, runs your block, and acknowledges it. A filed task now records the session that filed it (`Task.filer`, server-written).
- **Cancels are heard.** A cancel the filer didn't make itself through its own task tool now sends a `cancelled` notice, and a failure or cancel notice names the dependents it cancelled (`cancelled`). A waited-on task resumes its waiter and sends no notice; a retry sends none.
- **Due times.** Each owed notice has a due time, two seconds after its ending (`NOTICE_DUE_MS`). The board's pass resends only what is past due, and on a durable host the engine's wake pays it when due, after a crash too. One pass runs at a time per session; a pass asked for while one runs waits its turn.
- **Workforce:** a final task failure goes to the Error Reporter's intake with its ending, before the notice is acknowledged, as the task occurrence it already dedupes. A report marker stored by an older version is sent once and dropped. A ready row starts on its own, without a touch.
- **Upgrade.** Call `backfillBoardWakes(stores, { userCell })` (`@flow-state-dev/workforce`) once at host start, after the router is built: it owes a wake for every session holding a notice, report or split settle stored before this release, so its pass pays it without a touch. It is idempotent (a wake coalesces, and a pass that finds nothing clears it), and reads every user's conversation rows, so a host with many users runs it once, as a migration step. Shift Manager calls it at start.
- **Core:** `RequestHost.wakes` (owe, read, settle, `maxDebtAgeMs`), present on durable hosts whose stores keep wakes, and `TaskBinding.requiresInternal`.
- **Task tools:** a task's metadata from a caller (a tool call or a `_tasks` action) can't set or clear a notice marker. `cancelTask` answers `{ ok: true, cancelled: [ids] }` when its cancel also cancelled dependents. A notice its entry keeps refusing is resent with a doubling gap, up to 5 minutes.

Migration, at upgrade, for teams outside the repo:

- `resumeOwedWaits` is removed: the board's due-time wake pays an owed resume and a cancel owed.
- A board that hands rows out (a dispatcher assignee, or a delegation board) on a flow with no `onTaskSettled` internal action is refused when the flow is built. Add `internal: { actions: { onTaskSettled: taskSettledEntry({ block }) } }`.
- An `onTaskSettled` handler now receives `cancelled` endings.
