/**
 * `wakeMemberSeats`: the notify block that wakes a channel's agent members.
 *
 * A channel runs its notify block once per declared member per post, and the
 * block decides what that member gets. This one decides it from the seats the
 * host hired, and from nothing else:
 *
 * - **A member wakes** when the post names no `author` and the member's hired
 *   seat declares the internal `onChannelPost` entry. The seat runs that entry
 *   in one conversation per channel, keyed `channel:<channelId>`, so the next
 *   post it hears lands in the same conversation.
 * - **Nothing runs** for a member that would have woken, when the post names an
 *   `author`. Every author a post can carry is a declared member, so that is a
 *   seat talking, and two seats that wake each other answer each other forever.
 *   There is no option to turn this off.
 * - **The fallback runs** for every other member: one whose seat declares no
 *   `onChannelPost`, or who has no seat among those passed. Silent unless the
 *   host passes one.
 *
 * Which seat can hear a post is read off the seat itself, so there is no list
 * of kinds to keep in step. A kind says it can hear a post where it says how.
 *
 * The addresses are the seats passed in, never a channel's stored members: a
 * dispatch target read out of stored data is refused by the substrate, and a
 * stored list is caller-reachable input on a delivery path (BP-031). A member
 * is matched on its seat's logical id (the `seatId` setting the hire stamps),
 * and the dispatch goes to the seat's address. The two differ for a seat the
 * boot reload minted from a stored roster row, whose address is
 * `<org>.<seatId>`. When the seats passed hold one logical id in several
 * organizations, the post's organization picks the one that runs.
 */
import { dispatcher, handler, router, type RouterConfig } from "@flow-state-dev/core";
import type { BlockContext, BlockDefinition, FlowInstance } from "@flow-state-dev/core/types";
import { z } from "zod";
import { SEAT_ID_KEY } from "../manifest";
import { channelNotifyInputSchema, type ChannelNotifyInput } from "./channel-flow";

/** The internal entry a seat's kind declares to hear a channel's posts. */
const CHANNEL_POST_ENTRY = "onChannelPost";

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
  inputSchema: channelNotifyInputSchema,
  outputSchema: z.object({}),
  execute: () => ({})
});

/** Whether a hired seat's kind declares the channel-post entry. */
function hearsPosts(seat: FlowInstance): boolean {
  return Object.prototype.hasOwnProperty.call(seat.internal?.actions ?? {}, CHANNEL_POST_ENTRY);
}

/** The logical id a channel's `members:` names this seat by. */
function seatIdOf(seat: FlowInstance): string {
  const seatId = (seat.config as Record<string, unknown> | undefined)?.[SEAT_ID_KEY];
  return typeof seatId === "string" && seatId.length > 0 ? seatId : seat.id;
}

/**
 * The notify block that wakes each member whose hired seat declares the
 * internal `onChannelPost` entry, once per post, and never on a post with an
 * `author`.
 *
 * @param seats The seats `hireWorkforce` returned. Hire before you build
 *   channels: a seat not passed here is never woken.
 * @param options `fallback`, for the members the wake does not run.
 * @returns The block `defineChannelFlow({ notify })` runs once per member per post.
 */
export function wakeMemberSeats(
  seats: readonly FlowInstance[],
  options: WakeMemberSeatsOptions = {}
): BlockDefinition<typeof channelNotifyInputSchema, any> {
  const fallback = options.fallback ?? silent;

  // One dispatcher per seat that can hear a post, grouped by logical id.
  const wakes = new Map<string, Array<{ seat: FlowInstance; wake: BlockDefinition<any, any> }>>();
  for (const seat of seats) {
    if (!hearsPosts(seat)) continue;
    const seatId = seatIdOf(seat);
    const wake = dispatcher({
      name: `wake-${seat.id}`,
      flowKind: seat.id,
      action: CHANNEL_POST_ENTRY,
      inputSchema: channelNotifyInputSchema,
      // One conversation per seat per channel, adopted on every post after the first.
      session: { key: (post: ChannelNotifyInput) => `channel:${post.channelId}` }
    });
    const group = wakes.get(seatId) ?? [];
    group.push({ seat, wake });
    wakes.set(seatId, group);
  }

  /**
   * The seat a member names, for a post in this organization: one pinned to
   * the organization first, else one pinned to none.
   */
  const wakeFor = (member: string, ctx: BlockContext): BlockDefinition<any, any> | undefined => {
    const group = wakes.get(member);
    if (group === undefined) return undefined;
    const orgId = ctx.org?.identity.orgId ?? ctx.org?.identity.id;
    const found =
      group.find(({ seat }) => seat.ownerPin !== undefined && seat.ownerPin.orgId === orgId) ??
      group.find(({ seat }) => seat.ownerPin === undefined);
    return found?.wake;
  };

  const routes = [...[...wakes.values()].flat().map(({ wake }) => wake), silent];
  if (fallback !== silent) routes.push(fallback);

  return router({
    name: "wake-member-seats",
    inputSchema: channelNotifyInputSchema,
    routes,
    execute: (post: ChannelNotifyInput, ctx: BlockContext) => {
      // The seat check first, so a claimed `author` can only withhold a wake,
      // never send the fallback to a member it would not reach anyway.
      const wake = wakeFor(post.member, ctx);
      if (wake === undefined) return fallback;
      // A seat wrote it: silent, not the fallback (BR-3). The author only withholds.
      if (post.author !== undefined) return silent;
      return wake;
    }
  } as unknown as RouterConfig<typeof channelNotifyInputSchema, any, ChannelNotifyInput>) as BlockDefinition<
    typeof channelNotifyInputSchema,
    any
  >;
}
