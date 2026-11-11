---
"@flow-state-dev/bullmq": minor
---

A flow dispatched to a BullMQ worker no longer holds its streamed events, or its Redis connections, after the run is over (FIX-2677).

- **bullmq:** `createRedisStreamBridge`'s subscriber keeps no events until `events()` is called. Events published before that are dropped rather than buffered, so a dispatch whose events nobody reads no longer grows with every item update. Read `events()` before the run starts if you need every event; late readers recover from the store, as before.
- **bullmq:** `createWorkerRunner`'s `finished` settles when the job has ended in BullMQ (completed, failed for good, or removed) even if the worker's terminal message never arrived: with the job's own return value when it completed, or an error carrying the job's failure reason. The runner checks the job's state every 10 seconds (`DEFAULT_LEASE_MS`). The subscriber and its two Redis connections close either way. A job still waiting, delayed for a retry, or running keeps the dispatch open.

Docs: packages/bullmq/README.md (the stream bridge section: `events()` buffers only from its first call; the runner section: `finished` also settles from the job's end state, checked every `DEFAULT_LEASE_MS`).
