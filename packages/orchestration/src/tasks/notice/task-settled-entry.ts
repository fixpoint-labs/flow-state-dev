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
 * owes it, runs the flow's block with it, and then acknowledges it (clears the
 * row's marker), so a block that fails leaves the notice owed and the filer's
 * next pass sends it again. Queued on the session by default, so a second
 * copy of one notice waits behind the first and finds it no longer owed.
 *
 * Woken with an empty input, by the wake a board's delivery owes when it
 * names this entry as its pass (the default): it pays what this session's
 * boards still owe ({@link payBoardDebts}) and settles the wake.
 */
import { handler, sequencer } from "@flow-state-dev/core";
import type { BlockContext, BlockDefinition, ConcurrencyConfig } from "@flow-state-dev/core/types";
import { z } from "zod";
import { clearNotice, isNoticeOwed, type TaskNotice } from "./task-notice";
import { filerResolver, TASK_SETTLED_ENTRY } from "./delivery";
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
}

/** The running session's board a notice names, at this session's partition. */
async function boardOf(ctx: BlockContext, boardId: string) {
  return (await delegatingBoardsOf(ctx)).find((board) => board.ref.collectionId === boardId);
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
      return { owed: true, notice };
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
