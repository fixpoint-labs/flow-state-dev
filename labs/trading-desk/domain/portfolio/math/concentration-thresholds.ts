/**
 * Concentration thresholds shared by the wrapper-basis health leaf
 * (`portfolio-health.ts`) and the look-through leaf (`etf-look-through.ts`,
 * FIX-801 Decision 8: "the new axis emits its own flags at the same
 * thresholds"). Hoisted to its own leaf module so neither health leaf has to
 * import the other to reach them — `portfolio-health.ts` calls the
 * look-through leaf, so a constants-only shared dependency avoids a cycle
 * (BP-019: acyclic).
 *
 * Leaf module: no imports, no IO of its own.
 */

/** Single-name concentration thresholds (% of invested NAV). Warn ≥ these; the
 *  industry rules of thumb (J.P. Morgan / T. Rowe) converge on ~10% / ~25%.
 *  Configurability is deferred (Non-Goals) — if made configurable, the
 *  mandate is the home. */
export const SINGLE_NAME_WARN_PCT = 10;
export const SINGLE_NAME_ALERT_PCT = 25;
/** Sector-concentration warn threshold (% of invested NAV). ~25–30% rule of thumb. */
export const SECTOR_WARN_PCT = 30;
