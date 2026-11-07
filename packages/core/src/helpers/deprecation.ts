/**
 * One-shot warnings for runtime API surfaces.
 *
 * The framework prefers compile-time `@deprecated` JSDoc, but some
 * warnings only surface at flow-definition or resolution time. The helpers
 * here collapse repeated emissions for the same key so a single process
 * emits one message per (call site, scope) regardless of how many times
 * the path runs.
 */

import { claimedKeys, firstInProcess } from "./once-per-process";

/**
 * Emit a non-fatal dev warning at most once per process per `key`. Skipped
 * in production builds and when `FSD_QUIET_WARNINGS=1`. Used for resolver
 * fallbacks and similar best-effort diagnostics that should not surface in
 * deployed apps.
 */
export function warnOnceDev(key: string, message: string): void {
  if (process.env.NODE_ENV === "production") return;
  emitOnce(`warnOnceDev/${key}`, message);
}

/**
 * {@link warnOnceDev}'s production sibling: the same once-per-process key and
 * `FSD_QUIET_WARNINGS=1` opt-out, but it also warns when
 * `NODE_ENV=production`. For a warning a deployed app must still see, such as
 * an app that names no store and so keeps nothing across a restart.
 */
export function warnOnce(key: string, message: string): void {
  emitOnce(`warnOnce/${key}`, message);
}

/** The opt-out, the once-per-process claim and the output prefix both warnings share. */
function emitOnce(claim: string, message: string): void {
  if (process.env.FSD_QUIET_WARNINGS === "1") return;
  if (!firstInProcess(claim)) return;
  // eslint-disable-next-line no-console
  console.warn(`[flow-state-dev] ${message}`);
}

/** Test-only: forget all claimed keys so a fresh process can be simulated. */
export function __resetDeprecationWarningsForTests(): void {
  claimedKeys().clear();
}
