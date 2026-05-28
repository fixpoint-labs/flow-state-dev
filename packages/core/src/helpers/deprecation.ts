/**
 * One-shot warnings for runtime API surfaces.
 *
 * The framework prefers compile-time `@deprecated` JSDoc, but some
 * warnings only surface at flow-definition or resolution time. The helpers
 * here collapse repeated emissions for the same key so a single process
 * emits one message per (call site, scope) regardless of how many times
 * the path runs.
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

/**
 * Emit a non-fatal dev warning at most once per process per `key`. Skipped
 * in production builds and when `FSD_QUIET_WARNINGS=1`. Used for resolver
 * fallbacks and similar best-effort diagnostics that should not surface in
 * deployed apps.
 */
export function warnOnceDev(key: string, message: string): void {
  if (process.env.NODE_ENV === "production") return;
  if (process.env.FSD_QUIET_WARNINGS === "1") return;
  if (warned.has(key)) return;
  warned.add(key);
  // eslint-disable-next-line no-console
  console.warn(`[flow-state-dev] ${message}`);
}

/** Test-only: forget all warned keys so a fresh process can be simulated. */
export function __resetDeprecationWarningsForTests(): void {
  warned.clear();
}
