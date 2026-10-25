---
"@flow-state-dev/orchestration": patch
---

New `@flow-state-dev/orchestration/inbox` subpath, safe to import in a browser: the read an Inbox lists from (FIX-2133).

- `inboxItems` builds one item type for everything waiting on a user. Each task row that waits on the user gets one item, and a stop in its run never lists a second time. Each suspension no open task's run holds gets one item too.
- Each hold carries an `answerable` flag, and an item is answerable when any hold is.
- `createInboxClient(client).answer(item, answer)` is the one answer call. The answer is typed by what the hold asks (`InboxAnswerFor`). A suspension's answer goes to the engine's answer route.
- The package now depends on `@flow-state-dev/client`.
