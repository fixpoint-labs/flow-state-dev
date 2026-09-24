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
  // with one key are two schedulers. Cells and keys both carry `:`, so the
  // join has to be injective, and there are two forms:
  //
  //   - A one-part cell (a person's own cell: their id, escaped only when it
  //     contains `:` or `\`) has no unescaped `:`, so `<prefix>:<cell>:<key>`
  //     splits at the first unescaped `:`. This is the id every released
  //     version wrote, key untouched, so nothing re-registers (BR-15).
  //   - A multi-part cell (a seat, a flow-isolated cell) has unescaped `:`s,
  //     so its key is escaped the same way and the id splits at the last
  //     unescaped `:`. `@` after the prefix keeps this form apart from the
  //     first, which always has `:` there.
  function schedulerId(cell: string, key: string): string {
    if (!hasUnescapedColon(cell)) return `${schedulerPrefix}:${cell}:${key}`;
    return `${schedulerPrefix}@${cell}:${key.replace(/[\\:]/g, "\\$&")}`;
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

/** True when `cell` has a `:` that no `\` escapes — a multi-part cell. */
function hasUnescapedColon(cell: string): boolean {
  for (let i = 0; i < cell.length; i++) {
    if (cell[i] === "\\") i++;
    else if (cell[i] === ":") return true;
  }
  return false;
}
