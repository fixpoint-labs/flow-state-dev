/**
 * Tests for the ETF-profile refusal backoff policy (FIX-801 §9). Pins the
 * boundary each failure class heals at, and the transient-escalation rule.
 */
import { describe, expect, it } from "vitest";
import {
  MALFORMED_RETRY_MS,
  PERMANENT_RETRY_MS,
  TRANSIENT_ESCALATION_THRESHOLD,
  TRANSIENT_RETRY_MS,
  computeRefusalBackoff,
  nextUtcDailyReset,
} from "../lib/etf-profile-backoff";

const NOW = new Date("2026-07-25T15:30:00Z");

describe("nextUtcDailyReset", () => {
  it("returns the next UTC midnight strictly after now", () => {
    expect(nextUtcDailyReset(NOW).toISOString()).toBe("2026-07-26T00:00:00.000Z");
  });

  it("rolls to the following day even right at midnight", () => {
    expect(nextUtcDailyReset(new Date("2026-07-25T00:00:00Z")).toISOString()).toBe(
      "2026-07-26T00:00:00.000Z",
    );
  });
});

describe("computeRefusalBackoff", () => {
  it("quota heals at the next UTC daily reset, not a fixed delay", () => {
    const { retryAt, transientAttempts } = computeRefusalBackoff("quota", NOW, 0);
    expect(retryAt.toISOString()).toBe(nextUtcDailyReset(NOW).toISOString());
    expect(transientAttempts).toBe(0);
  });

  it("malformed heals after ~7 days", () => {
    const { retryAt } = computeRefusalBackoff("malformed", NOW, 0);
    expect(retryAt.getTime() - NOW.getTime()).toBe(MALFORMED_RETRY_MS);
  });

  it("not_an_etf and ineligible heal after ~90 days", () => {
    expect(computeRefusalBackoff("not_an_etf", NOW, 0).retryAt.getTime() - NOW.getTime()).toBe(
      PERMANENT_RETRY_MS,
    );
    expect(computeRefusalBackoff("ineligible", NOW, 0).retryAt.getTime() - NOW.getTime()).toBe(
      PERMANENT_RETRY_MS,
    );
  });

  it("a fresh transient refusal heals after ~15 minutes and increments the streak", () => {
    const { retryAt, transientAttempts } = computeRefusalBackoff("transient", NOW, 0);
    expect(retryAt.getTime() - NOW.getTime()).toBe(TRANSIENT_RETRY_MS);
    expect(transientAttempts).toBe(1);
  });

  it("escalates to the long-lived backoff after the threshold of consecutive transient refusals", () => {
    const priorAttempts = TRANSIENT_ESCALATION_THRESHOLD - 1;
    const { retryAt, transientAttempts } = computeRefusalBackoff("transient", NOW, priorAttempts);
    expect(transientAttempts).toBe(TRANSIENT_ESCALATION_THRESHOLD);
    expect(retryAt.getTime() - NOW.getTime()).toBe(PERMANENT_RETRY_MS);
  });

  it("a non-transient class resets the transient streak to 0", () => {
    expect(computeRefusalBackoff("quota", NOW, 2).transientAttempts).toBe(0);
    expect(computeRefusalBackoff("malformed", NOW, 2).transientAttempts).toBe(0);
  });
});
