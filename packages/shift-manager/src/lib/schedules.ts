/**
 * The user's scheduled work (FIX-2085): Workforce's `listSchedules`, run on the
 * user's roster session. Each schedule files a task on a worker's board when it
 * is due; its next run is worked out from its cron and time zone when the list
 * is read, so it shows on any host, with or without a schedule index.
 */
import { useCallback, useEffect, useState } from "react";
import { LIST_SCHEDULES_ACTION, ROSTER_FLOW, listedScheduleSchema } from "@flow-state-dev/workforce/browser";
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

/**
 * The schedules a list read answered, in the order it answered them (soonest
 * next run first). Each row is parsed by Workforce's own schema; a row that
 * doesn't parse is left out.
 */
export function toScheduledWork(output: unknown): ScheduledWork[] {
  const rows = (output as { schedules?: unknown } | null | undefined)?.schedules;
  if (!Array.isArray(rows)) return [];
  const work: ScheduledWork[] = [];
  for (const row of rows) {
    const parsed = listedScheduleSchema.safeParse(row);
    if (!parsed.success) continue;
    const { input, description, ...schedule } = parsed.data;
    const filing = (input ?? {}) as Record<string, unknown>;
    work.push({
      key: schedule.key,
      cron: schedule.cron,
      timezone: schedule.timezone,
      enabled: schedule.enabled,
      ...(text(description) === null ? {} : { description: description! }),
      nextRunAt: schedule.nextRunAt,
      filer: text(filing.filer),
      goal: text(filing.goal),
      assignee: text(filing.assignee)
    });
  }
  return work;
}

/**
 * The list, read when the view opens and again on each Lab read (`readAt`). A
 * later read keeps the last list until it lands; only a failed first read shows.
 */
export function useScheduledWork(
  readerSessionId: string | null,
  readAt: number
): { schedules: ScheduledWork[] | undefined; failure: Failure | undefined; reread: () => void } {
  const { client } = useLab();
  const [schedules, setSchedules] = useState<ScheduledWork[] | undefined>(undefined);
  const [failure, setFailure] = useState<Failure | undefined>(undefined);
  const [reads, setReads] = useState(0);
  useEffect(() => {
    if (readerSessionId === null) return;
    let closed = false;
    runAction(client, ROSTER_FLOW, readerSessionId, LIST_SCHEDULES_ACTION, {})
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
  }, [client, readerSessionId, readAt, reads]);
  const reread = useCallback(() => setReads((n) => n + 1), []);
  return { schedules, failure: schedules === undefined ? failure : undefined, reread };
}
