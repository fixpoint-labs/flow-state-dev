---
"@flow-state-dev/engine": patch
"@flow-state-dev/orchestration": patch
"@flow-state-dev/workforce": patch
---

A session whose worker was fired no longer starts a new request every 30 seconds forever. A refused session is terminal and is never retried (FIX-2849).

- **engine:** a request whose `request.onStarted` throws is now recorded `failed`, with the error, the same way a request that fails during setup is. Before, it stayed `in_progress` until the stale sweep marked it interrupted. A resumed request is still left for the stale sweep to retry, unless the start was refused for good. A stop accepted while `onStarted` ran ends the request `aborted`, as the caller was told. A refusal for good is an error whose `code`, or its `cause`'s, is `worker-turn-refused`. A wake whose run is refused that way is cleared instead of fired again, once it is past its fence (`landBy`). Inside the fence it fires once more, so a debt that lands late keeps a wake. A debt owed after the fire also keeps its wake. Any other failure is still retried.
- **workforce:** when a turn is refused, the session first settles every notice its board still owes it as undeliverable. This happens whether its worker was fired ("its worker was fired") or can no longer run there (for example, it was moved to another flow). The record is the same one a conversation that is gone gets, A task that failed for good is reported to the Error Reporter once, under the board it is on, before its notice is settled. A report the intake doesn't take leaves the notice owed. Every other debt is paid by the board's own repair, as its pass would: a cancel owed, a cascade, a resume owed (the resumed turn is then refused for good and ends `failed`), and reports an older version stored. So are the messages the session sent or owes an answer to. The session then lets its own `dispatch` wake go. A claimed task's lease end keeps no wake: its ending owes a wake of its own. Before, those notices stayed owed. This also covers a task that ends after the refusal started. If the notices can't all be settled, the turn fails with an ordinary error instead, and the wake stays, so the next turn tries again. `WorkerTurnRefusedError` gains `fired`.
- **orchestration:** `undeliverableRecord` is exported from `@flow-state-dev/orchestration/internal`.

A store already stuck in the loop needs no migration. The next time the wake fires, the refused turn settles what it is owed and the wake is cleared.

Docs: none for users; the behaviour change is in the fired-worker note on the Workforce page, which already says a new turn on a fired worker's session is refused.
