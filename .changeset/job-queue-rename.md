---
"@flow-state-dev/engine": minor
"@flow-state-dev/bullmq": minor
---

The queue integration is now called a job queue, so its names no longer collide with Workforce workers (FIX-2751). This is a breaking rename with no aliases.

- **engine:** the `createFlowState` option `worker` is now `jobQueue`. Passing `worker` throws and names `jobQueue`. `WorkerAdapter` is `JobQueueAdapter`, `WorkerMode` is `JobQueueMode`, and `WorkerHandle` is `ProcessingHandle`. The adapter's `startWorker(runtime)` method is `startProcessing(runtime)`.
- **engine:** the modes are `"enqueue-only"` (was `"dispatch-only"`), `"process-only"` (was `"worker-only"`) and `"colocated"`. An unknown mode throws at `createFlowState` rather than running as `colocated`.
- **bullmq:** `bullmqWorker(...)` is `bullmqJobQueue(...)`, with `BullmqJobQueueOptions` and `BullmqJobQueueAdapter`. The lower-level factories follow: `createFlowWorker` is `createJobProcessor` (with `CreateJobProcessorOptions` and `JobProcessorDeps`), `createWorkerRunner` is `createJobQueueRunner` (with `CreateJobQueueRunnerOptions`), `resolveWorkerConnection` is `resolveProcessorConnection`, and the runtime handle's `createWorker` is `createJobProcessor`. From `@flow-state-dev/bullmq/schedules`, `createScheduleDispatchWorker` is `createScheduleDispatchProcessor`. The `@flow-state-dev/bullmq/worker` subpath is `@flow-state-dev/bullmq/job-processor`.

To migrate: `createFlowState({ jobQueue: bullmqJobQueue({ connection, mode: "enqueue-only" }) })`, and rename any `FSD_WORKER_MODE`-style environment switch to the new mode values.

Docs: packages/bullmq/README.md (the `jobQueue: bullmqJobQueue(...)` setup, the three modes, `createJobProcessor`, `createJobQueueRunner`, `resolveProcessorConnection`, `createScheduleDispatchProcessor`, the `./job-processor` subpath row), packages/engine/README.md (the `JobQueueAdapter` / `ProcessingHandle` / `JobQueueMode` entry and the `jobQueue` option), packages/core/README.md (the queue example), packages/claude-code/README.md (`JobQueueAdapter.leaseBackend`), apps/docs/guides/background-jobs-bullmq.md, apps/docs/guides/background-work.md, apps/docs/guides/keeping-a-flow-running.md, apps/docs/docs/configuration/runtime.md (the `jobQueue` option and the mode table), apps/docs/docs/server/background-work.md, apps/docs/docs/cli/overview.md (the `process-only` section and its anchor), apps/docs/docs/advanced/concurrency-policies.md, apps/docs/docs/tools/claude-code-sdk.md. Say "job queue" in prose where these pages say "worker adapter" or "queue worker".
