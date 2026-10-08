---
"@flow-state-dev/core": minor
"@flow-state-dev/engine": minor
---

A turn can park on an ask gate (`parkOnAsk`) and be resumed from its own conversation with the answer, through a new request-host verb, `ctx.requestHost.resumeAsk` (present with durable execution). The public resume route answers not-found for an ask gate. `ctx.suspend()` also accepts a caller-chosen `suspensionId` (FIX-1816).
