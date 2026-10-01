---
"@flow-state-dev/workforce": minor
---

Each seat's inventory row now names its **door** (FIX-1690), the action that takes a person's message: the one public action its kind declares with `userMessage` and a `{ message }` input. A kind with none publishes `door: null`. A kind with two also publishes `null`, and the hire warns, naming both. `openInventory` reads the door from the seats you pass it, and `InventorySeat` now requires `actions`: pass `hireWorkforce`'s seats as they are, or `actions: {}` for a seat you build by hand that takes no message. Also exports `seatDoorOf(seat)`.

Rows written before this read `door: null` until the next boot rewrites them.
