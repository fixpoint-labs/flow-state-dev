/**
 * The user's scheduled work (FIX-2085): Workforce's `listSchedules`, run on the
 * user's roster session. Each schedule files a task on a worker's board when it
 * is due; its next run is worked out from its cron and time zone when the list
 * is read, so it shows on any host, with or without a schedule index.
 */
import { useCallback, useEffect, useState } from "react";
import { LIST_SCHEDULES_ACTION, ROSTER_FLOW } from "@flow-state-dev/workforce/browser";
import { runAction } from "./action";
import { useLab } from "./lab-data";
import { describeFailure, type Failure } from "./reads";

/** One schedule as the list answers it. */
export type ScheduledWork = {
  key: string;
  cron: string;
  timezone: string;
  enabled: boolean;
  description?: string;
  /** When it is next due; `null` while it is off, or when its cron doesn't parse. */
  nextRunAt: string | null;
  /** The task it files: whose board, what for, and who works it. */
  filer: string | null;
  goal: string | null;
  assignee: string | null;
};

const text = (value: unknown): string | null => (typeof value === "string" && value.length > 0 ? value : null);

/** The schedules a list read answered, soonest next run first, those with none last. A row that isn't a schedule is left out. */
export function toScheduledWork(output: unknown): ScheduledWork[] {
  const rows = (output as { schedules?: unknown } | null | undefined)?.schedules;
  if (!Array.isArray(rows)) return [];
  const work: ScheduledWork[] = [];
  for (const row of rows as Array<Record<string, unknown>>) {
    if (typeof row?.key !== "string" || typeof row.cron !== "string") continue;
    const input = (row.input ?? {}) as Record<string, unknown>;
    work.push({
      key: row.key,
      cron: row.cron,
      timezone: text(row.timezone) ?? "UTC",
      enabled: row.enabled !== false,
      ...(text(row.description) === null ? {} : { description: row.description as string }),
      nextRunAt: text(row.nextRunAt),
      filer: text(input.filer),
      goal: text(input.goal),
      assignee: text(input.assignee)
    });
  }
  const at = (s: ScheduledWork) => (s.nextRunAt === null ? Number.POSITIVE_INFINITY : Date.parse(s.nextRunAt));
  return work.sort((a, b) => at(a) - at(b) || a.key.localeCompare(b.key));
}

/**
 * The list, read when the view opens and again on each Lab read (`readAt`). A
 * later read keeps the last list until it lands; only a failed first read shows.
 */
export function useScheduledWork(
  readerSessionId: string | null,
  readAt: number
): { schedules: ScheduledWork[] | undefined; failure: Failure | undefined; reread: () => void } {
  const { clients } = useLab();
  const [schedules, setSchedules] = useState<ScheduledWork[] | undefined>(undefined);
  const [failure, setFailure] = useState<Failure | undefined>(undefined);
  const [reads, setReads] = useState(0);
  useEffect(() => {
    if (readerSessionId === null) return;
    let closed = false;
    runAction(clients, ROSTER_FLOW, readerSessionId, LIST_SCHEDULES_ACTION, {})
      .then(({ output }) => {
        if (closed) return;
        setSchedules(toScheduledWork(output));
        setFailure(undefined);
      })
      .catch((error: unknown) => {
        if (!closed) setFailure(describeFailure(error));
      });
    return () => {
      closed = true;
    };
  }, [clients, readerSessionId, readAt, reads]);
  const reread = useCallback(() => setReads((n) => n + 1), []);
  return { schedules, failure: schedules === undefined ? failure : undefined, reread };
}
