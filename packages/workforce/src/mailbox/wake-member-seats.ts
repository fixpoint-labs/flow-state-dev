/**
 * `wakeMemberSeats`: the notify block that wakes a mailbox's agent members.
 *
 * A mailbox runs its notify block once per declared member per post, and the
 * block decides what that member gets. This one decides it from the seats the
 * host hired, and from nothing else:
 *
 * - **A member wakes** when the post is not a seat's and the member's hired
 *   seat declares the internal `onMailboxPost` entry. The seat runs that entry
 *   in one conversation per mailbox, keyed `mailbox:<mailboxId>`, so the next
 *   post it hears lands in the same conversation.
 * - **Nothing runs** for a member that would have woken, when the post is a
 *   seat's (`seatAuthored`). That bit is set by the seat post action and the
 *   answer entry. A `post`, including one another flow dispatches, does not
 *   set it, and a caller-supplied `author` does not withhold the wake: two
 *   seats that wake each other answer each other forever, and there is no
 *   option to turn the seat rule off.
 * - **The fallback runs** for every other member: one whose seat declares no
 *   `onMailboxPost`, or who has no seat among those passed. Silent unless the
 *   host passes one.
 *
 * Which seat can hear a post is read off the seat itself, so there is no list
 * of kinds to keep in step. A kind says it can hear a post where it says how.
 *
 * The seats are passed as a list, fixed when the block is built, or as a
 * getter (the host's live registry), read when a post is delivered: once per
 * post, shared by every member it reaches and by the route's case for it. A
 * getter is how a seat hired after boot is woken, and how one taken out of the
 * registry stops being woken.
 *
 * The addresses are the seats passed in, never a mailbox's stored members: a
 * dispatch target read out of stored data is refused by the substrate, and a
 * stored list is caller-reachable input on a delivery path (BP-031). A member
 * is matched on its seat's logical id (the `seatId` setting the hire stamps),
 * and the dispatch goes to the seat's address. The two differ for a seat the
 * boot reload minted from a stored roster row, whose address is
 * `<org>.<seatId>`. When the seats passed hold one logical id more than once
 * (in several organizations, or owned by several users of one), the one the
 * post's caller may reach runs: owned by that user, else organization-wide,
 * else shared.
 */
import { dispatcher, handler, router, type RouterConfig } from "@flow-state-dev/core";
import type { BlockContext, BlockDefinition, FlowInstance } from "@flow-state-dev/core/types";
import { z } from "zod";
import { SEAT_ID_KEY } from "../manifest";
import { mailboxNotifyInputSchema, type MailboxNotifyInput } from "./mailbox-flow";

/** The internal entry a seat's kind declares to hear a mailbox's posts. */
const MAILBOX_POST_ENTRY = "onMailboxPost";

/** Options for {@link wakeMemberSeats}. */
export interface WakeMemberSeatsOptions {
  /**
   * Runs for each member whose seat can't hear a post, or who has no seat
   * among those passed, on every post, with the same input a notify block
   * gets. Never for a member the wake would have run. Silent when omitted.
   */
  fallback?: BlockDefinition<any, any>;
}

/** What a member gets when nothing is delivered to it. */
const silent = handler({
  name: "wake-member-seats-silent",
  inputSchema: mailboxNotifyInputSchema,
  outputSchema: z.object({}),
  execute: () => ({})
});

/** Whether a hired seat's kind declares the mailbox-post entry. */
function hearsPosts(seat: FlowInstance): boolean {
  return Object.prototype.hasOwnProperty.call(seat.internal?.actions ?? {}, MAILBOX_POST_ENTRY);
}

/** The logical id a mailbox's `members:` names this seat by. */
function seatIdOf(seat: FlowInstance): string {
  const seatId = (seat.config as Record<string, unknown> | undefined)?.[SEAT_ID_KEY];
  return typeof seatId === "string" && seatId.length > 0 ? seatId : seat.id;
}

/**
 * The seats that can hear a post, grouped by the logical id a mailbox's
 * `members:` names them by. The wake's test of who can be woken, shared with
 * `routeByPurpose` so a route never offers a member the wake would not run.
 * Not re-exported from the package root.
 */
export function hearingSeatsById(seats: readonly FlowInstance[]): Map<string, FlowInstance[]> {
  const byId = new Map<string, FlowInstance[]>();
  for (const seat of seats) {
    if (!hearsPosts(seat)) continue;
    const seatId = seatIdOf(seat);
    byId.set(seatId, [...(byId.get(seatId) ?? []), seat]);
  }
  return byId;
}

/**
 * The workers a wake or a route reaches: a list, fixed when it is built, or a
 * getter, read when a post is delivered (the host's live registry, so a worker
 * hired after boot is reached and one removed is not). `wakeMemberSeats` and
 * `routeByPurpose` both take it; hand both the same getter.
 */
export type MailboxWorkerSource = readonly FlowInstance[] | (() => readonly FlowInstance[]);

/** How many posts' reads a getter keeps at once: enough for the posts in flight, never the history. */
const POSTS_KEPT = 64;

/** One reader per getter, so a wake and a route over the same getter share a post's read. */
const readers = new WeakMap<() => readonly FlowInstance[], (ctx: BlockContext) => Map<string, FlowInstance[]>>();

/**
 * The seats that can hear a post, by logical id, as of the post `ctx` is
 * delivering. A list is grouped once, here. A getter is called once per post,
 * keyed by the request (one fan-out per post), and every block reading it for
 * that post (each member's wake, the route's case) gets the same answer. Not
 * re-exported from the package root.
 */
export function hearingPerPost(source: MailboxWorkerSource): (ctx: BlockContext) => Map<string, FlowInstance[]> {
  if (typeof source !== "function") {
    const fixed = hearingSeatsById(source);
    return () => fixed;
  }
  const known = readers.get(source);
  if (known !== undefined) return known;
  const byPost = new Map<string, Map<string, FlowInstance[]>>();
  const read = (ctx: BlockContext) => {
    const postId = ctx.request.identity.id;
    let hearing = byPost.get(postId);
    if (hearing === undefined) {
      hearing = hearingSeatsById(source());
      byPost.set(postId, hearing);
      // Oldest first: a post's deliveries all land before many more posts start.
      if (byPost.size > POSTS_KEPT) byPost.delete(byPost.keys().next().value as string);
    }
    return hearing;
  };
  readers.set(source, read);
  return read;
}

/**
 * The seat of one logical id that this post's caller may reach: one pinned to
 * the caller's organization and user first, then one visible to the whole
 * organization, then one pinned to none. A seat pinned to anyone else is not
 * this caller's. Shared with `routeByPurpose`; not re-exported from the root.
 */
export function reachableSeat(group: readonly FlowInstance[], ctx: BlockContext): FlowInstance | undefined {
  const orgId = ctx.org?.identity.orgId ?? ctx.org?.identity.id;
  const userId = ctx.user?.identity.userId ?? ctx.user?.identity.id;
  return (
    group.find((seat) => seat.ownerPin?.orgId === orgId && seat.ownerPin?.userId !== undefined && seat.ownerPin?.userId === userId) ??
    group.find((seat) => seat.ownerPin !== undefined && seat.ownerPin.orgId === orgId && seat.ownerPin.userId === undefined) ??
    group.find((seat) => seat.ownerPin === undefined)
  );
}

/**
 * The notify block that wakes each member whose hired seat declares the
 * internal `onMailboxPost` entry, once per post, and never on a post the
 * mailbox marked `seatAuthored` (a seat's own dispatch, not a claimed `author`).
 *
 * @param seats The seats `hireWorkforce` returned, as a list, or a getter
 *   over the host's live registry. A list is fixed when the block is built: a
 *   seat not in it is never woken. A getter is read once per post.
 * @param options `fallback`, for the members the wake does not run.
 * @returns The block `defineMailboxFlow({ notify })` runs once per member per post.
 */
export function wakeMemberSeats(
  seats: MailboxWorkerSource,
  options: WakeMemberSeatsOptions = {}
): BlockDefinition<typeof mailboxNotifyInputSchema, any> {
  const fallback = options.fallback ?? silent;
  const hearingFor = hearingPerPost(seats);

  // One dispatcher per seat that can hear a post, by its address, built the
  // first time it is needed and kept.
  const wakes = new Map<string, BlockDefinition<any, any>>();
  const built = new Set<BlockDefinition<any, any>>([silent, fallback]);
  const wakeOf = (seat: FlowInstance): BlockDefinition<any, any> => {
    let wake = wakes.get(seat.id);
    if (wake === undefined) {
      wake = dispatcher({
        name: `wake-${seat.id}`,
        flowKind: seat.id,
        action: MAILBOX_POST_ENTRY,
        inputSchema: mailboxNotifyInputSchema,
        // One conversation per seat per mailbox, adopted on every post after the first.
        session: { key: (post: MailboxNotifyInput) => `mailbox:${post.mailboxId}` }
      });
      wakes.set(seat.id, wake);
      built.add(wake);
    }
    return wake;
  };
  // A list's seats are known now, so their wakes are built now and are the
  // router's routes, as they always were.
  if (typeof seats !== "function") {
    for (const group of hearingSeatsById(seats).values()) for (const seat of group) wakeOf(seat);
  }

  /**
   * The wake for the seat a member names, for this post's caller. A seat this
   * caller may not reach is not theirs to wake, so the member gets the fallback.
   */
  const wakeFor = (member: string, ctx: BlockContext): BlockDefinition<any, any> | undefined => {
    const seat = reachableSeat(hearingFor(ctx).get(member) ?? [], ctx);
    return seat === undefined ? undefined : wakeOf(seat);
  };

  const routes = [...wakes.values(), silent];
  if (fallback !== silent) routes.push(fallback);

  return router({
    name: "wake-member-seats",
    inputSchema: mailboxNotifyInputSchema,
    routes,
    // A getter's wakes are built as posts need them, so the router checks a
    // choice against every block this wake built rather than the list above.
    ...(typeof seats === "function"
      ? { validateRoute: (candidate: BlockDefinition<any, any>) => built.has(candidate) }
      : {}),
    execute: (post: MailboxNotifyInput, ctx: BlockContext) => {
      // A member this caller cannot wake gets the fallback, including on a
      // seat's post. The seat mark then withholds the wake, and a claimed
      // `author` never does.
      const wake = wakeFor(post.member, ctx);
      if (wake === undefined) return fallback;
      // A seat wrote it: silent, not the fallback.
      if (post.seatAuthored === true) return silent;
      return wake;
    }
  } as unknown as RouterConfig<typeof mailboxNotifyInputSchema, any, MailboxNotifyInput>) as BlockDefinition<
    typeof mailboxNotifyInputSchema,
    any
  >;
}
