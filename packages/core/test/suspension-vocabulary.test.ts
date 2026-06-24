/**
 * FIX-849: the generalized resolution vocabulary.
 *
 * Covers the type/constant changes that widen HITL resolution beyond binary
 * approve/reject: the new terminal statuses, the action→status map shared by the
 * route and runAction, and the reason-based `allow` defaults.
 */
import { describe, it, expect } from "vitest";
import {
  RESUME_ACTION_STATUS,
  TERMINAL_SUSPENSION_STATUSES,
  isTerminalSuspensionStatus,
  SUSPENSION_SKIPPED
} from "../src/types";
import type { ResumeAction, SuspensionStatus } from "../src/types";
import { SuspensionError, resolveAllowedActions } from "../src/errors";

describe("terminal suspension statuses", () => {
  it("treats submitted and skipped as terminal (so retention prunes them)", () => {
    expect(isTerminalSuspensionStatus("submitted")).toBe(true);
    expect(isTerminalSuspensionStatus("skipped")).toBe(true);
    expect(TERMINAL_SUSPENSION_STATUSES).toContain("submitted");
    expect(TERMINAL_SUSPENSION_STATUSES).toContain("skipped");
  });

  it("keeps pending as the sole non-terminal status", () => {
    expect(isTerminalSuspensionStatus("pending")).toBe(false);
    const allStatuses: SuspensionStatus[] = [
      "pending",
      "approved",
      "rejected",
      "submitted",
      "skipped",
      "timed_out",
      "expired"
    ];
    const nonTerminal = allStatuses.filter((s) => !isTerminalSuspensionStatus(s));
    expect(nonTerminal).toEqual(["pending"]);
  });
});

describe("RESUME_ACTION_STATUS", () => {
  it("maps each action to its terminal status", () => {
    expect(RESUME_ACTION_STATUS).toEqual({
      approve: "approved",
      reject: "rejected",
      submit: "submitted",
      skip: "skipped"
    });
  });

  it("covers every ResumeAction", () => {
    const actions: ResumeAction[] = ["approve", "reject", "submit", "skip"];
    for (const action of actions) {
      expect(RESUME_ACTION_STATUS[action]).toBeDefined();
    }
  });

  it("only maps to terminal statuses (so resolved suspensions are prunable)", () => {
    for (const status of Object.values(RESUME_ACTION_STATUS)) {
      expect(isTerminalSuspensionStatus(status)).toBe(true);
    }
  });
});

describe("resolveAllowedActions", () => {
  it("defaults human_input to submit-only", () => {
    expect(resolveAllowedActions("human_input", undefined)).toEqual(["submit"]);
  });

  it("defaults human_approval (and any other reason) to binary approve/reject", () => {
    expect(resolveAllowedActions("human_approval", undefined)).toEqual(["approve", "reject"]);
    expect(resolveAllowedActions("external_event", undefined)).toEqual(["approve", "reject"]);
  });

  it("honours an explicit allow set over the reason default", () => {
    expect(resolveAllowedActions("human_input", ["submit", "skip"])).toEqual(["submit", "skip"]);
  });
});

describe("SuspensionError.allow", () => {
  it("resolves the default allow set from the reason", () => {
    const err = new SuspensionError({ suspensionId: "s1", reason: "human_input" });
    expect(err.allow).toEqual(["submit"]);
  });

  it("carries an explicit allow set verbatim", () => {
    const err = new SuspensionError({
      suspensionId: "s1",
      reason: "human_input",
      allow: ["submit", "skip"]
    });
    expect(err.allow).toEqual(["submit", "skip"]);
  });
});

describe("SUSPENSION_SKIPPED sentinel", () => {
  it("is a stable cross-realm symbol distinct from any data payload", () => {
    expect(typeof SUSPENSION_SKIPPED).toBe("symbol");
    expect(SUSPENSION_SKIPPED).toBe(Symbol.for("fsd.suspension.skipped"));
    // The sentinel must never collide with a plausible resume payload.
    expect(SUSPENSION_SKIPPED).not.toEqual({});
    expect(SUSPENSION_SKIPPED).not.toEqual(null);
  });
});
