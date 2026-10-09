/**
 * Ask deadlines noted as turns park, so the durability sweeper can bring its
 * next tick forward (FIX-1816, BR-14).
 *
 * Keyed on the durability provider: the runtime that parks a turn and the
 * sweeper that times it out share one provider object per host, even when the
 * router and a colocated worker hold different copies of the runtime config.
 * One sweeper per host listens; no timer per ask.
 */
import type { DurabilityProvider } from "./types";

type Listener = (deadline: number) => void;

const listeners = new WeakMap<DurabilityProvider, Set<Listener>>();

/** Listen for deadlines noted on `provider`. Returns the unsubscribe. */
export function onAskDeadline(provider: DurabilityProvider, listener: Listener): () => void {
  let set = listeners.get(provider);
  if (set === undefined) {
    set = new Set();
    listeners.set(provider, set);
  }
  set.add(listener);
  return () => {
    set!.delete(listener);
  };
}

/** Note that a turn parked on an ask that times out at `deadline` (epoch ms). */
export function noteAskDeadline(provider: DurabilityProvider, deadline: number): void {
  for (const listener of listeners.get(provider) ?? []) listener(deadline);
}
