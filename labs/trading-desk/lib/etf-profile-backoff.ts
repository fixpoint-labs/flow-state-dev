/**
 * Refusal backoff policy for ETF profile fills (FIX-801 Decision 5, §9).
 *
 * A refusal is remembered with a class + a `retry_at` stamp so the fill route
 * can assert the boundary rather than a duration, and so a shared 25-per-day
 * Alpha Vantage budget can't be drained by re-mounting the Health view against
 * an unfetchable ticker. Every value here is a proposed default, exported as a
 * named constant (a tuning number, not a contract) — not a magic number
 * scattered through the route.
 *
 * Leaf module: no imports, no IO of its own.
 */

/** The five refusal classes (FIX-801 §9's backoff table). `not_an_etf` /
 *  `ineligible` / `malformed` are the fetcher's own domain-level judgments
 *  (`EtfRefusalReason` in `providers/etf-profile.ts`); `quota` / `transient`
 *  are classified by the ROUTE from an `alphaVantageRequest` throw, since the
 *  fetcher itself never catches those — it just lets them propagate. */
export type EtfProfileRefusalClass =
  | "not_an_etf"
  | "ineligible"
  | "malformed"
  | "quota"
  | "transient";

export const QUOTA_RETRY_AT_DAILY_RESET = "next UTC daily reset" as const; // documentation marker only
export const TRANSIENT_RETRY_MS = 15 * 60 * 1000; // ~15 minutes
export const MALFORMED_RETRY_MS = 7 * 24 * 60 * 60 * 1000; // ~7 days
export const PERMANENT_RETRY_MS = 90 * 24 * 60 * 60 * 1000; // ~90 days — not_an_etf / ineligible

/** After this many CONSECUTIVE `transient` refusals for one ticker, escalate
 *  to the long-lived (`PERMANENT_RETRY_MS`) backoff instead of retrying every
 *  ~15 minutes — a persistent outage must stop costing attention, not just
 *  budget (the fetch itself is free to attempt; the point is not hammering a
 *  ticker that keeps timing out). */
export const TRANSIENT_ESCALATION_THRESHOLD = 3;

/** The next UTC midnight strictly after `now` — Alpha Vantage's daily reset. */
export function nextUtcDailyReset(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0),
  );
}

/**
 * The `retry_at` timestamp for a freshly-recorded refusal, given the ticker's
 * PRIOR consecutive-transient-attempt count (0 for a ticker with no prior
 * transient streak, or after any non-transient/successful outcome). Returns
 * the timestamp alongside the NEW `transientAttempts` count the caller should
 * persist (0 for every class except an unescalated `transient`, which
 * increments).
 */
export function computeRefusalBackoff(
  reason: EtfProfileRefusalClass,
  now: Date,
  priorTransientAttempts: number,
): { retryAt: Date; transientAttempts: number } {
  if (reason === "quota") {
    return { retryAt: nextUtcDailyReset(now), transientAttempts: 0 };
  }
  if (reason === "malformed") {
    return { retryAt: new Date(now.getTime() + MALFORMED_RETRY_MS), transientAttempts: 0 };
  }
  if (reason === "not_an_etf" || reason === "ineligible") {
    return { retryAt: new Date(now.getTime() + PERMANENT_RETRY_MS), transientAttempts: 0 };
  }
  // transient
  const attempts = priorTransientAttempts + 1;
  if (attempts >= TRANSIENT_ESCALATION_THRESHOLD) {
    // Escalate — stop retrying every ~15 minutes against a persistent outage.
    return { retryAt: new Date(now.getTime() + PERMANENT_RETRY_MS), transientAttempts: attempts };
  }
  return { retryAt: new Date(now.getTime() + TRANSIENT_RETRY_MS), transientAttempts: attempts };
}
