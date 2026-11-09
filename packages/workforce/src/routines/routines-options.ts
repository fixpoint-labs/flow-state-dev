// FIX-2614.
/**
 * The routine options an installation's `hireWorkforce` was given, kept per
 * installation so the routines capability a worker flow uses reads them
 * without being told twice. A worker flow is built before `hireWorkforce`
 * runs, so the capability reads them when a verb runs, not when it is built.
 */
import type { ScheduleIndex, ScheduleIndexEntry } from "@flow-state-dev/scheduled/collection";
import type { SubscriptionProvider } from "../subscriptions/subscribe";

/** The options the capability reads: the schedule index and the providers. */
export interface RoutinesReach {
  readonly index?: ScheduleIndex;
  readonly providers?: readonly SubscriptionProvider[];
}

const given = new WeakMap<object, RoutinesReach>();

/** Keep `options` for `installation`. `hireWorkforce`'s `routines` calls it. */
export function setRoutinesReach(installation: object, options: RoutinesReach): void {
  given.set(installation, options);
}

/** The providers `installation`'s `hireWorkforce` was given; none before it runs. */
export function routineProvidersOf(installation: object): readonly SubscriptionProvider[] {
  return given.get(installation)?.providers ?? [];
}

/**
 * A schedule index that forwards to the one `installation`'s `hireWorkforce`
 * was given, when it was given one, and otherwise does nothing: a clock
 * routine a worker saves is mirrored exactly as one the roster saves.
 */
export function routineIndexOf(installation: object): ScheduleIndex {
  const index = () => given.get(installation)?.index;
  return {
    upsert: async (entry: ScheduleIndexEntry) => {
      await index()?.upsert(entry);
    },
    remove: async (id) => {
      await index()?.remove(id);
    },
    claimDue: async (now, limit) => (await index()?.claimDue(now, limit)) ?? []
  };
}
