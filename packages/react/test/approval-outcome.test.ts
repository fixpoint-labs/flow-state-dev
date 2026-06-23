import { describe, expect, it } from "vitest";
import { resolveApprovalOutcome } from "../src";

/**
 * The collapsed approval receipt is driven entirely by `resolveApprovalOutcome`.
 * These assertions pin the outcome's *meaning* (affirmative vs destructive vs
 * neutral) to the right tone class, not just the label text — a wrong tone would
 * show a red receipt for an approval, which is the failure mode that matters.
 */
describe("resolveApprovalOutcome", () => {
  it("maps approved to an affirmative (green) receipt", () => {
    const outcome = resolveApprovalOutcome("approved");
    expect(outcome.label).toBe("Approved");
    expect(outcome.toneClass).toBe("fsd-approval-receipt-approved");
    expect(outcome.icon).toBeTruthy();
  });

  it("maps rejected to a destructive (red) receipt", () => {
    const outcome = resolveApprovalOutcome("rejected");
    expect(outcome.label).toBe("Rejected");
    expect(outcome.toneClass).toBe("fsd-approval-receipt-rejected");
  });

  it("maps timed_out and expired to a neutral receipt", () => {
    expect(resolveApprovalOutcome("timed_out").toneClass).toBe("fsd-approval-receipt-neutral");
    expect(resolveApprovalOutcome("expired").toneClass).toBe("fsd-approval-receipt-neutral");
  });

  it("falls back to a neutral 'Resolved' receipt when the outcome is unknown", () => {
    const outcome = resolveApprovalOutcome(undefined);
    expect(outcome.label).toBe("Resolved");
    expect(outcome.toneClass).toBe("fsd-approval-receipt-neutral");
  });
});
