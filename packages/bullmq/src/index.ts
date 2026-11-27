/**
 * @flow-state-dev/bullmq — BullMQ host/runtime adapter.
 *
 * Provides durable background jobs and full-flow job queue dispatch for
 * long-lived self-hosted FSD deployments. Composes from existing framework
 * seams (runAction, the dispatch contract) with FlowRunner/StreamBridge
 * interfaces for pluggable execution. Schedules need nothing from it: the
 * engine's local cron, elected by the shared store's lease, fires them.
 */
export { bullmqJobQueue } from "./flowstate-adapter";
export type { BullmqJobQueueOptions, BullmqJobQueueAdapter } from "./flowstate-adapter";
export { createBullmqRuntime } from "./runtime";
export type { BullmqRuntime, CreateBullmqRuntimeOptions } from "./runtime";
export { createJobProcessor, createFlowJobProcessor } from "./job-processor";
export type { JobProcessorDeps, CreateJobProcessorOptions } from "./job-processor";
export { createJobQueueRunner } from "./runner";
export { createRedisLeaseBackend, leaseJobId, DEFAULT_LEASE_MS } from "./lease-backend";
export type {
  CreateRedisLeaseBackendOptions,
  JobLeaseBackend,
  JobLeaseTakeInput,
  RedisLeaseBackend,
} from "./lease-backend";
export type { CreateJobQueueRunnerOptions } from "./runner";
export { createRedisStreamBridge } from "./stream-bridge";
export type { CreateRedisStreamBridgeOptions } from "./stream-bridge";
export { resolveProducerConnection, resolveProcessorConnection } from "./connection";
export type { ResolvedConnection } from "./connection";
export { toJobOptions, resolveDlqName } from "./retry";
export type {
  BullmqConnectionOptions,
  FlowJobData,
  JobLeaseTurn,
  EnqueueOptions,
  RetryConfig,
} from "./types";
