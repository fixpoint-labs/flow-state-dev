---
"@flow-state-dev/engine": patch
---

A worker adapter can now supply an ordered-lease backend (`WorkerAdapter.leaseBackend`, typed `ConcurrencyLeaseBackend`: `take`, `isMyTurn`, `giveBack`, `renew`) for the engine's concurrency arbiter to keep its lines in, so a session's `queue` / `reject` policy can hold across every process of a deployment. The arbiter keeps the policy; the backend only orders places on a key. With one supplied, work handed to the adapter's queue takes its place before it is enqueued and carries it on the job (`DispatchEnvelope.leasePlace`), a `reject` refusal reaches HTTP and webhook callers through acceptance with the same 409 / `200 skipped` answer as before, and a delivery into an existing session is accepted instead of refused `external-dispatcher`. `createInMemoryLeaseBackend` (the default) and `planQueueWait` (the wait-or-time-out step a worker uses while a job waits its turn) are exported for adapter authors.

No shipped adapter supplies a backend yet, so nothing changes for existing deployments: without one, external dispatch is unarbitrated as before and a delivery into an existing session is still refused `external-dispatcher` (FIX-1634).
