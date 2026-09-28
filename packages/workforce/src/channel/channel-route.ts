/**
 * What a routed channel is made of, apart from the resolution itself: the
 * route value a channel kind is built with, the per-channel `routing:` setting,
 * the record every route leaves on the channel's session, and the ledger the
 * route reads a post's case from.
 *
 * A leaf, so the channel flow and `routeByPurpose` can both read it without
 * importing each other. `routeByPurpose` is canonical for how a post finds its
 * member; `channel-flow.ts` is canonical for where that runs (before the
 * fan-out's per-member delivery).
 */

import type { BlockDefinition } from "@flow-state-dev/core/types";
import { z } from "zod";
import { channelTranscriptLineSchema, type ChannelTranscriptLine } from "./channel-post-line";

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

/**
 * What the route is handed of a person's post, read off the channel's route
 * ledger as the post was kept: the lines before it, and the member still on
 * the person's last post, if any.
 */
export const postCaseSchema = z.object({
  /** The channel's last lines before the post (up to {@link RECENT_LINES}), oldest first. */
  recent: z.array(channelTranscriptLineSchema),
  /** The member the person's last post went to (by the evaluator or the fallback), with no line from it since. */
  holder: z.string().optional()
});

export type PostCase = z.infer<typeof postCaseSchema>;

/** What a route's block is handed: the post, the channel's declared fallback, and the post's case. */
export const routeRequestSchema = postCaseSchema.extend({
  post: routedPostSchema,
  fallback: z.string()
});

/**
 * The session-state key a channel keeps its route ledger under. Written on
 * every channel of a kind built with a route, whether or not the channel
 * declares `routing:`; removed by the first post on a kind built without one.
 */
export const ROUTE_LEDGER_STATE = "channelRouteLedger";

/**
 * The route's own record of a channel, in the channel session's state: what
 * the route needs of the channel, kept as each line is kept. Kept while the
 * channel is not routed too, so the route has every line when it is again.
 *
 * The route reads a post's case from here, never from the session's items: a
 * request sees those only as far back as its history window (the last 50
 * requests by default), and every read, post and fan-out on the channel is
 * one of them. The `channel-post` items stay the channel's lines; this keeps
 * a copy of the last {@link RECENT_LINES} and nothing older.
 */
const routeLedgerSchema = z.object({
  /** The channel's last lines, oldest first, at most {@link RECENT_LINES}. */
  lines: z.array(channelTranscriptLineSchema),
  /** The person's last post: who has posted a line since, and its route once recorded. */
  lastPost: z
    .object({
      postId: z.string(),
      /** The authors of the lines kept since the post. */
      spoke: z.array(z.string()),
      by: channelRouteRecordSchema.shape.by.optional(),
      member: z.string().optional()
    })
    .optional()
});

export type RouteLedger = z.infer<typeof routeLedgerSchema>;

/** The channel session state the route's blocks read and write, as far as the ledger goes. */
export const routeLedgerStateSchema = z.object({ [ROUTE_LEDGER_STATE]: routeLedgerSchema.optional() });

export type RouteLedgerState = z.infer<typeof routeLedgerStateSchema>;

/**
 * Keep one line in the ledger. A person's post (no `author`) also comes back
 * with its case: the lines kept before it, and the member still on the
 * person's previous post. That member holds only when the previous post's
 * route is recorded, was the evaluator's or the fallback's, and the member has
 * kept no line since. A post that was itself held holds nothing, and neither
 * does one on a channel that was not routed, which never gets a route.
 */
export function keepLine(ledger: RouteLedger, line: ChannelTranscriptLine): { ledger: RouteLedger; postCase?: PostCase } {
  const lines = [...ledger.lines, line].slice(-RECENT_LINES);
  const last = ledger.lastPost;
  if (line.author !== undefined) {
    if (last === undefined) return { ledger: { lines } };
    const spoke = last.spoke.includes(line.author) ? last.spoke : [...last.spoke, line.author];
    return { ledger: { lines, lastPost: { ...last, spoke } } };
  }
  const holder =
    last?.member !== undefined && (last.by === "evaluated" || last.by === "fallback") && !last.spoke.includes(last.member)
      ? last.member
      : undefined;
  return {
    ledger: { lines, lastPost: { postId: line.id, spoke: [] } },
    postCase: { recent: ledger.lines, ...(holder === undefined ? {} : { holder }) }
  };
}

/**
 * Note a route in the ledger, while its post is still the person's last one.
 * `undefined` when there is nothing to note: a later post has been kept since,
 * and its own case was read without this route, so it holds nothing.
 */
export function recordRoute(ledger: RouteLedger | undefined, record: ChannelRouteRecord): RouteLedger | undefined {
  if (ledger?.lastPost?.postId !== record.postId) return undefined;
  return {
    ...ledger,
    lastPost: {
      ...ledger.lastPost,
      by: record.by,
      ...(record.member === undefined ? {} : { member: record.member })
    }
  };
}

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
 * The key a route carries its resolving block under. Not re-exported from the
 * package root, so only `routeByPurpose` can set it, and a value without it is
 * refused by `defineChannelFlow`.
 */
export const ROUTE_BLOCK: unique symbol = Symbol("channel-route-block");

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
  /** The block the channel's fan-out runs for a routed post, from `routeRequestSchema` to `routeDecisionSchema`. */
  readonly [ROUTE_BLOCK]: BlockDefinition<any, any>;
}
