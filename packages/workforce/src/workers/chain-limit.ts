/**
 * The chain limit an app sets through `hireWorkforce` (FIX-1802 BR-21a): the
 * most tasks one top task may have under it, at any depth, for every chain on
 * an installation's flows. A leaf module, so the filing kit reads it without
 * importing the installation.
 */

/** The chain limit each installation's `hireWorkforce` set, if it set one. */
const taskChainLimits = new WeakMap<object, number>();

/**
 * Set the chain limit for `installation`. `hireWorkforce`'s `taskChainLimit`
 * calls it; the filing kit reads it on every filing.
 *
 * @throws When `limit` isn't a whole number of at least one.
 */
export function setTaskChainLimit(installation: object, limit: number): void {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(`hireWorkforce: taskChainLimit must be a whole number of at least 1; got ${String(limit)}.`);
  }
  taskChainLimits.set(installation, limit);
}

/** The chain limit `installation`'s `hireWorkforce` set, or `undefined` for the default. */
export function taskChainLimitOf(installation: object): number | undefined {
  return taskChainLimits.get(installation);
}
