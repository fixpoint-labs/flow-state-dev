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
import { WORKER_ID_STATE_KEY } from "../workers/keys";
import { AGENT_KIND } from "../agent-worker-flow";
import type { WorkerInstallation } from "../workers/installation";
import { runsWorkersOf } from "../workers/register";
import { standardWorkerFlow } from "../workers/standard-workers";
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
  /**
   * The installation whose worker flows run as one copy each. A copy passed
   * in `seats` that declares this installation's session hears posts for
   * every standard worker on its flow: a member naming that worker wakes it,
   * in a conversation of its own, created naming the worker. A user's own
   * worker isn't woken as a member.
   */
  installation?: WorkerInstallation;
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
 * A copy that runs an installation's workers hears posts for each standard
 * worker on its flow, under that worker's id. Not re-exported from the
 * package root.
 */
export function hearingSeatsById(
  seats: readonly FlowInstance[],
  installation?: WorkerInstallation
): Map<string, FlowInstance[]> {
  const byId = new Map<string, FlowInstance[]>();
  const add = (id: string, seat: FlowInstance) => byId.set(id, [...(byId.get(id) ?? []), seat]);
  for (const seat of seats) {
    if (!hearsPosts(seat)) continue;
    if (installation !== undefined && runsWorkersOf(seat, installation)) {
      for (const worker of installation!.standardWorkers()) {
        if (standardWorkerFlow(worker, AGENT_KIND) === seat.kind) add(worker.id, seat);
      }
      continue;
    }
    add(seatIdOf(seat), seat);
  }
  return byId;
}

/**
 * The seat of one logical id that this post's caller may reach: one pinned to
 * the caller's organization and user first, then one visible to the whole
 * organization, then one pinned to none. A seat pinned to anyone else is not
 * this caller's. Shared with `routeByPurpose`; not re-exported from the root.
 */
export function reachableSeat(group: readonly FlowInstance[], ctx: BlockContext): FlowInstance | undefined {
  const orgId = ctx.org?.identity.orgId ?? ctx.org?.identity.id;
  // A bare user id, never `ctx.user.identity.id`: that is the user record's
  // storage key, which carries the org.
  const userId = ctx.user?.identity.userId ?? ctx.session?.identity.userId;
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
 * @param seats The seats `hireWorkforce` returned. Hire before you build
 *   mailboxes: a seat not passed here is never woken.
 * @param options `fallback`, for the members the wake does not run.
 * @returns The block `defineMailboxFlow({ notify })` runs once per member per post.
 */
export function wakeMemberSeats(
  seats: readonly FlowInstance[],
  options: WakeMemberSeatsOptions = {}
): BlockDefinition<typeof mailboxNotifyInputSchema, any> {
  const fallback = options.fallback ?? silent;

  // One dispatcher per (seat, member) that can hear a post. A seat minted
  // for one worker has one member; a copy that runs every worker of a flow
  // has one per standard worker on it.
  const hearing = hearingSeatsById(seats, options.installation);
  const wakes = new Map<string, BlockDefinition<any, any>>();
  const wakeKey = (seat: FlowInstance, member: string) => `${seat.id}\u0000${member}`;
  for (const [member, group] of hearing) {
    for (const seat of group) {
    const shared = options.installation !== undefined && runsWorkersOf(seat, options.installation);
    const worker = shared ? member : seatIdOf(seat);
    wakes.set(
      wakeKey(seat, member),
      dispatcher({
        name: shared ? `wake-${seat.id}-${member}` : `wake-${seat.id}`,
        flowKind: seat.id,
        action: MAILBOX_POST_ENTRY,
        inputSchema: mailboxNotifyInputSchema,
        // One conversation per worker per mailbox, adopted on every post after
        // the first. The worker is in the key as well as the state: on a copy
        // several workers share, a key without it would hand the second
        // worker the first one's conversation, which the engine refuses. The
        // worker is named from the seat this code chose, never the post's
        // fields, and a worker flow's create check confirms it (FIX-1788 BR-18).
        session: {
          key: (post: MailboxNotifyInput) => `mailbox:${post.mailboxId}:${worker}`,
          state: { [WORKER_ID_STATE_KEY]: worker }
        }
      })
    );
    }
  }

  /**
   * The wake for the seat a member names, for this post's caller. A seat this
   * caller may not reach is not theirs to wake, so the member gets the fallback.
   */
  const wakeFor = (member: string, ctx: BlockContext): BlockDefinition<any, any> | undefined => {
    const seat = reachableSeat(hearing.get(member) ?? [], ctx);
    return seat === undefined ? undefined : wakes.get(wakeKey(seat, member));
  };

  const routes = [...wakes.values(), silent];
  if (fallback !== silent) routes.push(fallback);

  return router({
    name: "wake-member-seats",
    inputSchema: mailboxNotifyInputSchema,
    routes,
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
