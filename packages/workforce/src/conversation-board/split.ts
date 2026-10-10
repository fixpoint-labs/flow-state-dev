/**
 * The split (FIX-1802 S4): a task session that files pieces on its own board
 * waits for them, parked, and settles its task from them.
 *
 * - **The park.** After a task session's turn, if its board holds pieces, its
 *   own task is parked on the board above, quietly (no notice for the park).
 *   Before the park the session writes the *parent binding* into its own
 *   server-written state: the row's partition, its id, the claim ticket the
 *   gate minted for this attempt, and the session and flow that filed it. The
 *   parked row is marked with the task session and its flow (`SPLIT_MARKER`),
 *   so the board above can reach it again. A task session whose board already
 *   holds pieces when its task comes back (a retry, or a takeover after a
 *   crash) runs no turn: it parks again on those pieces.
 * - **The settle.** A parked task is owed its settle once none of its pieces
 *   is open: that debt is the binding plus the pieces' own states, written by
 *   the writes that made them so, and nothing else. It is paid after the turn
 *   a piece's notice woke, in that notice's own request, and never inside a
 *   turn, so the turn can still file a piece again or cancel one. Every piece
 *   completed: the task completes with their outputs. Any failed for good: it
 *   fails, naming them, and the substrate's retry budget decides the rest. The
 *   write goes through the board above at the binding's partition, fenced by
 *   the binding's ticket, so a replay after the settle landed writes nothing;
 *   then the binding clears.
 * - **The replay.** A touch of any board dispatches a run of the board into
 *   the task session of each of its parked split rows; that run does the
 *   same for its own, and dispatches the settle into its own session when it
 *   is owed. So a failed turn, or a process that died before the settle,
 *   strands nothing: the user's next message, or any `listTasks`, above it
 *   settles it. Each session reads only its own board.
 * - **The cancel.** A change from above that ends a split task (a cancel, a
 *   complete, a fail, a block) dispatches the cancel of its open pieces into
 *   its task session, which cancels them through its own board, and so on
 *   down. The task's own later settle is then declined by the claim fence,
 *   and the binding clears.
 */
import { handler, sequencer } from "@flow-state-dev/core";
import { dispatchThroughSeam } from "@flow-state-dev/core/types";
import type { BlockContext } from "@flow-state-dev/core/types";
import {
  isTerminalStatus,
  taskClaimTicketSchema,
  ticketForClaim,
  type Task,
  type TaskCollectionRef,
  type TaskWriteOutcome
} from "@flow-state-dev/orchestration/tasks";
import { z } from "zod";
import { FILING_FLOW_STATE_KEY, FILING_SESSION_STATE_KEY, TASK_FLOW_STATE_KEY, TASK_ID_STATE_KEY } from "../workers/keys";
import { CANCEL_PIECES_ENTRY, RUN_BOARD_ENTRY, SETTLE_SPLIT_ENTRY, SPLIT_MARKER } from "./board-entries";
import { sessionIdOfFiling } from "./filing-session";
import { conversationLedgerAt, conversationLedgerResources, ownConversationLedger } from "./ledger";
import { sendOwedNotices } from "./notice-delivery";

/** Server-written session state: the parked task this task session settles, once its pieces are done. */
export const PARENT_BINDING_STATE = "splitParent";

const splitMarkerSchema = z.object({ session: z.string().min(1), flow: z.string().min(1) });

type SplitMarker = z.infer<typeof splitMarkerSchema>;

/** The parent binding: where the parked task is, the ticket that fences its settle, and who to tell. */
export const parentBindingSchema = z.object({
  partition: z.string().min(1),
  taskId: z.string().min(1),
  ticket: taskClaimTicketSchema,
  filer: z.object({ session: z.string().min(1), flow: z.string().min(1) })
});

export type ParentBinding = z.infer<typeof parentBindingSchema>;

/** The session-state fields the split keeps, server-owned. */
export const splitStateShape = {
  [PARENT_BINDING_STATE]: parentBindingSchema.nullable().default(null)
} as const;

/** Whether a piece still has work ahead of it: not completed, failed for good or cancelled. */
function isOpen(task: Task): boolean {
  return !isTerminalStatus(task.status);
}

function stateOf(ctx: BlockContext): Record<string, unknown> {
  return (ctx.session.state ?? {}) as Record<string, unknown>;
}

function stringAt(ctx: BlockContext, key: string): string | undefined {
  const value = stateOf(ctx)[key];
  return typeof value === "string" ? value : undefined;
}

/** The running session's parent binding, or none. */
export function parentBindingOf(ctx: BlockContext): ParentBinding | undefined {
  const parsed = parentBindingSchema.safeParse(stateOf(ctx)[PARENT_BINDING_STATE]);
  return parsed.success ? parsed.data : undefined;
}

/** The split marker a row carries, or none. */
export function splitMarkerOf(row: Task | undefined): SplitMarker | undefined {
  const parsed = splitMarkerSchema.safeParse(row?.metadata?.[SPLIT_MARKER]);
  return parsed.success ? parsed.data : undefined;
}

/** Whether the running task session already split its task: its own board holds pieces. */
export async function hasPieces(ctx: BlockContext): Promise<boolean> {
  if (stringAt(ctx, TASK_ID_STATE_KEY) === undefined) return false;
  const own = await ownConversationLedger(ctx);
  return own !== undefined && own.count() > 0;
}

/** Dispatch `action` into another session, as a request of its own. A refusal or a throw leaves the debt for the next touch. */
async function dispatchInto(ctx: BlockContext, target: SplitMarker, action: string, from: string): Promise<void> {
  try {
    await dispatchThroughSeam(ctx, {
      type: "internal",
      action,
      flowKind: target.flow,
      session: { id: target.session },
      payload: {},
      from
    });
  } catch {
    // Not definitive: the next touch above dispatches it again.
  }
}

/** Dispatch the settle into the running session itself, behind any turn it is running. */
async function dispatchSettle(ctx: BlockContext): Promise<void> {
  try {
    await dispatchThroughSeam(ctx, {
      type: "internal",
      action: SETTLE_SPLIT_ENTRY,
      session: { id: ctx.session.identity.id },
      payload: {},
      from: "split-settle-owed"
    });
  } catch {
    // The binding stays; the next touch dispatches it again.
  }
}

/**
 * The replay down the chain: a run of the board into the task session of each
 * of `rows` that is parked on its pieces. That run replays its own.
 */
export async function replaySplits(ctx: BlockContext, rows: readonly Task[]): Promise<void> {
  for (const row of rows) {
    if (row.status !== "parked") continue;
    const marker = splitMarkerOf(row);
    if (marker !== undefined) await dispatchInto(ctx, marker, RUN_BOARD_ENTRY, "split-replay");
  }
}

/** Whether the running session owes its parked task a settle now: it has a binding, and none of its pieces is open. */
export async function settleOwed(ctx: BlockContext): Promise<boolean> {
  if (parentBindingOf(ctx) === undefined) return false;
  const own = await ownConversationLedger(ctx);
  return own !== undefined && !own.list().some(isOpen);
}

/** After a run of a task session's board: dispatch the settle into the session when it is owed. */
export async function settleIfOwedLater(ctx: BlockContext): Promise<void> {
  if (await settleOwed(ctx)) await dispatchSettle(ctx);
}

/** The text a task fails with when some of its pieces failed for good. */
function failedPiecesText(failed: readonly Task[]): string {
  const named = failed.map((row) => `"${row.title ?? row.goal}" (${row.id}) with ${row.assignee ?? "its worker"}: ${row.error ?? "no error was recorded"}`);
  return `${failed.length === 1 ? "A piece" : `${failed.length} pieces`} failed for good: ${named.join("; ")}`;
}

/**
 * Settle the running session's parked task from its pieces, when none is
 * open: through the board above, fenced by the binding's ticket, then send
 * the notice that ending owes and clear the binding. Runs only outside a turn.
 *
 * @returns Whether a settle was attempted.
 */
export async function settleParent(ctx: BlockContext): Promise<boolean> {
  const binding = parentBindingOf(ctx);
  if (binding === undefined) return false;
  const own = await ownConversationLedger(ctx);
  if (own === undefined) return false;
  const pieces = own.list();
  if (pieces.some(isOpen)) return false;
  const above = await conversationLedgerAt(ctx, binding.partition);
  if (above !== undefined && above.get(binding.taskId) !== undefined) {
    const failed = pieces.filter((row) => row.status === "errored");
    const guards = { ifAllowed: true, claim: binding.ticket } as const;
    if (failed.length > 0) {
      await above.fail(binding.taskId, failedPiecesText(failed), guards);
    } else {
      const output = {
        pieces: pieces.map((row) => ({
          taskId: row.id,
          goal: row.title ?? row.goal,
          ...(row.assignee !== undefined ? { assignee: row.assignee } : {}),
          status: row.status,
          ...(row.output !== undefined ? { output: row.output } : {})
        }))
      };
      await above.complete(binding.taskId, output as never, guards);
    }
    // Whatever the write did, the notice its row owes goes to the session
    // that filed it. A settle declined by the fence owes nothing new; a
    // marker left by an earlier settle goes again, and is acted on once.
    const row = above.get(binding.taskId);
    // A failure with attempts left put the task back in the queue, which is
    // its start's debt: run the board above now rather than at its next touch.
    if (row?.status === "pending") await dispatchInto(ctx, binding.filer, RUN_BOARD_ENTRY, "split-retry");
    if (row !== undefined) {
      await sendOwedNotices(ctx, row, {
        session: { id: binding.filer.session },
        flowKind: binding.filer.flow,
        from: "split-settle"
      });
    }
  }
  await ctx.session.patchState({ [PARENT_BINDING_STATE]: null } as never);
  return true;
}

/**
 * Cancel each open row on `ref`, and, for each that was split, its pieces
 * down the chain.
 */
export async function cancelOpenRows(ctx: BlockContext, ref: TaskCollectionRef, reason: string): Promise<void> {
  for (const row of ref.list()) {
    if (!isOpen(row)) continue;
    const outcome = await ref.cancel(row.id, reason);
    await cascadeIfSplit(ctx, row, outcome);
  }
}

/**
 * After a write from above landed on a split task and ended it, cancel its
 * open pieces: dispatched into its task session, which reads only its own
 * board.
 *
 * @param before The row as it was before the write.
 */
export async function cascadeIfSplit(ctx: BlockContext, before: Task | undefined, outcome: TaskWriteOutcome | void): Promise<void> {
  const marker = splitMarkerOf(before);
  if (marker === undefined || before?.status !== "parked") return;
  if (outcome != null && outcome.outcome === "declined") return;
  await dispatchInto(ctx, marker, CANCEL_PIECES_ENTRY, "split-cancel");
}

/**
 * After a task session's turn: park its task on its pieces, when its board
 * holds any. Passes the turn's answer through; a parked task's answer is not
 * its result (the gate records nothing on a parked row).
 */
export const parkOnPieces = handler({
  name: "split-park",
  inputSchema: z.unknown(),
  outputSchema: z.unknown(),
  resources: { ...conversationLedgerResources },
  execute: async (answer, rawCtx) => {
    const ctx = rawCtx as unknown as BlockContext;
    const taskId = stringAt(ctx, TASK_ID_STATE_KEY);
    const partition = stringAt(ctx, FILING_SESSION_STATE_KEY);
    const filerFlow = stringAt(ctx, FILING_FLOW_STATE_KEY);
    const taskFlow = stringAt(ctx, TASK_FLOW_STATE_KEY);
    if (taskId === undefined || partition === undefined || filerFlow === undefined || taskFlow === undefined) return answer;
    const own = await ownConversationLedger(ctx);
    if (own === undefined || own.count() === 0) return answer;
    const above = await conversationLedgerAt(ctx, partition);
    // The claim this request holds: the gate verified the row and wrote its
    // run link, fenced by the ticket it minted, before the turn ran. A row
    // whose run link names this request is still this attempt's, and its
    // ticket is minted from it, as the gate minted it.
    const held = above?.get(taskId);
    const requestId = (ctx as { request?: { identity?: { id?: string } } }).request?.identity?.id;
    if (above === undefined || held === undefined || held.status !== "in_progress" || held.run?.requestId !== requestId) {
      throw new Error(`Task "${taskId}" filed pieces, but this request no longer holds it, so it can't wait on them.`);
    }
    const claim = ticketForClaim(above.collectionId, held, partition);
    // The binding first, then the marker, then the park: a crash between any
    // two leaves the row held, and its next attempt parks again here.
    const binding: ParentBinding = {
      partition,
      taskId,
      ticket: claim,
      filer: { session: sessionIdOfFiling(partition), flow: filerFlow }
    };
    await ctx.session.patchState({ [PARENT_BINDING_STATE]: binding } as never);
    await above.patchMetadata(taskId, { [SPLIT_MARKER]: { session: ctx.session.identity.id, flow: taskFlow } });
    const parked = await above.awaitReview(taskId, "Waiting on its pieces.", { claim, quiet: true, ifAllowed: true });
    if (parked.outcome === "declined") {
      // Ended from above while the turn ran: its pieces have nothing to wait for.
      await ctx.session.patchState({ [PARENT_BINDING_STATE]: null } as never);
      await cancelOpenRows(ctx, own, `Its parent task "${taskId}" ended before its pieces did.`);
      return answer;
    }
    // Every piece may have ended already; then settle now, after the turn.
    await settleParent(ctx);
    return answer;
  }
});

/** The settle entry's block: settle the running session's parked task, when it is owed. */
export const settleSplitBlock = handler({
  name: "split-settle",
  inputSchema: z.unknown(),
  outputSchema: z.object({ settled: z.boolean() }),
  resources: { ...conversationLedgerResources },
  execute: async (_input, ctx) => ({ settled: await settleParent(ctx as unknown as BlockContext) })
});

/** The cancel entry's block: cancel the running session's open pieces, down the chain, and drop its binding. */
export const cancelPiecesBlock = sequencer({ name: "split-cancel-pieces", inputSchema: z.unknown() }).step(
  handler({
    name: "split-cancel-open-pieces",
    inputSchema: z.unknown(),
    outputSchema: z.object({}),
    resources: { ...conversationLedgerResources },
    execute: async (_input, rawCtx) => {
      const ctx = rawCtx as unknown as BlockContext;
      const binding = parentBindingOf(ctx);
      const own = await ownConversationLedger(ctx);
      if (own !== undefined) await cancelOpenRows(ctx, own, `Its parent task${binding ? ` "${binding.taskId}"` : ""} was ended from above.`);
      // The settle the fence would decline anyway: drop it.
      if (binding !== undefined) await settleParent(ctx);
      return {};
    }
  })
);
