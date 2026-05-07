/**
 * Internal dev-warn helper.
 *
 * Used by the model resolver to emit one-shot warnings for non-fatal
 * resolution issues (e.g., an unknown intent name falling back to
 * `defaultModel`). Suppressed in production and when callers explicitly
 * opt out via `FSD_QUIET_WARNINGS=1`.
 *
 * Not part of the public API — do not re-export from `models/index.ts`.
 */

const warned = new Set<string>();

/**
 * Emit `console.warn` once per `key`. Subsequent calls with the same key are
 * no-ops. Skipped in production builds and when `FSD_QUIET_WARNINGS=1`.
 */
export function devWarnOnce(key: string, message: string): void {
  if (process.env.NODE_ENV === "production") return;
  if (process.env.FSD_QUIET_WARNINGS === "1") return;
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[flow-state-dev] ${message}`);
}

/** Reset the internal warned-key set. Test-only. */
export function _resetDevWarnsForTesting(): void {
  warned.clear();
}
