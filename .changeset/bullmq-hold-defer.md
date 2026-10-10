---
"@flow-state-dev/bullmq": patch
"@flow-state-dev/engine": patch
---

BullMQ workers now honour the `hold` and `defer` concurrency policies, which used to run as `allow` once handed to a queue. A `hold` job runs at once and keeps its conversation busy until it ends. A `defer` job waits, by requeueing rather than holding a worker slot, until nothing on its key is running or waiting, then runs; a crashed worker's place frees once its lease runs out. The dispatching process counts a queued `defer` against the 32-per-key cap until its job ends, and checks ownership before either policy takes anything on the key (FIX-1836).

For adapter authors, the engine adds `DispatchEnvelope.leaseTurn` (how a queued job reaches its turn), `planDeferWait` and `DEFER_PATIENCE_MS` (the `defer` wait, shared with the in-process arbiter), and a `budgetMs` option on `planQueueWait`. Roll out workers before the processes that enqueue: an older worker treats a `hold` job as `queue` and runs a `defer` job at once.
