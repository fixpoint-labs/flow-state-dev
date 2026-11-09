// FIX-2085; FIX-2614.
/**
 * The user's routines: Workforce's `listRoutines`, run on the user's roster
 * session, with `pauseRoutine` and `deleteRoutine` beside it. A clock routine
 * files a task on a worker's board when it is due, its next run worked out
 * from its cron and time zone when the list is read; an event routine follows
 * one thread, its events reaching a worker's conversation as messages.
 */
import { useCallback, useEffect, useState } from "react";
import { LIST_ROUTINES_ACTION, ROSTER_FLOW, ROUTINE_VERBS, listedRoutineSchema, type RoutineMaker } from "@flow-state-dev/workforce/browser";
import { runAction } from "./action";
import { useLab } from "./lab-data";
import { describeFailure, type Failure } from "./reads";

/** One routine as the screen shows it. */
export type Routine = {
  id: string;
  name: string;
  /** The worker it acts through: whose board a clock routine files on, whose conversation hears an event routine. */
  worker: string;
  paused: boolean;
  madeBy: RoutineMaker | null;
  description: string | null;
  /** A clock routine's cron, zone and next run; `null` for an event routine. */
  clock: { cron: string; timezone: string; nextRunAt: string | null } | null;
  /** An event routine's thread and the kinds it hears; `null` for a clock routine. */
  event: { thread: string; kinds: string[] | null; interest: string } | null;
  /** A clock routine's task: what for, and who works it. */
  goal: string | null;
  assignee: string | null;
};

const text = (value: unknown): string | null => (typeof value === "string" && value.length > 0 ? value : null);

/**
 * The routines a list read answered, in the order it answered them (clock
 * routines soonest next run first, then event routines). Each row is parsed by
 * Workforce's own schema; a row that doesn't parse is left out.
 */
export function toRoutines(output: unknown): Routine[] {
  const rows = (output as { routines?: unknown } | null | undefined)?.routines;
  if (!Array.isArray(rows)) return [];
  const routines: Routine[] = [];
  for (const row of rows) {
    const parsed = listedRoutineSchema.safeParse(row);
    if (!parsed.success) continue;
    const r = parsed.data;
    const task = (r.task ?? {}) as Record<string, unknown>;
    routines.push({
      id: r.id,
      name: r.name,
      worker: r.worker,
      paused: r.paused,
      madeBy: r.madeBy ?? null,
      description: text(r.description),
      clock: "clock" in r.trigger ? r.trigger.clock : null,
      event: "event" in r.trigger ? { thread: r.trigger.event.thread, kinds: r.trigger.event.kinds ?? null, interest: r.trigger.event.interest } : null,
      goal: text(task.goal),
      assignee: text(task.assignee)
    });
  }
  return routines;
}

/** What a pause, resume or delete came to: `undefined` when it went through, or why it didn't. */
export type RoutineChange = (change: { pause: string; paused: boolean } | { delete: string }) => Promise<string | undefined>;

/**
 * The list, read when the view opens, again on each Lab read (`readAt`), and
 * after each change. A later read keeps the last list until it lands; only a
 * failed first read shows.
 */
export function useRoutines(
  readerSessionId: string | null,
  readAt: number
): { routines: Routine[] | undefined; failure: Failure | undefined; reread: () => void; change: RoutineChange } {
  const { client } = useLab();
  const [routines, setRoutines] = useState<Routine[] | undefined>(undefined);
  const [failure, setFailure] = useState<Failure | undefined>(undefined);
  const [reads, setReads] = useState(0);
  useEffect(() => {
    if (readerSessionId === null) return;
    let closed = false;
    runAction(client, ROSTER_FLOW, readerSessionId, LIST_ROUTINES_ACTION, {})
      .then(({ output }) => {
        if (closed) return;
        setRoutines(toRoutines(output));
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
  const change = useCallback<RoutineChange>(
    async (wanted) => {
      if (readerSessionId === null) return "This Lab keeps no roster for you.";
      const [verb, input] = "delete" in wanted ? [ROUTINE_VERBS.delete, { id: wanted.delete }] : [ROUTINE_VERBS.pause, { id: wanted.pause, paused: wanted.paused }];
      try {
        const { output } = await runAction(client, ROSTER_FLOW, readerSessionId, verb, input);
        const answer = output as { ok?: unknown; error?: unknown } | undefined;
        if (answer?.ok !== true) return typeof answer?.error === "string" ? answer.error : "The Lab gave no answer.";
        return undefined;
      } catch (error: unknown) {
        return describeFailure(error).message;
      } finally {
        setReads((n) => n + 1);
      }
    },
    [client, readerSessionId]
  );
  return { routines, failure: routines === undefined ? failure : undefined, reread, change };
}
