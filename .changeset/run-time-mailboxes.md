---
"@flow-state-dev/workforce": minor
"@flow-state-dev/orchestration": patch
"@flow-state-dev/engine": patch
---

Mailboxes can now be set up (FIX-1779), and their members changed, while the app runs. `openMailboxAtRunTime` gives a host `setUp`, `subscribe` and `unsubscribe`: a mailbox set up this way follows a `MAILBOX.md`'s id rules, holds one `tasks` list in its own session, survives a restart, and is listed by `discover` and accepted by `setWorkstreams`. `subscribe` and `unsubscribe` also work on a file's mailbox, and `taskListWorkers` reads who works one of a mailbox's lists. `wakeMemberSeats` and `routeByPurpose` now take a getter over the host's registry as well as a list, so a worker hired after boot is woken by the next post that names it. If a later `MAILBOX.md` takes the id of a mailbox set up at run time, `openMailboxes` keeps the open mailbox and warns instead of refusing to start. The mailbox inventory row gains `origin` and `description`, both `null` on rows written before.

Task ledgers from `getOrCreateTaskCollection` accept a `keyPrefix`, so several ledgers can share one collection, each over its own keys. A lazily loaded collection's `list(prefix)` now reads only that prefix from the store (FIX-1779).
