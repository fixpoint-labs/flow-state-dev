/**
 * Atomic claim block.
 *
 * Calls the configured dispatcher's `claim` to flip the next eligible
 * task to `in_progress` against the calling worker. Outputs a typed
 * `ClaimResult` describing whether something was claimed and (if so)
 * the claimed task. Side-channels the claim outcome onto the worker's
 * sequencer state (`lastClaimed`) so downstream `checkBoard` can read
 * it without threading the value through `.stepIf` branches; the claim
 * ticket the recorders present is stamped one level deeper, by the
 * worker body's leading tap.
 *
 * The substrate's conditional write inside `collection.claim` decides
 * the contention: the loser's eligibility re-check runs against
 * refreshed state and resolves to **no task**, not to an error. That is
 * "at most one holder at a time", not exactly-once dispatch — a lease
 * reclaim deliberately hands an abandoned task to a second worker, and
 * the guarantee is scoped to one process on a filesystem store. This
 * block surfaces the claim outcome to the pattern layer; it adds no
 * arbitration of its own.
 */
import { handler, logicalBlockIdOf } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { z } from "zod";
import type { Task, TaskCollectionRef, TaskDispatcher } from "../../tasks";
import {
  claimResultSchema,
  taskBoardWorkerStateSchema,
  type ClaimResult,
} from "../schemas";

export interface ClaimTaskOptions {
  name: string;
  collection: (ctx: BlockContext) => Promise<TaskCollectionRef>;
  dispatcher: TaskDispatcher;
  /**
   * Worker-id resolver. The pattern stamps `worker-${index}` per worker;
   * remixers can pass any function that produces a stable string per
   * caller. Used for trace attribution; does not affect routing.
   */
  workerId: (ctx: BlockContext) => string;
}

export type ClaimTaskOutput = ClaimResult;

export function createClaimTask(options: ClaimTaskOptions) {
  const { name, collection: collectionFactory, dispatcher, workerId } = options;
  return handler({
    name,
    // Substrate-internal worker-loop block: a single idle worker can
    // run claim every `idlePollMs` for the lifetime of the board, so
    // its `block_output` trace is the highest-volume noise in the
    // session item stream. Mark transient so the auto-emitted trace
    // is filtered out of client subscriptions and history replay —
    // task-level outcomes flow through `task-change` items instead.
    transient: true,
    inputSchema: z.unknown(),
    outputSchema: claimResultSchema,
    sequencerStateSchema: taskBoardWorkerStateSchema,
    execute: async (_input, ctx): Promise<ClaimResult> => {
      const claim = async () => dispatcher.claim(await collectionFactory(ctx), workerId(ctx), ctx);
      // A request that parked mid-drain replays the drain from its top, and
      // this block's trace is transient, so nothing records the claim it made
      // (FIX-2082): the claim is kept with the request instead, and a replay
      // reads it back rather than claiming again. Keyed by the block's
      // logical path, which names this worker and this pass of its loop.
      // Only the row's id and the attempt it was claimed on are kept (BP-042):
      // the replay reads the rest off the row.
      // No logical id (a context with no block identity): claimed afresh, kept nowhere.
      const key = logicalBlockIdOf(ctx);
      const task =
        ctx.runOnce !== undefined && key !== undefined
          ? await claimedOnce(ctx, `fsd.board.claim:${key}`, claim, collectionFactory)
          : await claim();
      if (task === null) {
        await ctx.sequencer!.patchState({ lastClaimed: false });
        return { claimed: false };
      }
      await ctx.sequencer!.patchState({ lastClaimed: true });
      // Per-task status — surface what the agent is actually working
      // on. Latest-wins, so multi-worker boards cycle through their
      // active task goals naturally.
      ctx.emit.status(`Working...`);
      return { claimed: true, task };
    },
  });
}

/** What a claim keeps with the request: the row and the attempt, or that nothing was claimed. */
type KeptClaim = { readonly claimedId: string; readonly attempts: number } | null;

/**
 * Claim once per logical block, kept with the request (`runOnce`). The first
 * run claims and keeps the row's id and attempt; a replay reads the row again
 * and shows it as it was claimed: running, on that attempt.
 */
async function claimedOnce(
  ctx: BlockContext,
  memoKey: string,
  claim: () => Promise<Task | null>,
  collectionFactory: (ctx: BlockContext) => Promise<TaskCollectionRef>
): Promise<Task | null> {
  let claimedNow: Task | null | undefined;
  const kept = await ctx.runOnce!<KeptClaim>(memoKey, async () => {
    claimedNow = await claim();
    return claimedNow === null ? null : { claimedId: claimedNow.id, attempts: claimedNow.attempts };
  });
  if (claimedNow !== undefined) return claimedNow;
  if (kept === null) return null;
  const collection = await collectionFactory(ctx);
  await collection.refresh?.(kept.claimedId);
  const row = collection.get(kept.claimedId);
  // A row gone since the claim has nothing left to work.
  return row === undefined ? null : ({ ...row, status: "in_progress", attempts: kept.attempts } as Task);
}
