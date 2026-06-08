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
 * scheduler for each entry in `flow.schedules.static`. Idempotent — safe
 * to call on every deploy.
 */
export async function registerStaticSchedules(
  opts: RegisterStaticSchedulesOptions
): Promise<void> {
  const { registry, queue } = opts;
  const schedulerPrefix =
    opts.schedulerIdPrefix ?? DEFAULT_SCHEDULER_PREFIX;

  for (const flow of registry.list()) {
    const staticSchedules = flow.schedules?.static;
    if (!staticSchedules) continue;

    for (const [name, schedule] of Object.entries(staticSchedules)) {
      const schedulerId = `${schedulerPrefix}:${flow.kind}:${name}`;
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
    const userId = data.userId ?? "system";

    if (!flowKind || !scheduleId) {
      throw new UnrecoverableError(
        `Schedule job missing flowKind or scheduleId: ${JSON.stringify(data)}`
      );
    }

    const url = `${baseUrl}/api/flows/${flowKind}/schedules/${userId}/${scheduleId}/dispatch`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
        "x-nominal-fire-time": String(job.timestamp ?? Date.now()),
      },
      body: JSON.stringify({
        action: data.actionName ?? "default",
      }),
    });

    onDispatch?.(
      { scheduleId: `${userId}/${scheduleId}`, flowKind },
      response.status
    );

    if (!response.ok && response.status !== 409) {
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
