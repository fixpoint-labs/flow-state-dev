/**
 * `routeByPurpose`: the route a mailbox kind takes, so a person's post to a
 * mailbox that declares `routing:` reaches one member, picked by what it is
 * about.
 *
 * One resolution, in this order, and one record of it:
 *
 * 1. **The member already on it.** The person's last post went to a member,
 *    by the evaluator or the fallback, and that member has posted no line
 *    since: this post goes there too, with no model call. A post that was
 *    itself held, or whose route is not recorded yet, holds nothing.
 * 2. **One evaluator call** (block name `mailbox-route`): which member should
 *    answer? It reads the mailbox's last lines and the post, and chooses among
 *    the mailbox's members whose seat hears posts and this caller can reach
 *    (the wake's own test), each described by its `WORKER.md` `description:`.
 *    A seat with no description (a runtime hire has none) is not a choice; it
 *    can still be the fallback, and be held.
 * 3. **The fallback.** The call failed, or answered with something that is not
 *    an option: the mailbox's `routing: fallback:` member takes the post. If the
 *    caller cannot reach the fallback's seat either, nobody does.
 *
 * Only the evaluator call's own failure reaches the fallback; any other error
 * fails the fan-out like any other, and so does a cancel until the route is
 * committed: one that lands before the ledger takes the route makes no later
 * write and wakes nobody, and one that lands before the route records
 * anything leaves no trace. Once the ledger has it, the member is woken.
 * Every route is recorded as one `mailbox-route` item on the mailbox's
 * session, never as a line.
 *
 * The lines and the member on the person's last post come from the mailbox's
 * route ledger (`mailbox-route.ts`), read as the post was kept, and never from
 * the session's items: those reach back only as far as the request's history
 * window, which a busy mailbox's reads and fan-outs use up.
 *
 * The evaluation's state is `{ recent, post }`: `recent` the lines before the
 * post, oldest first, and `post` the post, each as `{ from, text }` where
 * `from` is the line's `author`, else its `principal`. A scripted evaluation
 * reads that shape.
 */

import { choice, evaluator, handler, sequencer } from "@flow-state-dev/core";
import type { EvaluationModel, FlowInstance } from "@flow-state-dev/core/types";
import { z } from "zod";
import { bestFitEvaluationFailed, needsBestFitCall, placeBestFit, type BestFitMiss } from "../best-fit";
import { seatDescription } from "../seat-description";
import { boundMailbox } from "./mailbox-flow";
import { emitMailboxRouteRecord } from "./mailbox-items";
import {
  MAILBOX_ROUTE_EVALUATOR,
  recordRoute,
  ROUTE_BLOCK,
  ROUTE_LEDGER_STATE,
  routeDecisionSchema,
  routeLedgerStateSchema,
  routeRequestSchema,
  type MailboxRoute,
  type MailboxRouteRecord,
  type RouteDecision
} from "./mailbox-route";
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

/** Everything the decision is made from: the post's case, and who this caller can reach. */
const routeCaseSchema = routeRequestSchema.extend({
  /** The members this caller can route to: each has a seat that hears posts and the caller can reach. */
  reachable: z.array(z.string()),
  /** Member id → its description, for each reachable member that has one: the evaluator's choices. */
  options: z.record(z.string()),
  /** The member already on the person's last post, when there is one to hold. */
  held: z.string().optional()
});

type RouteCase = z.infer<typeof routeCaseSchema>;

/** A line as the evaluator reads it. */
function said(line: { author?: string; principal: string; body: string }) {
  return { from: line.author ?? line.principal, text: line.body };
}

/**
 * Build a mailbox kind's route from the seats the host hired.
 *
 * @param seats The seats `hireWorkforce` returned, the same ones passed to
 *   `wakeMemberSeats`. Only those that hear posts can be routed to.
 * @param options `model`: the evaluation model the one call runs on. Required;
 *   the package names no default.
 * @returns The route, for `defineMailboxFlow({ route })`.
 */
export function routeByPurpose(seats: readonly FlowInstance[], options: RouteByPurposeOptions): MailboxRoute {
  if (options?.model === undefined) {
    throw new Error(
      "routeByPurpose needs a `model`: the evaluation model the route's one call runs on. " +
        "The package names no default."
    );
  }
  const hearing = hearingSeatsById(seats);

  /** The members this caller can route to, the options, and whether the post's holder is one of them. */
  const readCase = handler({
    name: "mailbox-route-case",
    inputSchema: routeRequestSchema,
    outputSchema: routeCaseSchema,
    execute: (request, ctx): RouteCase => {
      // Reachable members can be held and can be the fallback. Only those with
      // a description are the evaluator's options: it picks by purpose, and a
      // seat hired at runtime has none to pick by.
      const reachable: string[] = [];
      const options: Record<string, string> = {};
      for (const member of boundMailbox(ctx.session.state)?.members ?? []) {
        const seat = reachableSeat(hearing.get(member) ?? [], ctx);
        if (seat === undefined) continue;
        reachable.push(member);
        const description = seatDescription(seat);
        if (description !== undefined) options[member] = description;
      }
      const held = request.holder;
      return {
        ...request,
        reachable,
        options,
        ...(held !== undefined && reachable.includes(held) ? { held } : {})
      };
    }
  });

  const evaluate = evaluator({
    name: MAILBOX_ROUTE_EVALUATOR,
    model: options.model,
    inputSchema: routeCaseSchema,
    state: (routeCase: RouteCase) => ({ recent: routeCase.recent.map(said), post: said(routeCase.post) }),
    questions: (routeCase: RouteCase) => ({ member: choice(ROUTE_QUESTION, routeCase.options) })
  });

  /**
   * The call's own failure, as a value the decision reads. Nothing else is
   * caught. A cancelled request is not a failed call: its error goes on up, so
   * nothing is placed, recorded, noted in the ledger or woken.
   */
  const evaluationFailed = bestFitEvaluationFailed("mailbox-route-evaluation-failed");

  /**
   * Place the post, from the case and what the call (if any) answered, and
   * record it: as the mailbox's `mailbox-route` item, then in the ledger the
   * next post's case is read from. The item first, so a ledger that could not
   * take the route fails the delivery with nobody left holding the next post.
   *
   * The ledger write is the route's commit point. A cancel is read before
   * each write: one seen before the ledger takes the route stops it, with no
   * later write and nobody woken (a record already under way is kept). Once
   * the ledger has the route, the next post is held for its member, so the
   * member is woken: a cancel that lands later is too late.
   */
  const settle = handler({
    name: "mailbox-route-settle",
    inputSchema: z.unknown(),
    outputSchema: routeDecisionSchema,
    sessionStateSchema: routeLedgerStateSchema,
    execute: async (answer: unknown, ctx): Promise<RouteDecision> => {
      const routeCase = routeCaseSchema.parse(ctx.parent?.input);
      const placed = place(routeCase, answer);
      const record: MailboxRouteRecord = {
        postId: routeCase.post.postId,
        by: placed.by,
        ...(placed.member === undefined ? {} : { member: placed.member }),
        ...(placed.reason === undefined ? {} : { reason: placed.reason })
      };
      ctx.signal.throwIfAborted();
      await emitMailboxRouteRecord(ctx, record);
      ctx.signal.throwIfAborted();
      await ctx.session.atomicState((state) => {
        const ledger = recordRoute(state[ROUTE_LEDGER_STATE], record);
        return ledger === undefined ? {} : { [ROUTE_LEDGER_STATE]: ledger };
      });
      return {
        post: routeCase.post,
        by: placed.by,
        ...(placed.member === undefined ? {} : { member: placed.member }),
        recent: routeCase.recent
      };
    }
  });

  const decide = sequencer({ name: "mailbox-route-decide", inputSchema: routeCaseSchema })
    .stepIf((routeCase: RouteCase) => needsBestFitCall(ladderCase(routeCase)), evaluate.rescue([{ block: evaluationFailed }]))
    .step(settle);

  const resolve = sequencer({
    name: "mailbox-route-resolve",
    inputSchema: routeRequestSchema,
    outputSchema: routeDecisionSchema
  })
    .step(readCase)
    .step(decide);

  return { members: [...hearing.keys()].sort(), [ROUTE_BLOCK]: resolve };
}

/** The mailbox's case as best fit's ladder reads it. */
function ladderCase(routeCase: RouteCase) {
  return {
    ...(routeCase.held === undefined ? {} : { held: routeCase.held }),
    reachable: routeCase.reachable,
    options: routeCase.options,
    fallback: routeCase.fallback
  };
}

/** Why the ladder didn't use the evaluator's pick, in the mailbox's words. */
function missReason(miss: BestFitMiss): string {
  switch (miss.kind) {
    case "none-reachable":
      return "no member of the mailbox has a seat this caller can reach that hears posts";
    case "none-described":
      return "no member this caller can reach has a description to route by";
    case "evaluation-failed":
      return `the evaluation failed: ${miss.message}`;
    case "not-an-option":
      return `the evaluation answered ${JSON.stringify(miss.choice)}, which is not one of the options`;
  }
}

/** Where the post goes, given the case and what the evaluator step left: best fit's ladder. */
function place(
  routeCase: RouteCase,
  answer: unknown
): { by: MailboxRouteRecord["by"]; member?: string; reason?: string } {
  const placed = placeBestFit(ladderCase(routeCase), answer);
  if (placed.by === "held" || placed.by === "evaluated") return { by: placed.by, member: placed.member };
  const reason = missReason(placed.miss);
  if (placed.by === "fallback") return { by: "fallback", member: placed.member, reason };
  return {
    by: "failed",
    reason: `${reason}; the fallback "${routeCase.fallback}" has no seat this caller can reach that hears posts`
  };
}
