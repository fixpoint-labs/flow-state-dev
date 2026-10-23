/**
 * Whether a durability sweeper that resumes waits at their deadline runs in
 * this process (FIX-1816 BR-5): a wait is offered only where one does, so no
 * request waits forever.
 *
 * Keyed on the durability provider: the runtime that parks a request and the
 * sweeper that resumes it share one provider object per host, even when the
 * router and a colocated worker hold different copies of the runtime config.
 * A wait's deadline itself is a wake (FIX-2082 D1), which the sweeper hears
 * through the wake store (`request-wakes.ts`).
 */
import type { DurabilityProvider } from "./types";

const sweepers = new WeakMap<DurabilityProvider, Set<symbol>>();

/** Register a sweeper that resumes waits on `provider`. Returns the unregister. */
export function registerWaitSweeper(provider: DurabilityProvider): () => void {
  let set = sweepers.get(provider);
  if (set === undefined) {
    set = new Set();
    sweepers.set(provider, set);
  }
  const token = Symbol("wait-sweeper");
  set.add(token);
  return () => {
    set!.delete(token);
  };
}

/**
 * Whether a durability sweeper that resumes waits is registered on `provider`
 * in this process: one runs, so a wait parked here is bounded (FIX-1816 BR-5).
 */
export function hasWaitSweeper(provider: DurabilityProvider): boolean {
  return (sweepers.get(provider)?.size ?? 0) > 0;
}

/**
 * Install the provider-wide fact on a host's request-host inputs, read as each
 * request starts (`RequestHost.hasWaitSweeper`), unless one is installed. Used
 * by `createFlowState` and a router's handlers alike. A router then replaces it
 * on its own inputs with its own sweeper's answer (`createFlowApiRouter`), so a
 * router whose sweep is off never offers a wait because another host on the
 * same provider sweeps.
 */
export function installWaitSweeperFact(
  requestHost: { waitSweeper?: () => boolean },
  provider: DurabilityProvider
): void {
  requestHost.waitSweeper ??= () => hasWaitSweeper(provider);
}
