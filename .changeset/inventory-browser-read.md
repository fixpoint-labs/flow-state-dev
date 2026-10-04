---
"@flow-state-dev/workforce": minor
---

The seat, mailbox and membership inventory collections (`defineSeatInventoryCollection`, `defineMailboxInventoryCollection`, `defineMembershipIndexCollection`) declare a browser read. A session on any flow that installs one can list its rows through the collection-state route, for that session's own organization only, with the row's named fields (`id`, `kind` for a seat; `id`, `kind`, `members`, `openedAt` for a mailbox; `seatId`, `mailboxId` for a membership) and nothing else. Every member of an organization can now list its registered seats, mailboxes and memberships from the browser (FIX-1502).
