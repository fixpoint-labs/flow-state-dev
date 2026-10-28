/**
 * The take rule and the resend backoff a task notice and a worker message
 * share (FIX-2240). Both deliveries are "once" only if every caller decides
 * the same way: a taker still running keeps its delivery, a taker that ended
 * without finishing hands it over, and resends space out the same way.
 */
import { describe, expect, it } from "vitest";
import { NOTICE_DUE_MS, NOTICE_RESEND_CAP_MS, nextResendAt, takeRule } from "../../src/tasks";

describe("takeRule", () => {
  it("takes as its own when nobody took it, or this request did", () => {
    expect(takeRule(undefined, "req-a", false)).toEqual({ take: "own" });
    // Its own earlier take is not a take-over: no `replacing` guard on the write.
    expect(takeRule("req-a", "req-a", true)).toEqual({ take: "own" });
  });

  it("leaves it to another taker that hasn't ended, so it is delivered once", () => {
    expect(takeRule("req-b", "req-a", false)).toEqual({ take: "busy" });
  });

  it("takes over from a taker that ended without finishing, so it is never lost", () => {
    expect(takeRule("req-b", "req-a", true)).toEqual({ take: "takeover", replacing: "req-b" });
  });
});

describe("nextResendAt", () => {
  it("is the due time until it has been resent", () => {
    expect(nextResendAt(undefined, 1_000)).toBe(1_000);
  });

  it("doubles the gap after each resend, so a copy on its way isn't sent again", () => {
    expect(nextResendAt({ at: 10_000, n: 1 }, 0)).toBe(10_000 + NOTICE_DUE_MS * 2);
    expect(nextResendAt({ at: 10_000, n: 3 }, 0)).toBe(10_000 + NOTICE_DUE_MS * 8);
  });

  it("never waits longer than the cap between two resends", () => {
    expect(nextResendAt({ at: 10_000, n: 30 }, 0)).toBe(10_000 + NOTICE_RESEND_CAP_MS);
  });
});
