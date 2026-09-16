---
"@flow-state-dev/workforce": patch
---

`defineAgentWorkerFlow` accepts three new optional options — `uses` for capabilities every worker carries, `afterAnswer` for a block that runs after the answer, and `isolateUserState` to give each worker its own storage — so an app can compose memory or any other capability into the built-in worker kind (FIX-1364).
