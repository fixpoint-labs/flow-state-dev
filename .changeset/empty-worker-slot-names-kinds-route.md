---
"@flow-state-dev/workforce": patch
---

When `readWorkforceDirectory` reports a worker folder that holds no `WORKER.md`, the error names the route for a worker whose behavior differs: define the flow in your app, pass it to `hireWorkforce` in `kinds`, and name it in that worker's `flow:` (FIX-1342).
