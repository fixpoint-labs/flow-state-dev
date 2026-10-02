---
"@flow-state-dev/workforce": minor
---

`createSeatHireBlocks` now also returns `brokenSeats` (the stored seats the start skips, each with a reason: `kind-gone`, `refused` or `unreadable`) and `rehire` (keep a seat that no longer starts at its address, on a kind you name). `fire` now deletes the seat's inventory row after the roster row and the address; called again for a seat whose roster row is gone, it removes the leftover inventory row and answers `alreadyGone: true`, and a roster row that can't be read is deleted by its key with `address: null`. `removeHiredSeat` exports that removal for an app's own fire handler, and `listedSeatRows` (from `@flow-state-dev/workforce/browser`) is the team-list join that hides an inventory row no roster row backs (FIX-1621).
