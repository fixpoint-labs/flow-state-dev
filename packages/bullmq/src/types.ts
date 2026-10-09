/**
 * Shared types for the BullMQ host/runtime adapter. Defines the connection,
 * job, retry, and dispatch surface consumed by runtime.ts, worker.ts, and
 * the scheduler modules.
 */
import type { RedisOptions } from "ioredis";
import type { LeasePlace, LeaseTurn } from "@flow-state-dev/engine";

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
  /**
   * The run's place on its concurrency key, taken by the dispatching process
   * before the enqueue. The worker runs the job only in the place's turn and
   * gives it back when the job is done for good. Absent on a job with no
   * arbitrated key, and on a job from a release before places existed; both
   * run as they always did.
   */
  leasePlace?: LeasePlace | null;
  /**
   * The job's wait for its turn so far, carried across requeues: when it
   * first checked (the wait budget counts from there, not from the enqueue)
   * and how many checks it has made (the backoff grows with them).
   */
  leaseWait?: { firstCheckAt: number; attempt: number } | null;
  /**
   * How the job reaches its turn when not by waiting in line for
   * `leasePlace` (`queue`, `reject`), as the dispatching host set it
   * (`DispatchEnvelope.leaseTurn`) or as the worker moved it on since:
   *
   *   - `{ kind: "now" }` — runs at once under `leasePlace`: a `hold` run, or a
   *     `defer` run that claimed its key.
   *   - `{ kind: "when-free", key }` — a `defer` run that has not claimed `key`
   *     yet. It claims it once nothing holds or waits on it.
   *   - `{ kind: "behind" }` — a `defer` run that ran out of patience and lined
   *     up at the back: it waits for `leasePlace`'s turn with no time budget.
   *
   * `== null` → `leasePlace` waits its turn with the `queue` budget.
   */
  leaseTurn?: LeaseTurn | { kind: "behind" } | null;
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
