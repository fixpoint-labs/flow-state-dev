/**
 * @flow-state-dev/bullmq — BullMQ host/runtime adapter.
 *
 * Provides durable background jobs, native cron scheduling, and full-flow
 * worker dispatch for long-lived self-hosted FSD deployments. Composes
 * from existing framework seams (runAction, ScheduleIndex, dispatch contract)
 * with no framework-core changes beyond the FlowDispatcher/StreamBridge
 * interfaces.
 */
export { resolveProducerConnection, resolveWorkerConnection } from "./connection";
export type { ResolvedConnection } from "./connection";
export { toJobOptions, resolveDlqName } from "./retry";
export type {
  BullmqConnectionOptions,
  FlowJobData,
  EnqueueOptions,
  RetryConfig,
} from "./types";
