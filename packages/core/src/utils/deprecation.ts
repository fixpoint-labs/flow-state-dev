/**
 * One-shot deprecation warnings for runtime API surfaces.
 *
 * The framework prefers compile-time `@deprecated` JSDoc, but some
 * deprecations (e.g. accepting both an old and a new config shape) only
 * surface at flow-definition time. `warnDeprecated` collapses repeated
 * warnings for the same key so a single process emits one message per
 * (call site, scope) regardless of how many times the path runs.
 */

const warned = new Set<string>();

/**
 * Emit a deprecation warning at most once per process per `key`.
 * The key is the dedup identity — pick a stable string that uniquely
 * identifies the call site (e.g. `clientData:flowKind:session`).
 */
export function warnDeprecated(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  // eslint-disable-next-line no-console
  console.warn(`[flow-state-dev] DEPRECATED: ${message}`);
}

/** Test-only: forget all warned keys so a fresh process can be simulated. */
export function __resetDeprecationWarningsForTests(): void {
  warned.clear();
}
