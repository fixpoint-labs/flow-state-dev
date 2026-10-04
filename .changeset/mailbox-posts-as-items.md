---
"@flow-state-dev/workforce": minor
---

A mailbox `post` now keeps the line as one `mailbox-post` component item on the mailbox's session (`MAILBOX_POST_COMPONENT`), so a page can render the transcript from the session's items. The post resolves only once that item is stored, and fails if the write does. New posts no longer land in `state.transcript`; `read` returns the lines already there first, then the posted ones inside the session's history window (50 requests by default). A mailbox kind of your own keeps and reads its lines the same way with `emitMailboxPostLine` and `readMailboxPostLines`. A message sent to an `agent` seat's `run` is now kept as the caller's turn in that seat's conversation (FIX-1585).
