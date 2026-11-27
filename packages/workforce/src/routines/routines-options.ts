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
  // FIX-2536.
  /** Polling, when the app polls: its own schedule index (one index ticks one flow) and the default cadence. */
  readonly poll?: { readonly index: ScheduleIndex; readonly everyMinutes?: number };
  /** The ids of the app's declared routines: a poll ends a declared event routine whose entry left config. */
  readonly declared?: readonly { readonly id: string }[];
}

const given = new WeakMap<object, RoutinesReach>();

// FIX-2624.
/** The seed of the app's declared routines for the running user, as `hireWorkforce` sets it per installation. */
type RequestSeed = (ctx: import("@flow-state-dev/core/types").BlockContext) => Promise<unknown>;

const seeds = new WeakMap<object, RequestSeed>();

/** Keep the declared routines' seed for `installation`, which every worker request runs. `hireWorkforce` calls it. */
export function setRoutineSeed(installation: object, seed: RequestSeed): void {
  seeds.set(installation, seed);
}

/** The declared routines' seed `installation`'s `hireWorkforce` set; `undefined` before it runs. */
export function routineSeedOf(installation: object): RequestSeed | undefined {
  return seeds.get(installation);
}

/** Keep `options` for `installation`. `hireWorkforce`'s `routines` calls it. */
export function setRoutinesReach(installation: object, options: RoutinesReach): void {
  given.set(installation, options);
}

/** The declared routines' ids `installation`'s `hireWorkforce` was given; none before it runs. */
export function routineDeclaredOf(installation: object): readonly { readonly id: string }[] {
  return given.get(installation)?.declared ?? [];
}

/** Whether `installation`'s `hireWorkforce` was given polling. */
export function routinePollingOn(installation: object): boolean {
  return given.get(installation)?.poll !== undefined;
}

/** `installation`'s polling index: the one its `hireWorkforce` was given in `routines.poll`, and otherwise nothing. */
export function routinePollIndexOf(installation: object): ScheduleIndex {
  const index = () => given.get(installation)?.poll?.index;
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

/** `installation`'s default polling cadence, in minutes: `routines.poll.everyMinutes`, else 5. */
export function routinePollMinutesOf(installation: object): number {
  return given.get(installation)?.poll?.everyMinutes ?? 5;
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
