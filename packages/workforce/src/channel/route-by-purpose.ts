/**
 * `routeByPurpose`: the route a channel kind takes, so a person's post to a
 * channel that declares `routing:` reaches one member, picked by what it is
 * about.
 *
 * One resolution, in this order, and one record of it:
 *
 * 1. **The member already on it.** The person's last post went to a member,
 *    by the evaluator or the fallback, and that member has posted no line
 *    since: this post goes there too, with no model call. A post that was
 *    itself held, or whose route is not recorded yet, holds nothing.
 * 2. **One evaluator call** (block name `channel-route`): which member should
 *    answer? It reads the channel's last lines and the post, and chooses among
 *    the channel's members whose seat hears posts and this caller can reach
 *    (the wake's own test), each described by its `WORKER.md` `description:`.
 * 3. **The fallback.** The call failed, or answered with something that is not
 *    an option: the channel's `routing: fallback:` member takes the post. If the
 *    fallback is not an option either, nobody does.
 *
 * Only the evaluator call's own failure reaches the fallback; any other error
 * fails the fan-out like any other. Every route is recorded as one
 * `channel-route` item on the channel's session, never as a line.
 *
 * The evaluation's state is `{ recent, post }`: `recent` the lines before the
 * post, oldest first, and `post` the post, each as `{ from, text }` where
 * `from` is the line's `author`, else its `principal`. A scripted evaluation
 * reads that shape.
 */

import { choice, evaluator, handler, sequencer } from "@flow-state-dev/core";
import type { BlockContext, EvaluationModel, FlowInstance } from "@flow-state-dev/core/types";
import { z } from "zod";
import { seatDescription } from "../seat-description";
import { boundChannel, emitChannelRouteRecord, readChannelPostLines, readChannelRouteRecords } from "./channel-flow";
import { channelTranscriptLineSchema, type ChannelTranscriptLine } from "./channel-post-line";
import {
  CHANNEL_ROUTE_EVALUATOR,
  RECENT_LINES,
  registerChannelRoute,
  routeDecisionSchema,
  routeRequestSchema,
  type ChannelRoute,
  type ChannelRouteRecord,
  type RouteDecision
} from "./channel-route";
import { hearingSeatsById, reachableSeat } from "./wake-member-seats";

/** Options for {@link routeByPurpose}. */
export interface RouteByPurposeOptions {
  /**
   * The model the route's one evaluator call runs on: a model string the
   * app's resolver turns into an evaluation model, or an evaluation model.
   * It must be able to evaluate; a model that cannot sends every post to the
   * fallback.
   */
  model: string | EvaluationModel;
}

/** What the evaluator is asked. */
const ROUTE_QUESTION =
  "Which specialist should answer the post? A post that answers a question a specialist just asked goes to that specialist.";

/** Everything the decision is made from, read once from the channel. */
const routeCaseSchema = routeRequestSchema.extend({
  recent: z.array(channelTranscriptLineSchema),
  /** Member id → its description, for each member this caller can route to. */
  options: z.record(z.string().nullable()),
  /** The member already on the person's last post, when there is one to hold. */
  held: z.string().optional()
});

type RouteCase = z.infer<typeof routeCaseSchema>;

/** What a failed evaluator call leaves: the reason, as a value. */
const failedEvaluationSchema = z.object({ failed: z.string() });

/** A line as the evaluator reads it. */
function said(line: { author?: string; principal: string; body: string }) {
  return { from: line.author ?? line.principal, text: line.body };
}

/**
 * Build a channel kind's route from the seats the host hired.
 *
 * @param seats The seats `hireWorkforce` returned, the same ones passed to
 *   `wakeMemberSeats`. Only those that hear posts can be routed to.
 * @param options `model`: the evaluation model the one call runs on. Required;
 *   the package names no default.
 * @returns The route, for `defineChannelFlow({ route })`.
 */
export function routeByPurpose(seats: readonly FlowInstance[], options: RouteByPurposeOptions): ChannelRoute {
  if (options?.model === undefined) {
    throw new Error(
      "routeByPurpose needs a `model`: the evaluation model the route's one call runs on. " +
        "The package names no default."
    );
  }
  const hearing = hearingSeatsById(seats);

  /** The channel's lines and route records, the holder, and the options. */
  const readCase = handler({
    name: "channel-route-case",
    inputSchema: routeRequestSchema,
    outputSchema: routeCaseSchema,
    execute: (request, ctx): RouteCase => {
      const channel = boundChannel(ctx.session.state);
      const lines = [
        ...(channel?.transcript ?? []),
        ...readChannelPostLines(ctx, channelTranscriptLineSchema)
      ];
      const at = lines.findIndex((line) => line.id === request.post.postId);
      const before = uniqueById(at === -1 ? lines : lines.slice(0, at));

      const options: Record<string, string | null> = {};
      for (const member of channel?.members ?? []) {
        const seat = reachableSeat(hearing.get(member) ?? [], ctx);
        if (seat !== undefined) options[member] = seatDescription(seat) ?? null;
      }

      const held = holder(before, readChannelRouteRecords(ctx));
      return {
        ...request,
        recent: before.slice(-RECENT_LINES),
        options,
        ...(held !== undefined && Object.hasOwn(options, held) ? { held } : {})
      };
    }
  });

  const evaluate = evaluator({
    name: CHANNEL_ROUTE_EVALUATOR,
    model: options.model,
    inputSchema: routeCaseSchema,
    state: (routeCase: RouteCase) => ({ recent: routeCase.recent.map(said), post: said(routeCase.post) }),
    questions: (routeCase: RouteCase) => ({ member: choice(ROUTE_QUESTION, routeCase.options) })
  });

  /** The call's own failure, as a value the decision reads. Nothing else is caught. */
  const evaluationFailed = handler({
    name: "channel-route-evaluation-failed",
    inputSchema: z.unknown(),
    outputSchema: failedEvaluationSchema,
    execute: (error: unknown) => ({ failed: error instanceof Error ? error.message : String(error) })
  });

  /** Place the post, from the case and what the call (if any) answered, and record it. */
  const settle = handler({
    name: "channel-route-settle",
    inputSchema: z.unknown(),
    outputSchema: routeDecisionSchema,
    execute: async (answer: unknown, ctx: BlockContext): Promise<RouteDecision> => {
      const routeCase = routeCaseSchema.parse(ctx.parent?.input);
      const placed = place(routeCase, answer);
      const record: ChannelRouteRecord = {
        postId: routeCase.post.postId,
        by: placed.by,
        ...(placed.member === undefined ? {} : { member: placed.member }),
        ...(placed.reason === undefined ? {} : { reason: placed.reason })
      };
      await emitChannelRouteRecord(ctx, record);
      return {
        post: routeCase.post,
        by: placed.by,
        ...(placed.member === undefined ? {} : { member: placed.member }),
        recent: routeCase.recent
      };
    }
  });

  const decide = sequencer({ name: "channel-route-decide", inputSchema: routeCaseSchema })
    .stepIf(
      (routeCase: RouteCase) => routeCase.held === undefined && Object.keys(routeCase.options).length > 0,
      evaluate.rescue([{ block: evaluationFailed }])
    )
    .step(settle);

  const resolve = sequencer({
    name: "channel-route-resolve",
    inputSchema: routeRequestSchema,
    outputSchema: routeDecisionSchema
  })
    .step(readCase)
    .step(decide);

  return registerChannelRoute({ members: [...hearing.keys()].sort() }, resolve);
}

/** Lines in order, keeping the first line with each id. */
function uniqueById(lines: ChannelTranscriptLine[]): ChannelTranscriptLine[] {
  const seen = new Set<string>();
  return lines.filter((line) => {
    if (seen.has(line.id)) return false;
    seen.add(line.id);
    return true;
  });
}

/**
 * The member still on the person's last post, read from the lines and the
 * route records alone: that post was routed by the evaluator or the fallback,
 * and the member has posted no line since. A channel's session takes posts
 * from its one owner, so the person's last post is the last line with no
 * `author`.
 */
function holder(before: ChannelTranscriptLine[], records: ChannelRouteRecord[]): string | undefined {
  let last = -1;
  for (let i = before.length - 1; i >= 0; i -= 1) {
    if (before[i]!.author === undefined) {
      last = i;
      break;
    }
  }
  if (last === -1) return undefined;
  const record = records.find((entry) => entry.postId === before[last]!.id);
  if (record === undefined || record.member === undefined) return undefined;
  if (record.by !== "evaluated" && record.by !== "fallback") return undefined;
  const answered = before.slice(last + 1).some((line) => line.author === record.member);
  return answered ? undefined : record.member;
}

/** Where the post goes, given the case and what the evaluator step left. */
function place(
  routeCase: RouteCase,
  answer: unknown
): { by: ChannelRouteRecord["by"]; member?: string; reason?: string } {
  if (routeCase.held !== undefined) return { by: "held", member: routeCase.held };

  const failed = failedEvaluationSchema.safeParse(answer);
  const choice = (answer as { answers?: { member?: { choice?: unknown } } } | undefined)?.answers?.member?.choice;
  let reason: string;
  if (Object.keys(routeCase.options).length === 0) {
    reason = "no member of the channel has a seat this caller can reach that hears posts";
  } else if (failed.success) {
    reason = `the evaluation failed: ${failed.data.failed}`;
  } else if (typeof choice === "string" && Object.hasOwn(routeCase.options, choice)) {
    return { by: "evaluated", member: choice };
  } else {
    reason = `the evaluation answered ${JSON.stringify(choice)}, which is not one of the options`;
  }

  if (Object.hasOwn(routeCase.options, routeCase.fallback)) {
    return { by: "fallback", member: routeCase.fallback, reason };
  }
  return {
    by: "failed",
    reason: `${reason}; the fallback "${routeCase.fallback}" has no seat this caller can reach that hears posts`
  };
}
