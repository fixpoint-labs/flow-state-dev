---
"@flow-state-dev/orchestration": minor
---

An Inbox suspension may come from a run with no conversation: `InboxSuspension.sessionId` and a suspension hold's `source.sessionId` are `string | null`, and such a hold answers through its flow alone. `InboxSuspension.due` (the ask's deadline) becomes the hold's `due` (FIX-2774).

Docs: apps/docs/docs/orchestration/task-board.md (the Inbox: an ask with no conversation)
