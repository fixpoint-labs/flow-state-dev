/**
 * One schedule as the roster flow's `listSchedules` answers it (FIX-2085).
 * A leaf over zod alone, so a browser parses the answer with the schema the
 * server wrote it by (`@flow-state-dev/workforce/browser`).
 */
import { z } from "zod";

/** One schedule as the list shows it. `listSchedules` answers them soonest `nextRunAt` first, then by `key`. */
export const listedScheduleSchema = z.object({
  key: z.string(),
  cron: z.string(),
  timezone: z.string(),
  kind: z.string(),
  enabled: z.boolean(),
  description: z.string().optional(),
  /** The task it files: `filer`, `goal`, and optionally `assignee` and the rest of the filing. */
  input: z.unknown(),
  /** When it is next due, worked out from its cron and time zone now; `null` when it is off or its cron doesn't parse. */
  nextRunAt: z.string().nullable()
});

export type ListedSchedule = z.infer<typeof listedScheduleSchema>;
