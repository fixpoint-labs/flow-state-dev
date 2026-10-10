---
"@flow-state-dev/workforce": minor
---

Each person talks to a project through their own project coordinator (`createWorkerInstallation({ projectCoordinator })`, then `ensureWorkerSession({ worker, projectId })`), whose delegates are their open workstreams there, kept in step by `openWorkstream` and `updateWorkstream`, with `parseWorkstreamEntry` on `@flow-state-dev/workforce/browser` reading an entry the way `readProject` does (FIX-1793).
