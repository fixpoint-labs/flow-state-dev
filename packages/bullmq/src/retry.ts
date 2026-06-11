/**
 * Maps the adapter's RetryConfig onto BullMQ JobsOptions and wires the
 * dead-letter queue pattern (re-add to a DLQ queue on final failure).
 */
import type { JobsOptions, Worker } from "bullmq";
import { Queue } from "bullmq";
import type { RetryConfig } from "./types";

const DEFAULTS: Required<Omit<RetryConfig, "deadLetter">> & {
  deadLetter: false;
} = {
  attempts: 3,
  backoff: { type: "exponential", delay: 1000, jitter: 0.5 },
  removeOnComplete: { age: 3600, count: 1000 },
  removeOnFail: { age: 86400 },
  deadLetter: false,
};

export function toJobOptions(config?: RetryConfig): Partial<JobsOptions> {
  const c = { ...DEFAULTS, ...config };
  const opts: Partial<JobsOptions> = {
    attempts: c.attempts,
    backoff: c.backoff,
    removeOnComplete: normalizeKeepJobs(c.removeOnComplete),
    removeOnFail: normalizeKeepJobs(c.removeOnFail),
  };
  return opts;
}

/**
 * Coerce our loose `{ age?: number; count?: number }` into BullMQ's
 * discriminated KeepJobs union which requires at least one of `age` or
 * `count` to be present and non-optional.
 */
function normalizeKeepJobs(
  v: boolean | { age?: number; count?: number } | undefined
): JobsOptions["removeOnComplete"] {
  if (v === undefined || typeof v === "boolean") return v;
  if (v.age !== undefined) return v as { age: number; count?: number };
  if (v.count !== undefined) return v as { count: number };
  return true;
}

export function resolveDlqName(
  baseQueueName: string,
  config?: RetryConfig
): string | null {
  if (!config?.deadLetter) return null;
  if (typeof config.deadLetter === "object" && config.deadLetter.queueName) {
    return config.deadLetter.queueName;
  }
  return `${baseQueueName}-dlq`;
}

export function wireDlqHandler(
  worker: Worker,
  dlqQueue: Queue,
  maxAttempts: number
): void {
  worker.on("failed", async (job, err) => {
    if (!job) return;
    const isFinalFailure =
      job.attemptsMade >= (job.opts.attempts ?? maxAttempts) || err.name === "UnrecoverableError";
    if (isFinalFailure) {
      try {
        await dlqQueue.add("dead-letter", {
          ...job.data,
          failedReason: err.message,
          originalJobId: job.id,
        });
      } catch {
        // DLQ write failed (e.g. Redis unavailable); swallow so the
        // worker process itself is not brought down.
      }
    }
  });
}
