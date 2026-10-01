---
"@flow-state-dev/workforce": minor
---

Each seat's inventory row now names its **door**, the action that takes a person's message: the one public action its kind declares with `userMessage` and a `{ message }` input. A kind with none publishes `door: null`. A kind with two also publishes `null`, and the hire warns, naming both. `openInventory` reads the door from the hired seats you pass it, so a seat passed as a bare `{ id, kind }` is registered with no door. Also exports `seatDoorOf(seat)`.

Rows written before this read `door: null` until the next boot rewrites them.
