---
"@flow-state-dev/bullmq": patch
"@flow-state-dev/server": patch
---

Add BullMQ adapter for durable background jobs, worker dispatch, and cron scheduling. Setup is one option: `createFlowState({ worker: bullmqWorker({ connection }) })` wires the queue, dispatcher, worker, and stream bridge against the same resolved runtime, with `mode` selecting colocated / dispatch-only / worker-only topologies. Introduces the `WorkerAdapter` contract plus `FlowDispatcher` and `StreamBridge` interfaces in server for pluggable execution backends. Retry attempts re-run under the same requestId resume event sequence numbering (`runAction` accepts `startSequenceNumber`), and the worker publishes an error terminal only when BullMQ will not retry the job.
