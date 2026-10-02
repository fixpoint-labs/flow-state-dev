/**
 * Whether the chief of staff is working on a line the person sent it: true
 * from the moment the line goes out until its send settles.
 *
 * Three places show it, v2's way (v2:52-56, 127, 167-169): the sidebar
 * entry's blue dot, the screen's sub line and the thinking line. They read it
 * here, so they can't disagree. It is what this page sent, not something the
 * Lab reports: a line sent from another page doesn't light it.
 */
import { useSyncExternalStore } from "react";

let working = false;
const listeners = new Set<() => void>();

/** Say whether a line is in flight. Listeners hear only a real change. */
export function setChiefOfStaffWorking(next: boolean): void {
  if (next === working) return;
  working = next;
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
const current = () => working;

/** Whether the chief of staff is working on a line from this page. */
export function useChiefOfStaffWorking(): boolean {
  return useSyncExternalStore(subscribe, current, current);
}
