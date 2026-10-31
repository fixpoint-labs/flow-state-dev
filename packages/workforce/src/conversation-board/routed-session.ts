/**
 * Which routed task a session by id works now (FIX-2083): a workstream's
 * session, the one session several of its user's conversations can route to.
 *
 * Rule 5 (one open task per session) is each board's own check, and a
 * workstream's session is no one board's: two conversations route to it from
 * two boards. So the session has one record, in the user's scope, naming the
 * routed task that holds it and the board that task is on. A board takes the
 * record before it claims a routed task for the session, in one
 * compare-and-swap write: the record names its task, or another board's task
 * that is still open there, and only the board it names claims. A task that
 * has ended, or was held, holds nothing, so the next claim takes the record
 * over. The record is server-written, and a caller reads only its own user's.
 */
import { defineResourceCollection } from "@flow-state-dev/core";
import { updateStateWith } from "@flow-state-dev/core/helpers";
import type { BlockContext, ResourceCollectionRef } from "@flow-state-dev/core/types";
import { isTerminalStatus, readCommittedTask, type TaskCollectionRef } from "@flow-state-dev/orchestration/tasks";
import { z } from "zod";
import { conversationLedgerAt } from "./ledger";

/** The resource key the records are declared under. */
const ROUTED_SESSIONS_RESOURCE = "workforceRoutedSessions";

/** One session's record: the routed task that holds it, and the board it is on. */
const routedSessionSchema = z.object({ partition: z.string().min(1), taskId: z.string().min(1) });

export type RoutedSessionHolder = z.infer<typeof routedSessionSchema>;

/** The records, at `workforce/routed-sessions/*` in the owner's user scope. Server-written; no browser read. */
const routedSessionsCollection = defineResourceCollection({
  pattern: "workforce/routed-sessions/*",
  scope: "user",
  flowIsolation: false,
  prefetchMode: "lazy",
  stateSchema: routedSessionSchema
});

/** The flow resources that install the records. */
export const routedSessionResources = { [ROUTED_SESSIONS_RESOURCE]: routedSessionsCollection } as const;

function recordsOf(ctx: BlockContext): ResourceCollectionRef<RoutedSessionHolder> | undefined {
  return (ctx.resources as Record<string, unknown> | undefined)?.[ROUTED_SESSIONS_RESOURCE] as
    | ResourceCollectionRef<RoutedSessionHolder>
    | undefined;
}

function requireRecords(ctx: BlockContext): ResourceCollectionRef<RoutedSessionHolder> {
  const records = recordsOf(ctx);
  if (records === undefined) {
    throw new Error(
      `The running flow doesn't declare the routed-session records ("${ROUTED_SESSIONS_RESOURCE}"), so a routed task ` +
        "can't hold its session. Spread the session factory's `resources` into the flow."
    );
  }
  return records;
}

/** A session id as one key segment: it may hold any character. */
const keyOf = (sessionId: string): string => encodeURIComponent(sessionId);

/**
 * Whether `holder` holds `sessionId` now: its row, as stored now (another
 * request may have ended it), is open there and not held. A retried row still holds the
 * record it was named in: the record is what keeps two boards out of one session.
 */
async function holds(ctx: BlockContext, holder: RoutedSessionHolder, sessionId: string): Promise<boolean> {
  const ledger = await conversationLedgerAt(ctx, holder.partition);
  const row = ledger === undefined ? undefined : await readCommittedTask(ledger, holder.taskId);
  return row !== undefined && row.targetSessionId === sessionId && !isTerminalStatus(row.status) && row.status !== "held";
}

/**
 * Take `sessionId` for `taskId`, a routed task on `board` that would start
 * there, in one compare-and-swap write of the session's record.
 *
 * @returns the task on `board` that may start there: `taskId`, or the board's
 *   own task already holding the session; `undefined` while another board's
 *   task holds it.
 * @throws when the running flow doesn't declare the records.
 */
export async function holdRoutedSession(
  ctx: BlockContext,
  board: TaskCollectionRef,
  sessionId: string,
  taskId: string
): Promise<string | undefined> {
  const partition = board.partition;
  if (partition === undefined) return taskId;
  const mine: RoutedSessionHolder = { partition, taskId };
  const ref = await requireRecords(ctx).getOrCreate(keyOf(sessionId), mine);
  // Re-run against the stored record on every lost race: two boards taking
  // one session at once can't both see it free.
  return updateStateWith<RoutedSessionHolder, string | undefined>(ref, async (holder) => {
    if (holder.partition === partition && holder.taskId === taskId) return { state: holder, result: taskId };
    if (await holds(ctx, holder, sessionId)) {
      return { state: holder, result: holder.partition === partition ? holder.taskId : undefined };
    }
    return { state: mine, result: taskId };
  });
}

/**
 * Record, from the `work` entry, the routed task it just let into
 * `sessionId`, when the record names no task that holds it: none yet, or one
 * that has ended or was held (a task claimed by a host before claims took the
 * record, as in a rolling deploy). A record naming a task still open there is
 * left alone, in the same compare-and-swap write a claim takes.
 *
 * @throws when the running flow doesn't declare the records.
 */
export async function noteRoutedSession(ctx: BlockContext, sessionId: string, holder: RoutedSessionHolder): Promise<void> {
  const ref = await requireRecords(ctx).getOrCreate(keyOf(sessionId), holder);
  await updateStateWith<RoutedSessionHolder, undefined>(ref, async (stored) => {
    if (stored.partition === holder.partition && stored.taskId === holder.taskId) return { state: stored, result: undefined };
    return { state: (await holds(ctx, stored, sessionId)) ? stored : holder, result: undefined };
  });
}

/**
 * The sessions by id that a routed task on `board` would start in, and that
 * another board's routed task holds now. A read: it takes nothing.
 * `undefined` where the running block can't read the records.
 */
export async function sessionsHeldElsewhere(ctx: BlockContext, board: TaskCollectionRef): Promise<ReadonlySet<string> | undefined> {
  const records = recordsOf(ctx);
  if (records === undefined) return undefined;
  const held = new Set<string>();
  const targets = new Set(
    board
      .list()
      .filter((row) => row.targetSessionId !== undefined && !isTerminalStatus(row.status))
      .map((row) => row.targetSessionId!)
  );
  for (const sessionId of targets) {
    const holder = (await records.getOptional(keyOf(sessionId)))?.state;
    if (holder === undefined || holder.partition === board.partition) continue;
    if (await holds(ctx, holder, sessionId)) held.add(sessionId);
  }
  return held;
}
