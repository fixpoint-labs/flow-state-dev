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
  resolveResourceCollection,
  type TaskCollectionRef,
} from "../tasks";

export function resolveResourceTaskCollection<TInput = unknown, TOutput = unknown>(
  ctx: BlockContext,
  opts: { boardName: string; resourceKey: string; collectionId: string }
): Promise<TaskCollectionRef<TInput, TOutput>> {
  const collection = resolveResourceCollection(ctx, opts.resourceKey);
  if (collection === undefined) {
    throw new Error(
      `[task-board] durable board "${opts.boardName}" could not resolve its resource ` +
        `collection at ctx.resources["${opts.resourceKey}"]. Run this block under ` +
        `board.drain or list board.capability in \`uses\`.`
    );
  }
  return getOrCreateTaskCollection<TInput, TOutput>({
    ctx,
    backing: "resource",
    collectionId: opts.collectionId,
    collection,
  });
}
