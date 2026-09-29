---
"@flow-state-dev/engine": patch
"@flow-state-dev/scheduled": patch
"@flow-state-dev/mcp": patch
---

A worker adapter can now supply an ordered-lease backend (`WorkerAdapter.leaseBackend`, typed `ConcurrencyLeaseBackend`: `take`, `isMyTurn`, `giveBack`, `renew`) for the engine's concurrency arbiter to keep its lines in, so a session's `queue` / `reject` policy can hold across every process of a deployment. The arbiter keeps the policy; the backend only orders places on a key. With one supplied, work handed to the adapter's queue takes its place before it is enqueued and carries it on the job (`DispatchEnvelope.leasePlace`), a `reject` refusal reaches callers through acceptance with the same answer as before (HTTP 409, webhook and scheduled `200 skipped`, MCP server-busy), and a delivery into an existing session is accepted instead of refused `external-dispatcher`. `createInMemoryLeaseBackend` (the default) and `planQueueWait` (the wait-or-time-out step a worker uses while a job waits its turn) are exported for adapter authors.

No shipped adapter supplies a backend yet, so nothing changes for existing deployments: without one, external dispatch is unarbitrated as before and a delivery into an existing session is still refused `external-dispatcher` (FIX-1634).

A scheduled dispatch is now acknowledged only once the host has accepted it: a fire whose acceptance fails answers 503 and is not remembered as delivered, so a retry of it still runs.
