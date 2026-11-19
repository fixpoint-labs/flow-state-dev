---
"@flow-state-dev/engine": patch
"@flow-state-dev/orchestration": patch
"@flow-state-dev/workforce": patch
---

A session whose worker was fired no longer starts a new request every 30 seconds forever. A refused session is terminal and is never retried (FIX-2849).

- **engine:** a request whose `request.onStarted` throws is now recorded `failed`, with the error, the same way a request that fails during setup is. Before, it stayed `in_progress` until the stale sweep marked it interrupted. A wake whose run is refused at its start for good (an error whose `code`, or its `cause`'s, is `worker-turn-refused`) is cleared instead of fired again. A debt owed after that fire keeps its wake. Any other failure is still retried.
- **workforce:** when a turn is refused because its worker was fired, the session first settles every notice its board still owes it as undeliverable, with the detail "its worker was fired". The record is the same one a conversation that is gone gets, and a task that failed for good is still reported to the Error Reporter. The session then lets its own `dispatch` wake go. Before, those notices stayed owed. This covers a task that ends after the firing too.
- **orchestration:** `undeliverableRecord` is exported from `@flow-state-dev/orchestration/internal`.

A store already stuck in the loop needs no migration. The next time the wake fires, the refused turn settles what it is owed and the wake is cleared.

Docs: none for users; the behaviour change is in the fired-worker note on the Workforce page, which already says a new turn on a fired worker's session is refused.
