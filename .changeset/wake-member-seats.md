---
"@flow-state-dev/workforce": patch
---

Add `wakeMemberSeats(seats, { fallback? })`, a channel notify block that wakes each member whose hired seat declares `onChannelPost`, once per post (FIX-1602).
