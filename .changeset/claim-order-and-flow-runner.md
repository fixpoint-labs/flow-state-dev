---
"@flow-state-dev/orchestration": minor
"@flow-state-dev/engine": minor
"@flow-state-dev/bullmq": minor
"@flow-state-dev/harness-manager": minor
"@flow-state-dev/testing": minor
---

"Dispatcher" now names only the `dispatcher()` block (FIX-2245). Two other things that shared the word are renamed, with no alias.

- A task board's rule for which ready task it claims next is a claim order. `TaskDispatcher` is `ClaimOrder`; `fifoDispatcher`, `topologicalDispatcher` and `priorityDispatcher` are `fifoClaimOrder`, `topologicalClaimOrder` and `priorityClaimOrder`; harness-manager's `runOwnerDispatcher()` is `runOwnerClaimOrder()`. The task board's option is `claimOrder` (it was `dispatcher`), and takes the same `"fifo"`, `"topological"` and `"priority"` names.
- What decides where a flow action runs is a runner. `FlowDispatcher` is `FlowRunner`, `InProcessDispatcher` and `InProcessDispatcherDeps` are `InProcessRunner` and `InProcessRunnerDeps`, `createInProcessDispatcher` and `isInProcessDispatcher` are `createInProcessRunner` and `isInProcessRunner`, and BullMQ's `createWorkerDispatcher` and `CreateWorkerDispatcherOptions` are `createWorkerRunner` and `CreateWorkerRunnerOptions`. The option on `createFlowState`, `createFlowApiRouter`, `createFlowRouteHandlers` and `createInboundTransportHost` is `runner` (it was `dispatcher`), `WorkerAdapter.createDispatcher` is `createRunner`, and `InboundTransportHost.usesExternalDispatcher` is `usesExternalRunner`.

The `external-dispatcher` refusal keeps its value.
