/**
 * Assembling the one workstream core a detached dispatch resolves (FIX-982 P3a).
 *
 * A flow's detached bindings bubble up to `defineFlow` on the same rail resource
 * declarations already use. This module turns that map into the single
 * `ActionCore` a `source: "workstream"` dispatch enters — the piece that had
 * been declared everywhere and built nowhere: `resolveActionCore` returned
 * `flow.workstream`, `createRequestHost` refused when it was absent, and nothing
 * ever set it.
 *
 * ## What this assembles, and what it deliberately does not
 *
 * It routes to a **board's runner**, never to a worker. The runner is the block
 * the declaring board stamped onto every binding it made (see
 * {@link WorkstreamBinding.runner}), and it owns the whole pre-worker sequence:
 * re-read the claimed row, verify the claim is still current, mark the task
 * scope, re-mint the claim ticket, then route to the worker the row's own
 * `assignee` names.
 *
 * None of that can live here. Reading a task row means naming a task board, and
 * `core` cannot name `orchestration` without inverting the package graph. What
 * `core` supplies instead is the property that actually matters: **there is no
 * path from a detached dispatch to a bare worker block.** The router below holds
 * runners only, so a worker is reachable only *through* its board's gate. The
 * invariant therefore has one enforcement point — the board factory that builds
 * the runner — and adding a worker to a board that already has one is covered by
 * construction.
 *
 * ## Why the dispatch names a board and not a worker
 *
 * Selection here is on `boardId`, which the seam stamps at spawn from the
 * board's own declaration. The *worker* is chosen further in, by the runner,
 * from the assignee on the durable row it just re-read — never from the dispatch
 * envelope (BP-031). So a forged envelope can at most name a different board,
 * and the claim ticket that board mints from its own ledger then fails to match
 * anything the forger owns.
 */
import { keyedRouter } from "../utility/keyed-router";
import { z } from "zod";
import type { BlockDefinition } from "../types/block";
import type { ActionCore } from "../types/flow";
import type { WorkstreamBindings } from "../types/workstream";

/**
 * What the seam hands a detached dispatch as its input.
 *
 * Every field is **server-derived at spawn** — the board supplies the routing
 * facts from its own declarations and the row it just claimed, and the runtime
 * supplies identity. A task author names a topic and an assignee and nothing
 * here.
 *
 * `attempt`, `createdAt` and `incarnationId` are the claim's identity, and they
 * are carried so the runner's start gate can verify them against the row rather
 * than trust them: they say *which* claim this dispatch believes it is running,
 * and the gate decides whether that is still true.
 *
 * `incarnationId` is what makes it an identity check rather than a counter
 * check — a task deleted and recreated under the same id inside the
 * claim→spawn window resets `attempts`, and a replacement created in the same
 * millisecond carries the same `createdAt`, so neither of the other two tells
 * the two rows apart.
 */
export type WorkstreamDispatchInput = {
  /** Which board's ledger this dispatch settles against. */
  readonly boardId: string;
  /** Which worker on that board, as the board's own encoded coordinate. */
  readonly coordinateKey: string;
  /** The claimed row. */
  readonly taskId: string;
  /** The attempt this dispatch believes it is running. Verified, never trusted. */
  readonly attempt: number;
  /** The claimed row's creation stamp. Verified, never trusted. */
  readonly createdAt: number;
  /**
   * The claimed row's incarnation nonce — which *instance* of this task id the
   * dispatch was addressed to. Verified, never trusted.
   *
   * Optional, and it stays optional: an envelope persisted before this field
   * shipped has none, and a row written by a `TaskCollectionRef` that maintains
   * no provenance has none either. A gate compares it only when both sides
   * carry one (BP-030).
   */
  readonly incarnationId?: string;
  /** The materialized worker input, packed at claim time. */
  readonly payload: unknown;
};

/**
 * Runtime shape of {@link WorkstreamDispatchInput}.
 *
 * The core validates its own input because a detached dispatch is re-resolved
 * from a persisted envelope after a restart, and a malformed one should fail by
 * name at the boundary rather than as a missing property somewhere inside a
 * board's gate.
 */
export const workstreamDispatchInputSchema = z.object({
  boardId: z.string().min(1),
  coordinateKey: z.string(),
  taskId: z.string().min(1),
  attempt: z.number().int().nonnegative(),
  createdAt: z.number(),
  // Optional so an envelope enqueued by the previous version still parses
  // rather than failing at the boundary during a rolling deploy (BP-030). The
  // gate treats absence as "cannot tell", so a legacy envelope keeps exactly
  // the protection it had.
  incarnationId: z.string().optional(),
  payload: z.unknown(),
});

/**
 * The distinct runners in a binding set, keyed by the board that declared them.
 *
 * A board stamps the same runner object onto every binding it makes, so the
 * dedupe is by reference and a board with twelve detached workers contributes
 * one route. Two boards that share a `boardId` cannot reach here — merging the
 * bindings already threw.
 *
 * @throws {Error} when one `boardId` carries two distinct runner objects, which
 * would make the route ambiguous in exactly the way a shared `boardId` does.
 */
function runnersByBoard(
  bindings: WorkstreamBindings
): Map<string, BlockDefinition<never, never>> {
  const runners = new Map<string, BlockDefinition<never, never>>();
  for (const binding of bindings.values()) {
    // A binding with no runner is detachment that would resolve to nothing —
    // the dispatch arrives, the core routes at `undefined`, and the failure
    // surfaces as a property read on a missing block rather than as anything an
    // author could act on. Refuse by name at definition, where the declaration
    // is still visible.
    if (binding.runner == null) {
      throw new Error(
        `[workstream] board "${binding.boardId}" declares a detached worker at coordinate ` +
          `"${binding.coordinateKey}" with no runner. A binding is produced by the board ` +
          `factory, which stamps the runner alongside it — a binding built by hand cannot ` +
          `route, because the start gate and the claim-ticket re-mint live on the runner.`
      );
    }
    const existing = runners.get(binding.boardId);
    if (existing === undefined) {
      runners.set(binding.boardId, binding.runner);
      continue;
    }
    if (existing !== binding.runner) {
      throw new Error(
        `[workstream] board "${binding.boardId}" declares two different detached runners. ` +
          `A board stamps one runner onto every binding it makes, so this means two boards ` +
          `are sharing a boardId — give them distinct boardIds.`
      );
    }
  }
  return runners;
}

/**
 * Build the flow's workstream core, or `undefined` when it declares no detached
 * work.
 *
 * `undefined` is the honest answer for the overwhelming majority of flows, and
 * it is load-bearing: `startDetached` refuses `no-workstream-core` by name
 * against it, and `resolveActionCore` treats the detached source as terminal, so
 * an absent core can never fall through to a caller-addressed action.
 *
 * @param kind The flow's kind, used only to name the assembled block.
 * @param bindings The flow's merged detached bindings.
 */
export function buildWorkstreamCore(
  kind: string,
  bindings: WorkstreamBindings | undefined
): ActionCore | undefined {
  if (bindings === undefined || bindings.size === 0) return undefined;

  const runners = runnersByBoard(bindings);

  // One board is the ordinary case, and it gets its runner directly. Wrapping a
  // single route in a router would add a `router_decision` record to every
  // detached request's durable trace to record a choice that was never made —
  // and on resume that record has to be re-validated against a re-selected
  // route, which is a failure mode bought for nothing.
  const only = singleEntry(runners);
  if (only !== undefined) {
    return { block: only, inputSchema: workstreamDispatchInputSchema };
  }

  // Null-prototype, because `boardId` is author-chosen and unrestricted. On a
  // normal `{}`, a board legitimately named `__proto__` would hit the prototype
  // setter instead of creating an own key: the route would be missing from
  // `Object.values`, and `keyedRouter`'s own-property lookup would then refuse
  // every dispatch for that board while the flow still defined successfully.
  const routes: Record<string, BlockDefinition<any, any>> = Object.create(null);
  for (const [boardId, runner] of runners) {
    routes[boardId] = runner as BlockDefinition<any, any>;
  }

  return {
    block: keyedRouter({
      name: `${kind}-workstream`,
      inputSchema: workstreamDispatchInputSchema,
      outputSchema: z.unknown(),
      blocks: routes,
      select: (input: WorkstreamDispatchInput) => input.boardId,
    }),
    inputSchema: workstreamDispatchInputSchema,
  };
}

/** The map's only value, or `undefined` when it holds none or several. */
function singleEntry<K, V>(map: Map<K, V>): V | undefined {
  if (map.size !== 1) return undefined;
  for (const value of map.values()) return value;
  return undefined;
}
