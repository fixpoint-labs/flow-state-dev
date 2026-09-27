/**
 * What a routed channel is made of, apart from the resolution itself: the
 * route value a channel kind is built with, the per-channel `routing:` setting,
 * and the record every route leaves on the channel's session.
 *
 * A leaf, so the channel flow and `routeByPurpose` can both read it without
 * importing each other. `routeByPurpose` is canonical for how a post finds its
 * member; `channel-flow.ts` is canonical for where that runs (before the
 * fan-out's per-member delivery).
 */

import type { BlockDefinition } from "@flow-state-dev/core/types";
import { z } from "zod";
import { channelTranscriptLineSchema } from "./channel-post-line";

/**
 * The component name each route's record is emitted under, on the channel's
 * session. **Pinned**: a client or a chat registry tells a record from a line
 * (`channel-post`) by this name, and must never render one as a line.
 */
export const CHANNEL_ROUTE_COMPONENT = "channel-route";

/**
 * The name of the route's evaluator block. **Pinned**: a test or dev model
 * resolver scripts the route's evaluation by it (`resolveEvaluationModel`'s
 * block name). The same string as the record's component name, and a
 * different contract.
 */
export const CHANNEL_ROUTE_EVALUATOR = "channel-route";

/**
 * How many of the channel's lines before a post the route reads, and the
 * routed member's turn is handed. One window for both.
 */
export const RECENT_LINES = 20;

/**
 * One route's record. `by` says how the member was found:
 *
 * - `held`: the person's last post went to `member`, which has not answered
 *   since. No model call.
 * - `evaluated`: the one evaluator call picked `member`.
 * - `fallback`: the call failed, or picked something that is not an option,
 *   so the channel's `routing: fallback:` member took the post. `reason` says why.
 * - `failed`: the fallback could not run either, so nobody did. `reason` says why.
 */
export const channelRouteRecordSchema = z.object({
  /** The routed post's line id. */
  postId: z.string(),
  by: z.enum(["held", "evaluated", "fallback", "failed"]),
  /** The member the post went to. Absent on a failed route. */
  member: z.string().optional(),
  /** Why the evaluator's pick was not used. On `fallback` and `failed` only. */
  reason: z.string().optional()
});

export type ChannelRouteRecord = z.infer<typeof channelRouteRecordSchema>;

/** A person's post, as the channel's fan-out hands it to the route. */
const routedPostSchema = z.object({
  postId: z.string(),
  body: z.string(),
  principal: z.string(),
  author: z.string().optional()
});

/** What a route's block is handed: the post, and the channel's declared fallback. */
export const routeRequestSchema = z.object({
  post: routedPostSchema,
  fallback: z.string()
});

/** What a route's block hands back to the fan-out. */
export const routeDecisionSchema = z.object({
  post: routedPostSchema,
  by: channelRouteRecordSchema.shape.by,
  /** The one member to deliver to. Absent on a failed route: nobody runs. */
  member: z.string().optional(),
  /** The lines the route read, which ride the delivery. */
  recent: z.array(channelTranscriptLineSchema)
});

export type RouteDecision = z.infer<typeof routeDecisionSchema>;

/** One channel's `routing:` setting, as the binder read it off its `CHANNEL.md`. */
export interface ChannelRouting {
  /** The member who takes a post the route cannot place. */
  fallback: string;
}

/**
 * A channel kind's route: what `routeByPurpose` returns and
 * `defineChannelFlow({ route })` takes. Only `routeByPurpose` makes one, so the
 * order a post is placed in, the one-call cap and the record hold for every
 * routed channel.
 */
export interface ChannelRoute {
  /**
   * The members this route can send a post to: the logical ids (as a
   * channel's `members:` lists them) of the seats it was built with that hear
   * posts. A channel's fallback must be one of them.
   */
  readonly members: readonly string[];
}

/** Each route's resolving block, by the route value `routeByPurpose` returned. */
const routeBlocks = new WeakMap<ChannelRoute, BlockDefinition<any, any>>();

/**
 * Record the block a route resolves posts with. `routeByPurpose`'s alone.
 *
 * @param route The value handed back to the app.
 * @param block The block the channel's fan-out runs for a routed post.
 * @returns `route`, now one the channel flow accepts.
 */
export function registerChannelRoute(route: ChannelRoute, block: BlockDefinition<any, any>): ChannelRoute {
  routeBlocks.set(route, block);
  return route;
}

/**
 * The block a route resolves posts with, or `undefined` for a value no
 * `routeByPurpose` call made.
 */
export function channelRouteBlock(route: ChannelRoute): BlockDefinition<any, any> | undefined {
  return routeBlocks.get(route);
}
