/**
 * Static schedule registration and schedule dispatch worker.
 *
 * `registerStaticSchedules` reads each flow's `schedules.static` map and
 * upserts a BullMQ repeatable job per entry.
 *
 * `createScheduleDispatchWorker` consumes scheduler-produced jobs and
 * POSTs to the framework's schedule dispatch endpoint, bridging BullMQ's
 * native cron to the scheduled transport adapter.
 */
import { Worker, UnrecoverableError } from "bullmq";
import type { Queue, Job } from "bullmq";
import type { FlowRegistry } from "@flow-state-dev/server";
import { resolveWorkerConnection } from "./connection";
import type { BullmqConnectionOptions } from "./types";

export interface RegisterStaticSchedulesOptions {
  registry: FlowRegistry;
  queue: Queue;
  /** Prefix for BullMQ scheduler ids. Default "fsd-sched-static". */
  schedulerIdPrefix?: string;
}

const DEFAULT_SCHEDULER_PREFIX = "fsd-sched-static";

/**
 * Iterates all flows in the registry and upserts a BullMQ repeatable job
 * scheduler for each entry in `flow.schedules.static`. Reconciles: any
 * scheduler under the static prefix that is no longer in the registry
 * is removed, preventing removed/renamed schedules from firing forever.
 * Idempotent — safe to call on every deploy.
 */
export async function registerStaticSchedules(
  opts: RegisterStaticSchedulesOptions
): Promise<void> {
  const { registry, queue } = opts;
  const schedulerPrefix =
    opts.schedulerIdPrefix ?? DEFAULT_SCHEDULER_PREFIX;

  const desiredIds = new Set<string>();

  for (const flow of registry.list()) {
    const staticSchedules = flow.schedules?.static;
    if (!staticSchedules) continue;

    for (const [name, schedule] of Object.entries(staticSchedules)) {
      const schedulerId = `${schedulerPrefix}:${flow.kind}:${name}`;
      desiredIds.add(schedulerId);
      await queue.upsertJobScheduler(
        schedulerId,
        {
          pattern: schedule.cron,
          ...(schedule.timezone ? { tz: schedule.timezone } : {}),
        },
        {
          name: "static-schedule-fire",
          data: {
            flowKind: flow.kind,
            scheduleName: name,
            actionName: schedule.action,
            cron: schedule.cron,
            timezone: schedule.timezone,
          },
        }
      );
    }
  }

  const existing = await queue.getJobSchedulers();
  for (const scheduler of existing) {
    if (scheduler.id?.startsWith(schedulerPrefix + ":") && !desiredIds.has(scheduler.id)) {
      await queue.removeJobScheduler(scheduler.id);
    }
  }
}

export interface CreateScheduleDispatchWorkerOptions
  extends BullmqConnectionOptions {
  /** Queue name to consume scheduler jobs from. */
  queueName: string;
  /** Base URL of the FSD server (e.g. "http://localhost:3000"). */
  baseUrl: string;
  /** Shared secret for the schedule dispatch endpoint's bearer auth. */
  secret: string;
  /** Worker concurrency. Default 5. */
  concurrency?: number;
  /** Optional callback for observing dispatch results. */
  onDispatch?: (
    job: { scheduleId: string; flowKind: string },
    status: number
  ) => void;
}

interface ScheduleJobData {
  flowKind?: string;
  userId?: string;
  key?: string;
  scheduleName?: string;
  actionName?: string;
  cron?: string;
}

/**
 * Creates a BullMQ Worker that consumes schedule-fire jobs and POSTs to
 * the framework's schedule dispatch endpoint. Bridges BullMQ's native
 * repeatable-job scheduler to the framework's scheduled transport adapter.
 */
export function createScheduleDispatchWorker(
  opts: CreateScheduleDispatchWorkerOptions
): Worker {
  const { connection, prefix } = resolveWorkerConnection(opts);
  const { baseUrl, secret, queueName, onDispatch } = opts;

  const processor = async (job: Job<ScheduleJobData>) => {
    const data = job.data;
    const flowKind = data.flowKind;
    const scheduleId = data.key ?? data.scheduleName;

    if (!flowKind || !scheduleId) {
      throw new UnrecoverableError(
        `Schedule job missing flowKind or scheduleId: ${JSON.stringify(data)}`
      );
    }

    // Static schedules (from registerStaticSchedules) have no userId;
    // user-scoped schedules (from the schedule index) carry userId.
    // The dispatch endpoint looks up static keys as bare names, so only
    // include the userId segment for user-scoped jobs.
    const userId = data.userId;
    const pathSegment = userId !== undefined
      ? `${encodeURIComponent(userId)}/${encodeURIComponent(scheduleId)}`
      : encodeURIComponent(scheduleId);
    const url = `${baseUrl}/api/flows/${encodeURIComponent(flowKind)}/schedules/${pathSegment}/dispatch`;

    const nominalFireTime = new Date(job.timestamp ?? Date.now()).toISOString();
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ nominalFireTime }),
      signal: AbortSignal.timeout(25_000),
    });

    onDispatch?.(
      { scheduleId: userId !== undefined ? `${userId}/${scheduleId}` : scheduleId, flowKind },
      response.status
    );

    if (!response.ok) {
      throw new Error(
        `Schedule dispatch failed: ${response.status} ${response.statusText}`
      );
    }
  };

  return new Worker(queueName, processor, {
    connection,
    prefix,
    concurrency: opts.concurrency ?? 5,
  });
}
