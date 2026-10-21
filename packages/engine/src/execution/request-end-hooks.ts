/**
 * The request-end registry (FIX-2077): the engine side of core's request-end
 * seam (`@flow-state-dev/core/types` → `onRequestEnded`).
 *
 * One registry per request, built beside the side-chain pool and attached to
 * every scope's context under `REQUEST_END_SEAM`, so a hook registered from any
 * block reaches the same list. `runActionInternal` runs the list once, after
 * the drain of what `onFinished` and `onErrored` started, on each terminal
 * path, and at the end of the suspension path.
 */
import { REQUEST_END_SEAM, type RequestEndHook, type RequestEndSeam, type RequestEnding } from "@flow-state-dev/core/types";
import type { RuntimeLogger } from "./logging";
import { logRuntimeEvent } from "./logging";

/** The engine's own key for the registry, so only the engine can run it. */
const REQUEST_END_REGISTRY: unique symbol = Symbol("@flow-state-dev/engine/request-end-registry");

/** A request's registry: the seam blocks add to, and the run the engine calls once. */
export interface RequestEndRegistry {
  readonly seam: RequestEndSeam;
  /**
   * Run every hook added so far, in order, then forget them. A hook added while
   * the list runs runs too. A rejection is logged and the next hook still runs.
   */
  run(ending: RequestEnding, context: { requestId: string; logger?: RuntimeLogger }): Promise<void>;
}

/** Build one request's registry. */
export function createRequestEndRegistry(): RequestEndRegistry {
  const hooks: RequestEndHook[] = [];
  return {
    seam: { add: (hook) => void hooks.push(hook) },
    async run(ending, { requestId, logger }) {
      while (hooks.length > 0) {
        const hook = hooks.shift()!;
        try {
          await hook(ending);
        } catch (err) {
          logRuntimeEvent(logger, "warn", "[flow-state] a request-end hook failed", {
            requestId,
            status: ending.status,
            error: err instanceof Error ? err.message : String(err)
          });
        }
      }
    }
  };
}

/** The registry attached to `ctx`, when the context carries one. */
export function requestEndRegistryOf(ctx: object): RequestEndRegistry | undefined {
  return (ctx as { [REQUEST_END_REGISTRY]?: RequestEndRegistry })[REQUEST_END_REGISTRY];
}

/** Attach `registry` to a scope's context: its seam under the public key, itself under the engine's. */
export function attachRequestEndRegistry(ctx: object, registry: RequestEndRegistry): void {
  const target = ctx as { [REQUEST_END_SEAM]?: RequestEndSeam; [REQUEST_END_REGISTRY]?: RequestEndRegistry };
  target[REQUEST_END_SEAM] = registry.seam;
  target[REQUEST_END_REGISTRY] = registry;
}
