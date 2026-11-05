/**
 * The one crossing double, for goal checks only (FIX-2426).
 *
 * The in-memory bus with its crossing answer settable. It starts crossing, as
 * the in-memory bus itself does (it serves an app that runs as one process,
 * FIX-2545). A check flips it with `setCrossing(false)` to stand for a bus that
 * doesn't reach every writer, on which views keep their timed reads.
 *
 * Not re-exported from `index.mts`, and no package exports it. Import it directly:
 *
 *   import { crossingBus } from "../../lib/crossing-bus.mts";
 *
 * FIX-2428's, FIX-1506's and FIX-2429's goal checks use this one rather than
 * build their own.
 */
import { createInMemoryBus, type ChangeBus } from "@flow-state-dev/engine";

/** A crossing double: the in-memory bus, whose crossing answer a check can flip. */
export type CrossingBus = ChangeBus & {
  /** Change the answer, as a cross-process bus does when it stops hearing its own ping. */
  setCrossing(crosses: boolean): void;
};

/**
 * Create the in-memory bus reporting `crossesProcesses: true` until a check
 * sets it otherwise. Notices reach
 * every registry in this process that holds it, and only those.
 */
export function crossingBus(): CrossingBus {
  const inner = createInMemoryBus();
  const listeners = new Set<(crosses: boolean) => void>();
  let crosses = true;
  return {
    publish: (notice) => inner.publish(notice),
    subscribe: (topic, listener) => inner.subscribe(topic, listener),
    get crossesProcesses() {
      return crosses;
    },
    onCrossingChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setCrossing(next) {
      if (next === crosses) return;
      crosses = next;
      for (const listener of [...listeners]) listener(next);
    }
  };
}
