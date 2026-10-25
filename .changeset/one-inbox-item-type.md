---
"@flow-state-dev/orchestration": patch
---

New `@flow-state-dev/orchestration/inbox` subpath, safe to import in a browser: the read an Inbox lists from (FIX-2133).

- `inboxItems` builds one item type for everything waiting on a user. Each task row that waits on the user gets one item, and its run's stop never lists a second time. Each suspension no row claims gets one item too.
- Each item carries an `answerable` flag.
- `createInboxClient(client).answer(item, answer)` is the one answer call. It routes a suspension to the engine's answer route.
- `reconcileInbox` checks a list against `suspensionTruthOf` and `rowTruthOf`. It reports missing, duplicate, orphan, drift, unanswerable and reopened items.
- The package now depends on `@flow-state-dev/client`.
