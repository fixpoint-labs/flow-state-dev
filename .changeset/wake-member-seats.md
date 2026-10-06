---
"@flow-state-dev/workforce": patch
---

Add `wakeMemberSeats(seats, { fallback? })`, a mailbox notify block that wakes each member whose hired seat declares `onMailboxPost`, once per post (FIX-1602).
