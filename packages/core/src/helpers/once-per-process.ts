/**
 * Once-per-process claims that survive module re-evaluation.
 *
 * Boot diagnostics guard on these so they print once per server start. The
 * claimed keys live on `globalThis` under a `Symbol.for` slot rather than in a
 * module-level `Set`: a dev server that re-evaluates modules on every edit
 * (`next dev` re-runs transpiled workspace packages) would otherwise start each
 * generation with an empty set, and "once per process" would become "once per
 * hot reload".
 */

const CLAIMED_KEYS = Symbol.for("@flow-state-dev/core/once-per-process");

/** The process-wide set of claimed keys. Internal: tests clear it through `__resetDeprecationWarningsForTests`. */
export function claimedKeys(): Set<string> {
  const slot = globalThis as typeof globalThis & { [CLAIMED_KEYS]?: Set<string> };
  return (slot[CLAIMED_KEYS] ??= new Set<string>());
}

/**
 * `true` the first time `key` is claimed in this process, `false` every time
 * after. Survives module re-evaluation, so a boot diagnostic guarded by it
 * prints once per server start rather than once per hot reload.
 *
 * Unlike `warnOnceDev`, this is NOT dev-only and does NOT honour
 * `FSD_QUIET_WARNINGS`: it only answers "first time?", and the caller decides
 * what to print and when.
 *
 * Namespace the key by package (`"workforce/..."`, `"engine/..."`): every
 * caller in the process shares one set.
 */
export function firstInProcess(key: string): boolean {
  const claimed = claimedKeys();
  if (claimed.has(key)) return false;
  claimed.add(key);
  return true;
}
