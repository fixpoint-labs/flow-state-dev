---
"@flow-state-dev/workforce": patch
---

Add `wakeMemberSeats(seats, { fallback? })`, a notify block for `defineChannelFlow` that wakes each channel member whose hired seat declares the internal `onChannelPost` entry. Each woken seat runs once per post, in one conversation per channel keyed `channel:<channelId>`. A post with an `author` wakes nobody. Members whose seat can't hear a post get the optional `fallback` block, or nothing. Members are matched on the seat's `seatId`, so a seat the boot reload mints at `<org>.<seatId>` wakes too (FIX-1602).
