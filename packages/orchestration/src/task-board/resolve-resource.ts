/**
 * Resolve a durable board's `TaskCollectionRef` from the resource registry.
 *
 * Shared by the two places a resource-backed board reaches its collection: the
 * board's own drain factory (`index.ts`) and the capability accessor
 * (`capability.ts`). Keeping the lookup + not-registered error in one spot means
 * the "how did the resource fail to resolve" message never drifts between them.
 */
import type { BlockContext } from "@flow-state-dev/core/types";
import {
  getOrCreateTaskCollection,
  hasFrozenLedgerAssignee,
  resolveResourceCollection,
  type DefinedTaskCollection,
  type TaskCollectionRef,
} from "../tasks";
import { resolveTaskPartition } from "../tasks/collection/partition";

export async function resolveResourceTaskCollection<TInput = unknown, TOutput = unknown>(
  ctx: BlockContext,
  opts: {
    boardName: string;
    resourceKey: string;
    collectionId: string;
    /**
     * The ledger declaration this board binds (FIX-982). Carries the frozen-
     * assignee policy, which is read HERE — at resolution — rather than passed
     * in as a boolean the caller captured when it was constructed.
     *
     * Both of a durable board's routes to its rows come through this function
     * (the drain's factory and the `ctx.cap.<name>` accessor), and so does every
     * other board bound to the same declaration. Reading the policy off the
     * shared declaration at the moment of resolution is what makes those agree:
     * a boolean captured per call site guards only that call site, and one
     * captured before the handed-off board was declared would be stale besides.
     */
    ledger: DefinedTaskCollection;
    /**
     * The partition to read, when a dispatch names one: the receiving gate
     * reads the row where the board claimed it, never where its own context
     * would put it. Omitted, a partitioned ledger reads the partition its
     * `partitionBy` names for the running context.
     */
    partition?: string;
  }
): Promise<TaskCollectionRef<TInput, TOutput>> {
  const collection = resolveResourceCollection(ctx, opts.resourceKey);
  if (collection === undefined) {
    throw new Error(
      `[task-board] durable board "${opts.boardName}" could not resolve its resource ` +
        `collection at ctx.resources["${opts.resourceKey}"]. Run this block under ` +
        `board.drain or list board.capability in \`uses\`.`
    );
  }
  const partitionBy = opts.ledger.__taskCollection.partitionBy;
  const partition =
    opts.partition ??
    (partitionBy === undefined
      ? undefined
      : await resolveTaskPartition(opts.collectionId, partitionBy, ctx));
  return getOrCreateTaskCollection<TInput, TOutput>({
    ctx,
    backing: "resource",
    collectionId: opts.collectionId,
    collection,
    immutableAssignee: hasFrozenLedgerAssignee(opts.ledger),
    ...(partition !== undefined ? { partition } : {}),
  });
}
