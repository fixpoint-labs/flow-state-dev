/**
 * A line the palette (⌘K, `> `) hands to the Shift Coordinator's own composer.
 *
 * The palette doesn't send it: the composer on the Coordinator screen does, so
 * the line goes through the same path as one typed there (the feed follows it,
 * the working state shows, a failure lands in the composer's status). Only one
 * line is held, and it is taken once.
 */
import { useSyncExternalStore } from "react";

let pending: string | null = null;
const listeners = new Set<() => void>();

const notify = () => {
  for (const listener of listeners) listener();
};

/** Hold `message` for the Coordinator's composer to send. */
export function handToChiefOfStaff(message: string): void {
  pending = message;
  notify();
}

/** Drop the held line, once it has been taken or the screen is left. */
export function clearHandedLine(): void {
  if (pending === null) return;
  pending = null;
  notify();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
const current = () => pending;

/** The line waiting for the Coordinator's composer, or `null`. */
export function useHandedLine(): string | null {
  return useSyncExternalStore(subscribe, current, current);
}
