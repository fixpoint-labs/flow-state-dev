/**
 * Which routed task a session by id works now (FIX-2083): a workstream's
 * session, the one session several of its user's conversations can route to.
 *
 * Rule 5 (one open task per session) is each board's own check, and a
 * workstream's session is no one board's: two conversations route to it from
 * two boards. So the `work` entry records, in the user's scope, the routed
 * task it starts there and the board that task is on; a board reads that
 * record before it starts a routed task for the same session, and leaves its
 * own waiting while that task is open. The record is server-written, and a
 * caller reads only its own user's.
 */
import { defineResourceCollection } from "@flow-state-dev/core";
import type { BlockContext, ResourceCollectionRef } from "@flow-state-dev/core/types";
import { isTerminalStatus, type Task, type TaskCollectionRef } from "@flow-state-dev/orchestration/tasks";
import { z } from "zod";
import { conversationLedgerAt } from "./ledger";

/** The resource key the records are declared under. */
const ROUTED_SESSIONS_RESOURCE = "workforceRoutedSessions";

/** One session's record: the routed task it last started, and the board it is on. */
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

/** A session id as one key segment: it may hold any character. */
const keyOf = (sessionId: string): string => encodeURIComponent(sessionId);

/**
 * Record that `sessionId` now works `holder`, the routed task its `work`
 * entry just let in. The last start wins: a board starts no second routed
 * task here while the recorded one is open.
 *
 * @throws when the running flow doesn't declare the records.
 */
export async function noteRoutedSession(ctx: BlockContext, sessionId: string, holder: RoutedSessionHolder): Promise<void> {
  const records = recordsOf(ctx);
  if (records === undefined) {
    throw new Error(
      `The running flow doesn't declare the routed-session records ("${ROUTED_SESSIONS_RESOURCE}"), so a routed task ` +
        "can't hold its session. Spread the session kit's `resources` into the flow."
    );
  }
  const ref = await records.getOrCreate(keyOf(sessionId), holder);
  if (ref.state.partition !== holder.partition || ref.state.taskId !== holder.taskId) await ref.patchState(holder);
}

/**
 * The sessions by id that a routed task on `board` would start in, and that
 * another board's routed task holds now: started there and not finished.
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
    const record = await records.getOptional(keyOf(sessionId));
    const holder = record?.state;
    if (holder === undefined || holder.partition === board.partition) continue;
    const row: Task | undefined = (await conversationLedgerAt(ctx, holder.partition))?.get(holder.taskId);
    if (row !== undefined && !isTerminalStatus(row.status) && row.targetSessionId === sessionId) held.add(sessionId);
  }
  return held;
}
