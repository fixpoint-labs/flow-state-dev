---
"@flow-state-dev/engine": patch
"@flow-state-dev/bullmq": patch
---

External dispatch: requests are now registered in the store at enqueue time, so SSE clients can attach via `GET /requests/:id/stream` immediately instead of 404ing while the worker spins up. Applies to all external dispatchers (BullMQ today); transparent to user code.
