---
"@flow-state-dev/workforce": minor
"@flow-state-dev/orchestration": minor
"@flow-state-dev/engine": patch
---

A worker message lands once (FIX-2240). The recipient's `onMessageReceived` takes a message on its log row before it lands, so a late copy lands nothing, and the sending session's board pass sends a message again, backing off from 2 s to 5 min, until it is delivered, refused or past the host's debt age. A message that can't land after the send returned leaves a line in the sending session, which its next turn reads.

**Migration.** The `sendMessage` tool answers `{ sent }` only: `unconfirmed` is gone, and `SendOutcome` no longer carries it. A log row's `status` is one of `unconfirmed` (on its way), `delivered` (landed in the recipient's conversation, not just accepted by its host), `refused` or `undeliverable`, and gains `toState`, `takenBy`, `deliveredAs`, `deliveredAt`, `resent` and `toldAt`. `dispatch-rejected`, `no-dispatch-operation` and `flow-not-found` are no longer final. The session's 500-id seen window (`workerMessagesSeen`, `messageReceivedStateShape`) is removed. The server function `sendMessage` takes an optional `{ id }`, so a repeated send under one server-chosen id is one message. Orchestration exports the take rule (`takeRule`, `decideTake`, `TakeRule`, `hasEnded`) and the resend backoff (`nextResendAt`, `NOTICE_RESEND_CAP_MS`) its task notices and worker messages share.

The filesystem request store's `flushItems` now rejects when an item write failed, as `flushEvents` does, so a resolved flush means the items are stored.
