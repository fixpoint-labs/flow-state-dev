---
"@flow-state-dev/contracts": minor
"@flow-state-dev/core": minor
"@flow-state-dev/engine": minor
"@flow-state-dev/react": patch
"@flow-state-dev/devtool": patch
---

Stopping a request now works while it is paused (`suspended`), on a runtime with durable execution: the abort route and `ctx.session.stopRequest` resolve its pending gate as `stopped` (a new suspension status) and the request ends `aborted`. A turn parked on an ask continues just long enough for the parked call to end what it asked for (`parkOnAsk` throws `AskStoppedError`; `recordedAskOutcome` reads a recorded outcome without parking). A stop that finds the gate already resolved answers `409` / `"already-resolved"`. The durability sweeper now re-drives a request left parked behind a resolved ask gate or a stopped gate, and schedules its next tick at the earliest pending ask deadline (FIX-1816).
