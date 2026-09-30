/**
 * One-shot warnings for runtime API surfaces.
 *
 * The framework prefers compile-time `@deprecated` JSDoc, but some
 * warnings only surface at flow-definition or resolution time. The helpers
 * here collapse repeated emissions for the same key so a single process
 * emits one message per (call site, scope) regardless of how many times
 * the path runs.
 */

// The claimed keys live on `globalThis`, not in a module-level `Set`. A dev
// server that re-evaluates modules on every edit (`next dev` re-runs every
// transpiled workspace package, this one included) would otherwise start each
// generation with an empty set, and "once per process" would become "once per
// hot reload". `Symbol.for` keeps the slot the same across those generations.
const CLAIMED_KEYS = Symbol.for("@flow-state-dev/core/once-per-process");

function claimedKeys(): Set<string> {
  const slot = globalThis as typeof globalThis & { [CLAIMED_KEYS]?: Set<string> };
  return (slot[CLAIMED_KEYS] ??= new Set<string>());
}

/**
 * `true` the first time `key` is claimed in this process, `false` every time
 * after. Survives module re-evaluation, so a boot diagnostic guarded by it
 * prints once per server start rather than once per hot reload.
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

/**
 * Emit a non-fatal dev warning at most once per process per `key`. Skipped
 * in production builds and when `FSD_QUIET_WARNINGS=1`. Used for resolver
 * fallbacks and similar best-effort diagnostics that should not surface in
 * deployed apps.
 */
export function warnOnceDev(key: string, message: string): void {
  if (process.env.NODE_ENV === "production") return;
  if (process.env.FSD_QUIET_WARNINGS === "1") return;
  if (!firstInProcess(`warnOnceDev/${key}`)) return;
  // eslint-disable-next-line no-console
  console.warn(`[flow-state-dev] ${message}`);
}

/** Test-only: forget all claimed keys so a fresh process can be simulated. */
export function __resetDeprecationWarningsForTests(): void {
  claimedKeys().clear();
}
