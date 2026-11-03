/**
 * The one crossing double, for goal checks only (FIX-2426).
 *
 * The in-memory bus, saying it crosses processes. A goal check that runs on
 * one process (two registries, or one host) and must assert "no read between
 * changes" needs a bus whose answer is "crosses", or the session stream keeps
 * its once-a-second read and the assertion can't fail. This is that bus.
 *
 * Not re-exported from `index.mts`, and no package exports it: no app option
 * makes the in-memory bus cross (FIX-2426 D1). Import it directly:
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
 * Create the in-memory bus reporting `crossesProcesses: true`. Notices reach
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
