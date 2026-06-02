/**
 * @flow-state-dev/bullmq — BullMQ host/runtime adapter.
 *
 * Provides durable background jobs, native cron scheduling, and full-flow
 * worker dispatch for long-lived self-hosted FSD deployments. Composes
 * from existing framework seams (runAction, ScheduleIndex, dispatch contract)
 * with FlowDispatcher/StreamBridge interfaces for pluggable execution.
 */
export { createBullmqRuntime } from "./runtime";
export type { BullmqRuntime, CreateBullmqRuntimeOptions } from "./runtime";
export { createFlowWorker } from "./worker";
export type { FlowWorkerDeps, CreateFlowWorkerOptions } from "./worker";
export { createWorkerDispatcher } from "./dispatcher";
export type { CreateWorkerDispatcherOptions } from "./dispatcher";
export { createRedisStreamBridge } from "./stream-bridge";
export type { CreateRedisStreamBridgeOptions } from "./stream-bridge";
export { createBullmqScheduleIndex } from "./schedule-index";
export type { CreateBullmqScheduleIndexOptions } from "./schedule-index";
export { resolveProducerConnection, resolveWorkerConnection } from "./connection";
export type { ResolvedConnection } from "./connection";
export { toJobOptions, resolveDlqName } from "./retry";
export type {
  BullmqConnectionOptions,
  FlowJobData,
  EnqueueOptions,
  RetryConfig,
} from "./types";
