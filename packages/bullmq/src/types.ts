/**
 * Shared types for the BullMQ host/runtime adapter. Defines the connection,
 * job, retry, and dispatch surface consumed by runtime.ts, worker.ts, and
 * the scheduler modules.
 */
import type { RedisOptions } from "ioredis";

export interface BullmqConnectionOptions {
  /** ioredis connection (URL string or options object). */
  connection: string | RedisOptions;
  /** BullMQ key prefix for multi-tenant namespacing. Default "fsd". */
  prefix?: string;
}

export interface FlowJobData {
  flowKind: string;
  actionName: string;
  input: unknown;
  userId: string;
  sessionId?: string;
  orgId?: string;
  tenantId?: string;
  source?: string;
  metadata?: Record<string, unknown>;
  requestId?: string;
}

export interface EnqueueOptions {
  /** Override default retry config for this job. */
  retry?: RetryConfig;
  /** BullMQ job priority (lower = higher priority). */
  priority?: number;
  /** Delay before processing (ms). */
  delay?: number;
  /** Custom BullMQ jobId for deduplication. */
  jobId?: string;
}

export interface RetryConfig {
  /** Max attempts (including initial). Default 3. */
  attempts?: number;
  /** Backoff strategy. Default exponential 1000ms jitter 0.5. */
  backoff?: { type: "exponential" | "fixed"; delay: number; jitter?: number };
  /** Completed job cleanup. Default { age: 3600, count: 1000 }. */
  removeOnComplete?: boolean | { age?: number; count?: number };
  /** Failed job cleanup. Default { age: 86400 }. */
  removeOnFail?: boolean | { age?: number; count?: number };
  /** Dead-letter queue. Default false; true maps to "<queue>-dlq". */
  deadLetter?: boolean | { queueName: string };
}
