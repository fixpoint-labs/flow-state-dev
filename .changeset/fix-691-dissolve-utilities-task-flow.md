---
"@flow-state-dev/core": patch
"@flow-state-dev/tasks": patch
"@flow-state-dev/patterns": patch
---

`@flow-state-dev/core` now exports the tool-result memoization primitives directly — `createToolCacheCapability`, `createInMemoryToolCacheStore`, `bindToolCacheStore`, and the `ToolCacheStore` / `ToolCacheEntry` types — colocated with the substrate that consumes them.

`@flow-state-dev/tasks` now exports the observation ledger and per-task flow-policy selectors directly — `flowPolicy`, `createObservationLedger`, `createObservationLedgerCapability`, `bindObservationLedger`, `formatPriorWork`, and the `TaskFlowPolicy` / `TaskPriorWork` / `Observation` / `ObservationLedger` / `ObservationLedgerView` types — alongside the task substrate that shapes `TaskWorkerInput.priorWork`.

`@flow-state-dev/patterns` now reaches the tool-cache and flow-policy layers through `@flow-state-dev/core` and `@flow-state-dev/tasks` directly. Public pattern APIs (`taskBoard`, `planAndExecute`, `supervisor`) are unchanged.
