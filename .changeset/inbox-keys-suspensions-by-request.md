---
"@flow-state-dev/orchestration": patch
"@flow-state-dev/shift-manager": patch
---

The Inbox keys a stop by its request and its suspension (FIX-2850). A suspension id is unique only within its request, so two requests that both stop on `suspend({ suspensionId: "approve-deploy" })` are now two Inbox items, each answered in its own request. Before, one of the two was dropped.

- **Breaking: a suspension hold's id.** `InboxHold.id` for a stop, and the item id of a stop no task holds, is `suspensionHoldId(requestId, suspensionId)`, newly exported from `@flow-state-dev/orchestration/inbox`. It was the bare suspension id. Read `hold.source.suspensionId` for the suspension itself. The Inbox check's `TaskTruth.suspensionHolds` and `closed` take the same hold ids.
- **Shift Manager's Inbox links.** `/inbox/<id>` opens an item by its id or by one of its holds' ids. A link naming a bare suspension id opens nothing.

Docs: none; no page names a suspension hold's id.
