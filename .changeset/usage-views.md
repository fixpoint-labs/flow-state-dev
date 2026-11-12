---
"@flow-state-dev/harness-manager": minor
"@flow-state-dev/workforce": minor
"@flow-state-dev/shift-manager": patch
---

Subscription usage and worker usage are read as views, with no session, and Re-check is a write through the usage flow (FIX-2624).

- `harnessUsageFlow({ readers, timeoutMs? })` is the flow a host registers once, at `HARNESS_USAGE_FLOW` (`"harness-usage"`). Its `usage` view answers `{ harnesses }`, the same rows as before, and starts nothing. Its `recheck` action asks each reader, at most once a minute per user and harness, stores the reading, and answers `{ asked }`, the harnesses asked this time.
- `harnessUsageCollection` (`harness-usage/**`) now names that flow as its `runBy` and allows a client read of the caller's own rows. A client re-checks by sending `recheck` to the collection, which runs in the caller's own write session; no session is named or made by the client.
- From `@flow-state-dev/harness-manager/browser`: `harnessUsageViewRef()`, for `client.view(ref, {})` or `useView(ref)`, and `recheckHarnessUsage(client)`. `HarnessUsageViewDefinition` is the view's type.
- `harnessUsageAction` is removed, with no alias, and so are `harnessSessionFlow`'s `harnessUsage` action and its `usageReaders` option. Register `harnessUsageFlow({ readers })()` beside your flows instead, and read with `client.view(harnessUsageViewRef(), {})`; replace `{ refresh: true }` with `recheckHarnessUsage(client)` before the read. A harness session flow still records the windows its runs report.
- The roster flow serves a `workerUsage` view (`WORKER_USAGE_VIEW`), each worker's tokens over `{ days? }`, answered at user scope with no session; `workerUsageView` from `@flow-state-dev/workforce/browser` is its handle and `WorkerUsageViewDefinition` its type. `hireWorkforce` installs it, so every app with a roster flow has it. `workerUsageAction` and `WORKER_USAGE_ACTION` are removed, with no alias: drop the action from your flow and read the view.
- Shift Manager's Usage reads both views and opens no reading or usage session of its own.

Docs: apps/docs/docs/orchestration/harness-manager.md ("Subscription usage": register `harnessUsageFlow`, read the view, Re-check with `recheckHarnessUsage`; the collection is client-readable and written through its `runBy`; drop `harnessUsageAction`), apps/docs/docs/workforce/worker-usage.md (the roster flow's `workerUsage` view in place of `workerUsageAction`), apps/docs/docs/shift-manager/overview.md (the usage and worker usage prerequisites: the usage flow and the roster flow, not actions), packages/harness-manager/README.md, packages/workforce/README.md and packages/shift-manager/README.md (the same swaps in their API lists).
