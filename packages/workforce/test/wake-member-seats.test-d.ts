/**
 * Compile-time half of `wakeMemberSeats`'s address rule (the spec's BR-14):
 * it takes hired seats, never a channel's member ids.
 *
 * The addresses a notify block dispatches to must come from the seats the host
 * hired, not from a list of strings a channel stored, which is caller-reachable
 * input on a delivery path (BP-031). Widen the parameter to accept strings and
 * the `@ts-expect-error` below has nothing to suppress, which is itself an
 * error (TS2578), so `pnpm typecheck` goes red.
 *
 * Imported through the package root, so the export a host is told to call is
 * also proven to be there.
 */
import type { FlowInstance } from "@flow-state-dev/core/types";
import { wakeMemberSeats } from "../src/index";

/** Hired seats are what it takes. */
export function fromSeats(seats: FlowInstance[]): unknown {
  return wakeMemberSeats(seats);
}

/** A channel's member ids are not. */
export function fromMemberIds(members: string[]): unknown {
  // @ts-expect-error — member ids are not seats.
  return wakeMemberSeats(members);
}
