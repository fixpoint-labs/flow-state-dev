// FIX-2624.
/**
 * The user's routine collections, one set per installation: the schedules
 * and their fired records, the subscriptions with their cursors and thread
 * index, and the poll schedules. Every worker flow declares them through
 * `installation.resources`, so a worker's turn seeds the app's declared
 * routines; the roster flow and a worker's routine tools declare the same
 * definitions. Built once per installation, so every declaration is one object.
 */
import { scheduleResources } from "../schedules/scheduled-work";
import { subscriptionResources } from "../subscriptions/rows";
import { installationPolling } from "../subscriptions/poll";
import { routineIndexOf } from "./routines-options";

const built = new WeakMap<object, ReturnType<typeof buildRoutineResources>>();

function buildRoutineResources(installation: object) {
  // The index forwards to the one `hireWorkforce` is given, read when a write runs.
  return { ...scheduleResources(routineIndexOf(installation)), ...subscriptionResources, ...installationPolling(installation).resources };
}

/** `installation`'s routine collections, the same objects on every call. */
export function routineResourcesOf(installation: object) {
  let resources = built.get(installation);
  if (resources === undefined) {
    resources = buildRoutineResources(installation);
    built.set(installation, resources);
  }
  return resources;
}

/** The routine collections' type, as `installation.resources` carries them. */
export type RoutineResources = ReturnType<typeof routineResourcesOf>;
