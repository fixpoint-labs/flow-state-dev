/**
 * What a routed mailbox is made of, apart from the resolution itself: the
 * route value a mailbox kind is built with, the per-mailbox `routing:` setting,
 * the record every route leaves on the mailbox's session, and the ledger the
 * route reads a post's case from.
 *
 * A leaf, so the mailbox flow and `routeByPurpose` can both read it without
 * importing each other. `routeByPurpose` is canonical for how a post finds its
 * member; `mailbox-flow.ts` is canonical for where that runs (before the
 * fan-out's per-member delivery).
 */

import type { BlockDefinition } from "@flow-state-dev/core/types";
import { z } from "zod";
import { mailboxTranscriptLineSchema, type MailboxTranscriptLine } from "./mailbox-post-line";

/**
 * The component name each route's record is emitted under, on the mailbox's
 * session. **Pinned**: a client or a chat registry tells a record from a line
 * (`mailbox-post`) by this name, and must never render one as a line.
 */
export const MAILBOX_ROUTE_COMPONENT = "mailbox-route";

/**
 * The name of the route's evaluator block. **Pinned**: a test or dev model
 * resolver scripts the route's evaluation by it (`resolveEvaluationModel`'s
 * block name). The same string as the record's component name, and a
 * different contract.
 */
export const MAILBOX_ROUTE_EVALUATOR = "mailbox-route";

/**
 * How many of the mailbox's lines before a post the route reads, and the
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
 *   so the mailbox's `routing: fallback:` member took the post. `reason` says why.
 * - `failed`: the fallback could not run either, so nobody did. `reason` says why.
 */
export const mailboxRouteRecordSchema = z.object({
  /** The routed post's line id. */
  postId: z.string(),
  by: z.enum(["held", "evaluated", "fallback", "failed"]),
  /** The member the post went to. Absent on a failed route. */
  member: z.string().optional(),
  /** Why the evaluator's pick was not used. On `fallback` and `failed` only. */
  reason: z.string().optional()
});

export type MailboxRouteRecord = z.infer<typeof mailboxRouteRecordSchema>;

/** A person's post, as the mailbox's fan-out hands it to the route. */
const routedPostSchema = z.object({
  postId: z.string(),
  body: z.string(),
  principal: z.string(),
  author: z.string().optional()
});

/**
 * What the route is handed of a person's post, read off the mailbox's route
 * ledger as the post was kept: the lines before it, and the member still on
 * the person's last post, if any.
 */
export const postCaseSchema = z.object({
  /** The mailbox's last lines before the post (up to {@link RECENT_LINES}), oldest first. */
  recent: z.array(mailboxTranscriptLineSchema),
  /** The member the person's last post went to (by the evaluator or the fallback), with no line from it since. */
  holder: z.string().optional()
});

export type PostCase = z.infer<typeof postCaseSchema>;

/** What a route's block is handed: the post, the mailbox's declared fallback, and the post's case. */
export const routeRequestSchema = postCaseSchema.extend({
  post: routedPostSchema,
  fallback: z.string()
});

/**
 * The session-state key a mailbox keeps its route ledger under. Written on
 * every mailbox of a kind built with a route, whether or not the mailbox
 * declares `routing:`; removed by the first post on a kind built without one.
 */
export const ROUTE_LEDGER_STATE = "mailboxRouteLedger";

/**
 * The route's own record of a mailbox, in the mailbox session's state: what
 * the route needs of the mailbox, kept as each line is kept. Kept while the
 * mailbox is not routed too, so the route has every line when it is again.
 *
 * The route reads a post's case from here, never from the session's items: a
 * request sees those only as far back as its history window (the last 50
 * requests by default), and every read, post and fan-out on the mailbox is
 * one of them. The `mailbox-post` items stay the mailbox's lines; this keeps
 * a copy of the last {@link RECENT_LINES} and nothing older.
 */
const routeLedgerSchema = z.object({
  /** The mailbox's last lines, oldest first, at most {@link RECENT_LINES}. */
  lines: z.array(mailboxTranscriptLineSchema),
  /** The person's last post: who has posted a line since, and its route once recorded. */
  lastPost: z
    .object({
      postId: z.string(),
      /** The authors of the lines kept since the post. */
      spoke: z.array(z.string()),
      by: mailboxRouteRecordSchema.shape.by.optional(),
      member: z.string().optional()
    })
    .optional()
});

export type RouteLedger = z.infer<typeof routeLedgerSchema>;

/** The mailbox session state the route's blocks read and write, as far as the ledger goes. */
export const routeLedgerStateSchema = z.object({ [ROUTE_LEDGER_STATE]: routeLedgerSchema.optional() });

export type RouteLedgerState = z.infer<typeof routeLedgerStateSchema>;

/**
 * Keep one line in the ledger. A person's post (one that did not arrive on
 * the internal seat entry) also comes back with its case: the lines kept
 * before it, and the member still on the person's previous post. That member
 * holds only when the previous post's route is recorded, was the evaluator's
 * or the fallback's, and the member has kept no line since. A claimed
 * `author` does not make the line a seat's: only `seatAuthored`, which the
 * internal entry sets. A post that was itself held holds nothing, and neither
 * does one on a mailbox that was not routed, which never gets a route.
 */
export function keepLine(ledger: RouteLedger, line: MailboxTranscriptLine): { ledger: RouteLedger; postCase?: PostCase } {
  const lines = [...ledger.lines, line].slice(-RECENT_LINES);
  const last = ledger.lastPost;
  if (line.seatAuthored === true) {
    if (last === undefined || line.author === undefined) {
      return { ledger: { lines, ...(last === undefined ? {} : { lastPost: last }) } };
    }
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
export function recordRoute(ledger: RouteLedger | undefined, record: MailboxRouteRecord): RouteLedger | undefined {
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
  by: mailboxRouteRecordSchema.shape.by,
  /** The one member to deliver to. Absent on a failed route: nobody runs. */
  member: z.string().optional(),
  /** The lines the route read, which ride the delivery. */
  recent: z.array(mailboxTranscriptLineSchema)
});

export type RouteDecision = z.infer<typeof routeDecisionSchema>;

/** One mailbox's `routing:` setting, as the binder read it off its `MAILBOX.md`. */
export interface MailboxRouting {
  /** The member who takes a post the route cannot place. */
  fallback: string;
}

/**
 * The key a route carries its resolving block under. Not re-exported from the
 * package root, so only `routeByPurpose` can set it, and a value without it is
 * refused by `defineMailboxFlow`.
 */
export const ROUTE_BLOCK: unique symbol = Symbol("mailbox-route-block");

/**
 * A mailbox kind's route: what `routeByPurpose` returns and
 * `defineMailboxFlow({ route })` takes. Only `routeByPurpose` makes one, so the
 * order a post is placed in, the one-call cap and the record hold for every
 * routed mailbox.
 */
export interface MailboxRoute {
  /**
   * The members this route can send a post to: the logical ids (as a
   * mailbox's `members:` lists them) of the seats it was built with that hear
   * posts. A mailbox's fallback must be one of them.
   */
  readonly members: readonly string[];
  /** The block the mailbox's fan-out runs for a routed post, from `routeRequestSchema` to `routeDecisionSchema`. */
  readonly [ROUTE_BLOCK]: BlockDefinition<any, any>;
}
