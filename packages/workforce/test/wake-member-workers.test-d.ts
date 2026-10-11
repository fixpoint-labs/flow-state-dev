/**
 * Compile-time half of `wakeMemberWorkers`'s address rule (the spec's BR-14):
 * it takes hired workers, never a mailbox's member ids.
 *
 * The addresses a notify block dispatches to must come from the workers the host
 * hired, not from a list of strings a mailbox stored, which is caller-reachable
 * input on a delivery path (BP-031). Widen the parameter to accept strings and
 * the `@ts-expect-error` below has nothing to suppress, which is itself an
 * error (TS2578), so `pnpm typecheck` goes red.
 *
 * Imported through the package root, so the export a host is told to call is
 * also proven to be there.
 */
import type { FlowInstance } from "@flow-state-dev/core/types";
import { wakeMemberWorkers } from "../src/index";

/** Hired workers are what it takes. */
export function fromWorkers(workers: FlowInstance[]): unknown {
  return wakeMemberWorkers(workers);
}

/** A mailbox's member ids are not. */
export function fromMemberIds(members: string[]): unknown {
  // @ts-expect-error — member ids are not workers.
  return wakeMemberWorkers(members);
}
