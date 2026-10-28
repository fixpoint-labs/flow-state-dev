/**
 * A suspension deadline written in this process, heard by the sweeper on the
 * same provider (FIX-2063 D3). A gate another process writes is seen at the
 * next tick.
 */
import type { DurabilityProvider } from "./types";

type Listener = (expiresAt: number) => void;

const listeners = new WeakMap<DurabilityProvider, Set<Listener>>();

/** Listen for suspension deadlines written on `provider` in this process. Returns the unsubscribe. */
export function onSuspensionDeadline(provider: DurabilityProvider, listener: Listener): () => void {
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

/** Tell the sweepers on `provider` that a pending suspension now expires at `expiresAt`. */
export function noteSuspensionDeadline(provider: DurabilityProvider, expiresAt: number): void {
  for (const listener of listeners.get(provider) ?? []) listener(expiresAt);
}
