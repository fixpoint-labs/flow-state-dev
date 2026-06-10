---
"@flow-state-dev/bullmq": patch
"@flow-state-dev/server": patch
---

Add BullMQ adapter for durable background jobs, worker dispatch, and cron scheduling. Introduces FlowDispatcher and StreamBridge interfaces in server for pluggable execution backends. Retry attempts re-run under the same requestId resume event sequence numbering (`runAction` accepts `startSequenceNumber`), and the worker publishes an error terminal only when BullMQ will not retry the job.
