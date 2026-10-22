/**
 * The request-end registry (FIX-2077): the engine side of core's request-end
 * seam (`@flow-state-dev/core/types` → `onRequestEnded`).
 *
 * One registry per request, built beside the side-chain pool and attached to
 * every scope's context under `REQUEST_END_SEAM`, so a hook registered from any
 * block reaches the same list. `runActionInternal` runs the list once, after
 * the drain of what `onFinished` and `onErrored` started, on each terminal
 * path, and on the suspension path before the request is recorded suspended.
 * A request with a hook still to run is one a host's shutdown waits for
 * ({@link drainRequestEnds}).
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
   *
   * The request stays owed (shutdown waits for it) until the run ends, or,
   * with `keepOwed`, until {@link release}: for a caller that still has the
   * request's held terminal status to write.
   *
   * @returns the first failure a hook handed back, for the caller to record as the request's own.
   */
  run(
    ending: RequestEnding,
    context: { requestId: string; logger?: RuntimeLogger; keepOwed?: boolean }
  ): Promise<Error | undefined>;
  /** The request owes nothing more: a shutdown stops waiting for it. Idempotent. */
  release(): void;
  /** Whether a hook is added and has not run yet: the request then holds back its terminal status until they have. */
  owes(): boolean;
}

/**
 * The requests in this process that owe a hook run: added at a request's first
 * hook, removed once its run ends. What a host's shutdown waits on
 * ({@link drainRequestEnds}), so a hook's writes never meet a closed store.
 */
const owed = new Map<RequestEndRegistry, Promise<void>>();

/**
 * Wait for every request in this process that owes a hook run, for at most
 * `budgetMs`. A host calls it at shutdown, before it closes its stores.
 *
 * @returns how many still owed one when the budget ran out.
 */
export async function drainRequestEnds(budgetMs: number): Promise<number> {
  if (owed.size === 0) return 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const outOfTime = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, Math.max(0, budgetMs));
  });
  await Promise.race([Promise.all([...owed.values()]), outOfTime]);
  clearTimeout(timer);
  return owed.size;
}

/** Build one request's registry. */
export function createRequestEndRegistry(): RequestEndRegistry {
  const hooks: RequestEndHook[] = [];
  let release: (() => void) | undefined;
  const registry: RequestEndRegistry = {
    seam: {
      add: (hook) => {
        hooks.push(hook);
        if (release === undefined) owed.set(registry, new Promise<void>((resolve) => (release = resolve)));
      }
    },
    owes: () => hooks.length > 0,
    release: () => {
      owed.delete(registry);
      release?.();
      release = undefined;
    },
    async run(ending, context) {
      try {
        return await runHooks(hooks, ending, context);
      } finally {
        if (context.keepOwed !== true) registry.release();
      }
    }
  };
  return registry;
}

/** Run `hooks` in order until none is left, as {@link RequestEndRegistry.run} says. */
async function runHooks(
  hooks: RequestEndHook[],
  ending: RequestEnding,
  { requestId, logger }: { requestId: string; logger?: RuntimeLogger }
): Promise<Error | undefined> {
  let failure: Error | undefined;
  while (hooks.length > 0) {
    const hook = hooks.shift()!;
    try {
      const verdict = await hook(ending);
      if (verdict != null && failure === undefined) failure = verdict.fail;
    } catch (err) {
      logRuntimeEvent(logger, "warn", "[flow-state] a request-end hook failed", {
        requestId,
        status: ending.status,
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }
  return failure;
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
