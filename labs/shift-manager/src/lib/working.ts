/**
 * Whether the chief of staff is working on a line the person sent it: true
 * from the moment a line goes out until every line sent has settled.
 *
 * Three places show it, v2's way (v2:52-56, 127, 167-169): the sidebar
 * entry's blue dot, the screen's sub line and the thinking line. They read it
 * here, so they can't disagree. It is what this page sent, not something the
 * Lab reports: a line sent from another page doesn't light it.
 */
import { useSyncExternalStore } from "react";

/** Lines in flight. A count, not a flag: a second line sent before the first settles keeps it lit. */
let inFlight = 0;
const listeners = new Set<() => void>();

const notify = () => {
  for (const listener of listeners) listener();
};

/**
 * Say a line has gone out. Call the returned function once its send settles,
 * however it settles; calling it again does nothing.
 */
export function startChiefOfStaffWork(): () => void {
  inFlight += 1;
  if (inFlight === 1) notify();
  let done = false;
  return () => {
    if (done) return;
    done = true;
    inFlight -= 1;
    if (inFlight === 0) notify();
  };
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
const current = () => inFlight > 0;

/** Whether a line from this page is in flight, read once (outside React). */
export const isChiefOfStaffWorking: () => boolean = current;

/** Whether the chief of staff is working on a line from this page. */
export function useChiefOfStaffWorking(): boolean {
  return useSyncExternalStore(subscribe, current, current);
}
