// FIX-2614, epic FIX-2471 D12.
/**
 * One routine as `listRoutines` answers it, and who made it. A leaf over zod
 * alone, so a browser parses the answer with the schema the server wrote it by
 * (`@flow-state-dev/workforce/browser`).
 */
import { z } from "zod";

/**
 * Who made a routine: the user, a worker in one of their conversations, or
 * the app's config (`routines.declared`, by entry id). Stored with the row, and
 * optional there: a row from before it names no maker.
 */
export const routineMakerSchema = z.discriminatedUnion("by", [
  z.object({ by: z.literal("user") }).strict(),
  z.object({ by: z.literal("worker"), worker: z.string().min(1) }).strict(),
  z.object({ by: z.literal("app"), entry: z.string().min(1) }).strict()
]);

export type RoutineMaker = z.infer<typeof routineMakerSchema>;

/** A clock trigger as the list shows it: its cron, its zone, and when it is next due. */
const listedClockSchema = z.object({
  cron: z.string(),
  timezone: z.string(),
  /** Worked out from the cron and zone at read; `null` while paused, or when the cron doesn't parse. */
  nextRunAt: z.string().nullable()
});

/** An event trigger as the list shows it: the subscription's selection. */
const listedEventSchema = z.object({
  provider: z.string(),
  thread: z.string(),
  kinds: z.array(z.string()).optional(),
  screens: z.array(z.unknown()),
  interest: z.string()
});

/**
 * One routine as the list shows it. `listRoutines` answers clock routines
 * soonest next run first, then event routines, each by name, then by id.
 */
export const listedRoutineSchema = z.object({
  /** `clock:<key>` or `event:<subscription id>`: what pause and delete take. */
  id: z.string(),
  /** A clock routine's key; an event routine's thread. */
  name: z.string(),
  /** The worker it acts through: a clock routine's filer, an event routine's hearer. */
  worker: z.string(),
  paused: z.boolean(),
  madeBy: routineMakerSchema.optional(),
  description: z.string().optional(),
  trigger: z.union([z.object({ clock: listedClockSchema }), z.object({ event: listedEventSchema })]),
  /** A clock routine's task: `filer`, `goal`, and optionally `assignee` and the rest of the filing. */
  task: z.unknown().optional()
});

export type ListedRoutine = z.infer<typeof listedRoutineSchema>;
