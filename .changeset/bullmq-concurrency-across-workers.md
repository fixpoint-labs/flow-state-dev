---
"@flow-state-dev/bullmq": minor
"@flow-state-dev/engine": minor
---

On a `bullmqWorker` deployment, a declared `queue` or `reject` concurrency policy is now enforced across every web and worker process, for every run: two `queue` runs into one session run one after the other in the order they were accepted, and a `reject` duplicate is refused. If you declared `queue` or `reject` on a BullMQ app and relied on it being ignored there, declare `concurrency: "allow"` on those entries to keep running in parallel. Upgrade workers before the processes that enqueue: a new job taken by an old worker runs once without the policy, and its session can wait up to `leaseMs` (10 seconds by default) before the next run starts.

A `dispatcher()` delivery into an existing session (`session: { id }`) is accepted on BullMQ and runs under the recipient's policy, where it was refused `external-dispatcher`. A waiting job gives its worker slot back and requeues itself without using an attempt. The lease backend lives on the same Redis (`createRedisLeaseBackend`, new option `leaseMs`). A worker that can't renew the place its running job holds aborts the run's signal at half the lease, and the request ends `interrupted`; a run that honours the signal has ended before another can take the session.

For custom lease backends, `isMyTurn` may answer `"missing"` (the waiter is re-admitted at the back of the line), `renew` may answer `false` (a running holder is stopped), and a backend may declare `leaseMs`. The engine exports `holdLeasePlace`, `settleUnstartedRequest` and `ConcurrencyLeaseLostError` for adapter workers (FIX-1634).
