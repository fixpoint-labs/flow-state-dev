/**
 * The routing record: one `coordinator-route` item per routing decision, on
 * the coordinator's conversation, never a line.
 *
 * `by` says how the delegates were found:
 *
 * - `judgment`: the coordinator's own turn decided, handing off with its tool
 *   or answering itself.
 * - `held`: best fit, and the person's last post went to a delegate that
 *   hasn't answered since. No model call.
 * - `evaluated`: best fit's one evaluator call picked the delegate.
 * - `fallback`: best fit couldn't place it, and the fallback delegate took it.
 * - `round-robin`: the next delegate in list order took it.
 * - `everyone`: each delegate that can be reached got it.
 * - `unplaced`: nobody took it. `none` says why.
 *
 * Each delegate the decision touched is listed: delivered, skipped with why
 * (fired, its flow can't take a post, already handed this post), or failed
 * with why (the dispatch was refused).
 */
import type { BlockContext } from "@flow-state-dev/core/types";
import { z } from "zod";
import { deliveryDelegateSchema } from "../delivery-ledger";
import { COORDINATOR_ROUTE } from "./coordinator-keys";

/** How a decision found its delegates. */
export const coordinatorRouteBySchema = z.enum([
  "judgment",
  "held",
  "evaluated",
  "fallback",
  "round-robin",
  "everyone",
  "unplaced"
]);

/** What became of one delegate in a decision. */
export const routedDelegateSchema = deliveryDelegateSchema.extend({
  outcome: z.enum(["delivered", "skipped", "failed"]),
  reason: z.string().optional()
});

export type RoutedDelegate = z.infer<typeof routedDelegateSchema>;

/** One routing decision's record. */
export const coordinatorRouteRecordSchema = z.object({
  /** The post routed. */
  postId: z.string(),
  /** The round it was routed in: 0 for a person's post, one more each time answers go back out. */
  round: z.number().int().min(0),
  /** The conversation's routing policy. */
  policy: z.string(),
  by: coordinatorRouteBySchema,
  /** Each delegate the decision touched. */
  delegates: z.array(routedDelegateSchema),
  /** Why nobody was delivered to, when nobody was. */
  none: z.string().optional()
});

export type CoordinatorRouteRecord = z.infer<typeof coordinatorRouteRecordSchema>;

/**
 * Keep a routing record on the conversation, resolving once it is stored. A
 * record nothing can confirm was kept is a failure, never a fall back to the
 * fire-and-forget emitter.
 */
export async function emitCoordinatorRoute(ctx: BlockContext, record: CoordinatorRouteRecord): Promise<void> {
  const emit = ctx._emitComponentAwaited;
  if (emit === undefined) {
    throw new Error("coordinator route: this context cannot confirm the decision was recorded, so it routes nobody");
  }
  await emit.call(ctx, COORDINATOR_ROUTE, coordinatorRouteRecordSchema.parse(record));
}
