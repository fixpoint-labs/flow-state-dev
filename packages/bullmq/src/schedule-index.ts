/**
 * BullMQ-backed ScheduleIndex. Maps schedule lifecycle onto native
 * repeatable jobs (upsertJobScheduler / removeJobScheduler).
 *
 * `claimDue` returns [] — BullMQ fires jobs natively via its own
 * scheduler, so there is no polling tick to claim.
 */
import type { Queue } from "bullmq";
import type { ScheduleIndex, ScheduleIndexRow } from "@flow-state-dev/scheduled";

export interface CreateBullmqScheduleIndexOptions {
  /** Prefix for BullMQ scheduler ids. Default "fsd-sched". */
  schedulerIdPrefix?: string;
  /** Flow kind to embed in job data. Required by the dispatch worker. */
  flowKind: string;
}

const DEFAULT_SCHEDULER_PREFIX = "fsd-sched";

/**
 * Creates a ScheduleIndex backed by BullMQ repeatable job schedulers.
 * Upsert maps to `queue.upsertJobScheduler`; remove maps to
 * `queue.removeJobScheduler`. `claimDue` is a no-op — BullMQ fires
 * repeatable jobs natively.
 */
export function createBullmqScheduleIndex(
  queue: Queue,
  opts: CreateBullmqScheduleIndexOptions
): ScheduleIndex {
  const schedulerPrefix =
    opts.schedulerIdPrefix ?? DEFAULT_SCHEDULER_PREFIX;
  const flowKind = opts.flowKind;

  // Built from the row's identity, `(cell, key)`, so two cells' schedules
  // with one key are two schedulers. A person's own cell is their id (escaped
  // only when it contains `:` or `\`), so ordinary ids keep the scheduler
  // ids they had before rows carried a cell.
  function schedulerId(cell: string, key: string): string {
    return `${schedulerPrefix}:${cell}:${key}`;
  }

  return {
    async upsert(row: ScheduleIndexRow): Promise<void> {
      await queue.upsertJobScheduler(
        schedulerId(row.cell, row.key),
        {
          pattern: row.cron,
          ...(row.timezone ? { tz: row.timezone } : {}),
        },
        {
          name: "schedule-fire",
          data: {
            flowKind,
            userId: row.userId,
            key: row.key,
            cron: row.cron,
            timezone: row.timezone,
          },
        }
      );
    },

    async claimDue(
      _now: number,
      _limit?: number
    ): Promise<ScheduleIndexRow[]> {
      // BullMQ fires jobs natively — no polling tick needed.
      return [];
    },

    async remove({ cell, key }: { cell: string; key: string }): Promise<void> {
      await queue.removeJobScheduler(schedulerId(cell, key));
    },
  };
}
