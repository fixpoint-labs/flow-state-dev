---
"@flow-state-dev/workforce": patch
---

A worker flow's registration can name the settings a user may see: `workerFlows: { coder: { flow, showSettings: ["harness"] } }`, or `workerFlow(build, { showSettings })`. Each `roster()` row gains `settings`, which holds only those keys with the worker's own values, for standard workers and a user's own alike (`{}` when its flow shows none). Every other setting stays on the server. `hireWorkforce` refuses a name the flow's `configSchema` doesn't declare, a key every worker carries, or a key the hire reads itself (FIX-2281).
