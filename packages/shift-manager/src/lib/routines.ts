// FIX-2085; FIX-2614; FIX-2624.
/**
 * The user's routines: the roster flow's `routines` view, read with no
 * session, the app's declared routines joined in, and `pauseRoutine` and
 * `deleteRoutine` sent to the routines collection, which the roster flow
 * writes in the user's own write session. A clock routine files a task on a
 * worker's board when it is due, its next run worked out from its cron and
 * time zone when the list is read; an event routine follows one thread, its
 * events reaching a worker's conversation as messages.
 */
import { useCallback, useMemo } from "react";
import { useView } from "@flow-state-dev/react";
import { ROUTINE_VERBS, SCHEDULES_PATTERN, listedRoutineSchema, routinesView, type ListedRoutine } from "@flow-state-dev/workforce/browser";
import { useLab } from "./lab-data";
import { describeFailure, type Failure } from "./failure";

const text = (value: unknown): string | null => (typeof value === "string" && value.length > 0 ? value : null);

/**
 * The routines a list read answered, in the order it answered them (clock
 * routines soonest next run first, then event routines). Each is parsed by
 * Workforce's own schema; one that doesn't parse is left out.
 */
export function toRoutines(output: unknown): ListedRoutine[] {
  const listed = (output as { routines?: unknown } | null | undefined)?.routines;
  if (!Array.isArray(listed)) return [];
  return listed.flatMap((item) => {
    const parsed = listedRoutineSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

/** A clock routine's cron, zone and next run; `null` for an event routine. */
export function clockOf(routine: ListedRoutine): { cron: string; timezone: string; nextRunAt: string | null } | null {
  return "clock" in routine.trigger ? routine.trigger.clock : null;
}

/** An event routine's thread and the kinds it hears (`null`: every kind); `null` for a clock routine. */
export function eventOf(routine: ListedRoutine): { thread: string; kinds: string[] | null; interest: string } | null {
  if (!("event" in routine.trigger)) return null;
  const { thread, kinds, interest } = routine.trigger.event;
  return { thread, kinds: kinds ?? null, interest };
}

/** A clock routine's task: what for, and who works it. */
export function taskOf(routine: ListedRoutine): { goal: string | null; assignee: string | null } {
  const task = (routine.task ?? {}) as Record<string, unknown>;
  return { goal: text(task.goal), assignee: text(task.assignee) };
}

/** What a pause, resume or delete came to: `undefined` when it went through, or why it didn't. */
export type RoutineChange = (change: { pause: string; paused: boolean } | { delete: string }) => Promise<string | undefined>;

/**
 * The list, from the routines view, kept current by it: a routine paused or
 * added anywhere shows when the view does. `routines` is `null` when this
 * Lab serves no roster flow (404). A later read keeps the last list; only a
 * failed first read shows.
 */
export function useRoutines(): {
  routines: ListedRoutine[] | null | undefined;
  failure: Failure | undefined;
  reread: () => void;
  change: RoutineChange;
} {
  const { client } = useLab();
  const { value, failure, refresh } = useView(routinesView, {}, { client });
  const routines = useMemo(() => (value === undefined ? (failure?.httpStatus === 404 ? null : undefined) : toRoutines(value)), [value, failure?.httpStatus]);
  const change = useCallback<RoutineChange>(
    async (wanted) => {
      const [verb, input] = "delete" in wanted ? [ROUTINE_VERBS.delete, { id: wanted.delete }] : [ROUTINE_VERBS.pause, { id: wanted.pause, paused: wanted.paused }];
      try {
        const answer = await client.resource({ scope: "user", pattern: SCHEDULES_PATTERN }).send<{ ok?: unknown; error?: unknown } | undefined>(verb, input);
        if (answer?.ok !== true) return typeof answer?.error === "string" ? answer.error : "The Lab gave no answer.";
        return undefined;
      } catch (error: unknown) {
        return describeFailure(error).message;
      } finally {
        // The change's own notice re-runs the view; reading now draws it without waiting on the push.
        refresh();
      }
    },
    [client, refresh]
  );
  return { routines, failure: routines === undefined ? failure : undefined, reread: refresh, change };
}
