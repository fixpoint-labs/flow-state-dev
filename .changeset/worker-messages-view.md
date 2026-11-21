---
"@flow-state-dev/workforce": minor
"@flow-state-dev/core": minor
"@flow-state-dev/engine": minor
---

A screen can show a worker's open messages without reading the whole message log, and when a session's last turn ended, failed turns included (FIX-2771).

- **workforce:** `workerMessagesViewRef()` is a view on the roster flow at user scope, read with `useView(workerMessagesViewRef(), { worker, ids })` or `client.view(...)`. It answers the worker's open messages, sent or received: each one still on its way (`unconfirmed`), and each one whose sender asked for a reply that hasn't come and that was neither refused nor undeliverable (`isOpenMessage`, from `@flow-state-dev/workforce/browser`, is that rule). For each of `ids` (the messages a screen has on screen, at most 50) it also answers that message's row and its answer, open or not, so a line can say whether it was answered. Rows are the message log's own schema (`WorkerMessageResourceState`), oldest first. Every read is in the caller's own user scope, so another user's worker or message id answers as an unknown one does.
- **workforce:** the message log collection (`workerMessagesCollection`) declares two indexes, `open` and `inReplyTo`, which the view reads through: on SQLite and Postgres an index lookup, never a read of every row. Rows already stored are indexed on the first lookup in each scope; no migration.
- **workforce:** each entry of the session turns view (`sessionTurnsViewRef()`) has `endedAt`: when the turn ended, completed, failed or aborted, `null` while it runs or waits. A failed turn has no `completedAt`, so `endedAt` is the time to read for "last active".
- **core / engine:** a session turn read through the request host (`ctx`'s `sessions.turns`) has `endedAtMs`, when it completed, failed or was aborted; absent while it runs or waits.

Docs: packages/workforce/README.md (the worker messages view and `isOpenMessage`, beside the worker sessions and session turns views; the session turns view's `endedAt`), packages/core/README.md (`SessionTurn.endedAtMs`)
