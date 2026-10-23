/**
 * The `onTaskSettled` internal entry (FIX-2078): how the session that filed a
 * task hears it end, on any flow that hands rows out, with Workforce or
 * without.
 *
 * ```ts
 * const onEnding = handler({
 *   name: "on-ending",
 *   inputSchema: taskSettledInputSchema,
 *   execute: (ending) => decide(ending.taskId, ending.ending, ending.output, ending.error)
 * });
 * defineFlow({ ..., internal: { actions: { onTaskSettled: taskSettledEntry({ block: onEnding }) } } });
 * ```
 *
 * One request per ending. The entry admits a notice only while its row still
 * owes it, takes it (FIX-2123: one conditional write, so a wait's drop and this
 * delivery never both go through), runs the flow's block with it, and then
 * acknowledges it (clears the row's marker), so a block that fails leaves the
 * notice owed and the filer's next pass sends it again, taken over from the
 * request that failed. Queued on the session by default, so a second copy of
 * one notice waits behind the first and finds it no longer owed.
 *
 * A failure's or a cancel's notice is completed here before the block runs
 * (FIX-2136): a touch of the board cancels any dependent the ending's own
 * cascade never read, and the notice names it, as it names the ones that
 * cascade cancelled.
 *
 * While the request that filed the task is running (not while it is parked),
 * its notice is turned away as `defer` turns one away (FIX-2123): a wait in
 * that request reads the ending first and drops it, and the request sends
 * what is still owed as it ends; at a park, the filer's pass sends it shortly
 * after, past its backoff (FIX-2149).
 *
 * Woken with an empty input, by the wake a board's delivery owes when it
 * names this entry as its pass (the default): it pays what this session's
 * boards still owe ({@link payBoardDebts}) and settles the wake.
 */
import { handler, sequencer } from "@flow-state-dev/core";
import type { BlockContext, BlockDefinition, ConcurrencyConfig } from "@flow-state-dev/core/types";
import { z } from "zod";
import type { Task } from "../schema/task";
import type { TaskCollectionRef } from "../collection/types";
import { cancelledDependents, clearNotice, deferredNoticePatch, isNoticeOwed, noticeTakenBy, type TaskNotice } from "./task-notice";
import { filerResolver, TASK_SETTLED_ENTRY, type DeclaredDelivery } from "./delivery";
import { delegatingBoardsOf, payBoardDebts, settlePassWake, type BoardDebts } from "./pass";

/** A notice, as `onTaskSettled` and a flow's block take it. */
export const taskSettledInputSchema = z
  .object({
    boardId: z.string().min(1),
    taskId: z.string().min(1),
    attempt: z.number().int().nonnegative(),
    ending: z.enum(["completed", "errored", "parked", "retried", "cancelled"]),
    output: z.unknown().optional(),
    error: z.string().optional(),
    question: z.string().optional(),
    asked: z.literal(true).optional(),
    /** On a failure or a cancel: the dependents its ending cancelled that share its filer (D2). */
    cancelled: z.array(z.string()).optional()
  })
  .strict();

/** A notice, as a flow's block takes it. */
export type TaskSettledInput = z.infer<typeof taskSettledInputSchema>;

/** What `onTaskSettled` takes: a notice, or nothing (a wake: pay what is owed). */
const entryInputSchema = z.union([taskSettledInputSchema, z.object({}).strict()]);

const admittedSchema = z.object({ owed: z.boolean(), notice: taskSettledInputSchema.optional() });

/** What {@link taskSettledEntry} is built from. */
export interface TaskSettledEntryOptions {
  /** The flow's own handling of one ending, given the notice. Runs once per ending. */
  readonly block: BlockDefinition<any, any>;
  /**
   * The entry's concurrency. Default `queue` on the session, so two copies of
   * one notice run one after the other and the second finds it acknowledged.
   */
  readonly concurrency?: ConcurrencyConfig;
  /**
   * Whether this notice must wait: `true` runs nothing and acknowledges
   * nothing, so the notice stays owed and the filer's pass sends it again
   * (with its backoff, at most every 5 minutes). For a session that is busy
   * with something the notice must not run beside. Being turned away is no
   * failed delivery: the notice's age, which ends it as undeliverable past
   * the host's maximum debt age, counts from the last time it was turned
   * away. Default: never.
   */
  readonly defer?: (ctx: BlockContext, notice: TaskSettledInput) => Promise<boolean>;
}

/**
 * Whether a request of this session has stopped running (FIX-2123), as the
 * engine records it. A host that keeps no such record answers `true`: there a
 * notice is admitted as it was before.
 */
async function hasEnded(ctx: BlockContext, requestId: string): Promise<boolean> {
  const ended = ctx.requestHost?.waits?.ended;
  if (ended === undefined) return true;
  return (await ended([requestId]))[requestId] === true;
}

/**
 * Whether a request of this session is running its own work now, neither
 * parked nor ended (FIX-2123), as the engine records it. A host that keeps no
 * such record answers `false`: there no notice is held for it.
 */
async function isRunning(ctx: BlockContext, requestId: string): Promise<boolean> {
  const running = ctx.requestHost?.waits?.running;
  if (running === undefined) return false;
  return (await running([requestId]))[requestId] === true;
}

/** The running session's board a notice names, at this session's partition. */
async function boardOf(ctx: BlockContext, boardId: string) {
  return (await delegatingBoardsOf(ctx, boardId)).find((board) => board.ref.collectionId === boardId);
}

/**
 * A failure's or a cancel's notice, naming every dependent its ending
 * cancelled (FIX-2136). The request that wrote the ending cascades over the
 * rows it has read, so a dependent another request filed after that read is
 * missed there, and the notice it sent names none. This request read the
 * board after the ending: a touch here cancels such a dependent, and the
 * notice names it before the flow's block runs. A cascaded cancel owes no
 * notice of its own (FIX-2080 D2), so this notice is the filer's one hearing
 * of it. The names are read off this request's board even when the touch
 * fails part way, so a dependent it cancelled before failing is named too.
 *
 * @internal Exported for its tests.
 */
export async function withCascadeNamed(
  board: { ref: TaskCollectionRef; delivery: DeclaredDelivery },
  row: Task,
  notice: TaskSettledInput
): Promise<TaskSettledInput> {
  if (notice.ending !== "errored" && notice.ending !== "cancelled") return notice;
  try {
    await board.ref.payOwedCascades?.();
  } catch {
    // What it cancelled before failing is named below; the rest waits for the next touch.
  }
  const { cancelled: _sent, ...rest } = notice;
  const named = cancelledDependents(row, board.ref.list(), filerResolver(board.delivery, board.ref.partition));
  return named.length > 0 ? { ...rest, cancelled: named } : rest;
}

/**
 * Build the `onTaskSettled` internal entry: spread it as
 * `internal: { actions: { onTaskSettled: taskSettledEntry({ block }) } }`.
 */
export function taskSettledEntry(options: TaskSettledEntryOptions) {
  /** A notice its row still owes, or a wake's empty input, paid here. */
  const admit = handler({
    name: "task-settled-admit",
    inputSchema: entryInputSchema,
    outputSchema: admittedSchema,
    execute: async (input, rawCtx) => {
      const ctx = rawCtx as unknown as BlockContext;
      if (!("taskId" in input)) {
        // A wake: pay every delegating ledger this flow declares, at this
        // session's partition. A scan of each, which is fine at a session's
        // scale; Workforce's board runs its own pass entry instead.
        const wake = await ctx.requestHost?.wakes?.read(TASK_SETTLED_ENTRY);
        let nextDue: BoardDebts["nextDue"];
        for (const { ref, delivery } of await delegatingBoardsOf(ctx)) {
          const debts = await payBoardDebts(ctx, ref, {
            ...(delivery.noticeEntry !== undefined ? { noticeEntry: delivery.noticeEntry } : {}),
            ...(delivery.onUndeliverable !== undefined ? { onUndeliverable: delivery.onUndeliverable } : {}),
            filerOf: filerResolver(delivery, ref.partition)
          });
          if (debts.nextDue !== undefined) nextDue = nextDue === undefined ? debts.nextDue : Math.min(nextDue, debts.nextDue);
        }
        await settlePassWake(ctx, TASK_SETTLED_ENTRY, wake, nextDue);
        return { owed: false };
      }
      const notice = input as TaskSettledInput;
      const board = await boardOf(ctx, notice.boardId);
      const row = board?.ref.get(notice.taskId);
      // A notice its row doesn't owe was delivered already, or never owed.
      if (row === undefined || !isNoticeOwed(row, notice)) return { owed: false };
      // Not now: left owed, for the pass to send again, with the time it was
      // turned away, so its age (which ends it as undeliverable) counts from
      // then. Turned away while the request that filed the task is running
      // too (FIX-2123), not while it is parked: a wait in it reads the ending
      // first, and that request sends what is still owed as it ends (at a park, the pass does).
      const own = ctx.request.identity.id;
      const filing = row.filer?.requestId;
      const busy = options.defer !== undefined && (await options.defer(ctx, notice));
      // Turned away for the filing request is recorded as such (FIX-2149): its
      // pass sends the notice past its backoff once that request parks or ends.
      const heldFor = !busy && filing !== undefined && filing !== own && (await isRunning(ctx, filing)) ? filing : undefined;
      const notNow = async (whileRunning?: string) => {
        await board!.ref.patchMetadata(row.id, deferredNoticePatch(row, notice, board!.ref.now(), whileRunning));
        return { owed: false };
      };
      if (busy || heldFor !== undefined) return notNow(heldFor);
      // Taken in one conditional write before the block runs (FIX-2123), so a
      // wait's drop and this delivery can't both go through. Taken by a request
      // that hasn't ended, running or parked: it is delivering it, and this
      // copy runs nothing (recorded as turned away, so the notice doesn't age
      // out while it is delivered). Taken by one that ended without clearing
      // it (its block failed): this copy takes it over.
      const taker = noticeTakenBy(row, notice);
      if (taker !== undefined && taker !== own && !(await hasEnded(ctx, taker))) return notNow();
      if (board!.ref.takeNotice !== undefined) {
        const took = await board!.ref.takeNotice(row.id, notice, {
          by: own,
          ...(taker !== undefined && taker !== own ? { replacing: taker } : {})
        });
        if (took.outcome !== "recorded") return { owed: false };
      }
      return { owed: true, notice: await withCascadeNamed(board!, row, notice) };
    }
  });

  /** The flow's block ran: acknowledge the notice, clearing only its marker. */
  const acknowledge = handler({
    name: "task-settled-acknowledge",
    inputSchema: admittedSchema,
    outputSchema: z.object({}),
    execute: async (admitted, rawCtx) => {
      const ctx = rawCtx as unknown as BlockContext;
      const notice = admitted.notice as TaskNotice;
      const board = await boardOf(ctx, notice.boardId);
      await board?.ref.patchMetadata(notice.taskId, clearNotice(notice));
      return {};
    }
  });

  const block = sequencer({ name: "on-task-settled", inputSchema: entryInputSchema })
    .step(admit)
    .tapIf(
      (admitted: z.infer<typeof admittedSchema>) => admitted.owed,
      (admitted: z.infer<typeof admittedSchema>) => admitted.notice as TaskSettledInput,
      options.block
    )
    .tapIf((admitted: z.infer<typeof admittedSchema>) => admitted.owed, acknowledge);

  return {
    inputSchema: entryInputSchema,
    block,
    concurrency: options.concurrency ?? ("queue" as const)
  };
}
