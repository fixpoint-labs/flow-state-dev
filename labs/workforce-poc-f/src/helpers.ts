/**
 * Lab-local wrappers over today's L1. Proposed names from Atlas §07 / §10.
 * Not package exports.
 */
import type { TaskCollectionRef } from "@flow-state-dev/orchestration";
import { routePayloadSchema } from "./board";
import {
  memberSeats,
  parseAddress,
  parseRoute,
  type Roster,
  type RouteKind,
} from "./roster";

export function replyTaskId(postId: string, seat: string): string {
  return `${postId}:${seat}`;
}

export async function fileClaim(args: {
  collection: TaskCollectionRef;
  postId: string;
  body: string;
  roster: Roster;
}): Promise<{ route: "claim"; taskIds: string[]; seat: string }> {
  const seat = parseAddress(args.body, args.roster);
  if (seat === undefined) {
    throw new Error(`claim route needs @seat on roster "${args.roster.id}"`);
  }
  await args.collection.addTask({
    id: args.postId,
    goal: args.body,
    assignee: seat,
    input: routePayloadSchema.parse({
      body: args.body,
      route: "claim",
      roster: args.roster.id,
      seat,
    }),
    metadata: { kind: "intake-route" },
  });
  return { route: "claim", taskIds: [args.postId], seat };
}

/**
 * Proposed `fileOrderedReplies`. Files N rows with deps. `isClaimable`
 * already waits on deps — no MessageBoard sequencer, no new lease type.
 */
export async function fileOrderedReplies(args: {
  collection: TaskCollectionRef;
  postId: string;
  body: string;
  roster: Roster;
}): Promise<{ route: "ordered"; taskIds: string[] }> {
  const order = memberSeats(args.roster);
  if (order.length === 0) {
    throw new Error(`roster "${args.roster.id}" has no member seats to order`);
  }
  const taskIds: string[] = [];
  let previous: string | undefined;
  for (const seat of order) {
    const id = replyTaskId(args.postId, seat.seat);
    await args.collection.addTask({
      id,
      goal: args.body,
      assignee: seat.seat,
      ...(previous !== undefined ? { deps: [previous] } : {}),
      input: routePayloadSchema.parse({
        body: args.body,
        route: "ordered",
        roster: args.roster.id,
        seat: seat.seat,
      }),
      metadata: { kind: "intake-route" },
    });
    taskIds.push(id);
    previous = id;
  }
  return { route: "ordered", taskIds };
}

/**
 * Fan-out files one independent row per member. Waking those members'
 * sessions via `dispatcher({ id })` from the intake flow is the named
 * cross-flow gap — this helper does not invent a second bus.
 */
export async function fileFanOut(args: {
  collection: TaskCollectionRef;
  postId: string;
  body: string;
  roster: Roster;
}): Promise<{ route: "fan-out"; taskIds: string[] }> {
  const seats = memberSeats(args.roster);
  const taskIds: string[] = [];
  for (const seat of seats) {
    const id = replyTaskId(args.postId, seat.seat);
    await args.collection.addTask({
      id,
      goal: args.body,
      assignee: seat.seat,
      input: routePayloadSchema.parse({
        body: args.body,
        route: "fan-out",
        roster: args.roster.id,
        seat: seat.seat,
      }),
      metadata: { kind: "intake-route" },
    });
    taskIds.push(id);
  }
  return { route: "fan-out", taskIds };
}

export async function fileRoute(args: {
  collection: TaskCollectionRef;
  postId: string;
  body: string;
  roster: Roster;
}): Promise<{ route: RouteKind; taskIds: string[]; seat?: string }> {
  const kind = parseRoute(args.body, args.roster);
  if (kind === "claim") {
    return fileClaim(args);
  }
  if (kind === "ordered") {
    return fileOrderedReplies(args);
  }
  return fileFanOut(args);
}
