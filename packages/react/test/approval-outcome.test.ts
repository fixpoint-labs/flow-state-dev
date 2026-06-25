import { describe, expect, it } from "vitest";
import { resolveApprovalOutcome } from "../src";

/**
 * The collapsed approval receipt is driven by `resolveApprovalOutcome`. These
 * assertions pin the label per status and that approve vs reject vs unknown stay
 * distinct (a renderer maps the status to colour; a mislabelled outcome is the
 * failure mode that matters).
 */
describe("resolveApprovalOutcome", () => {
  it("labels approved and rejected distinctly", () => {
    expect(resolveApprovalOutcome("approved").label).toBe("Approved");
    expect(resolveApprovalOutcome("rejected").label).toBe("Rejected");
    expect(resolveApprovalOutcome("approved").icon).not.toBe(
      resolveApprovalOutcome("rejected").icon
    );
  });

  it("labels timed_out and expired", () => {
    expect(resolveApprovalOutcome("timed_out").label).toBe("Timed out");
    expect(resolveApprovalOutcome("expired").label).toBe("Expired");
  });

  it("labels the non-binary submitted and skipped resolutions (FIX-849)", () => {
    expect(resolveApprovalOutcome("submitted").label).toBe("Submitted");
    expect(resolveApprovalOutcome("skipped").label).toBe("Skipped");
    // A submitted/skipped receipt must read as such, not the neutral default.
    expect(resolveApprovalOutcome("submitted").label).not.toBe("Resolved");
    expect(resolveApprovalOutcome("skipped").label).not.toBe("Resolved");
  });

  it("falls back to a neutral 'Resolved' receipt when the outcome is unknown", () => {
    expect(resolveApprovalOutcome(undefined).label).toBe("Resolved");
  });
});
