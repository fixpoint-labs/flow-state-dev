/**
 * The harness plan checklist: status mapping and summary lines.
 */
import { describe, expect, it } from "vitest";
import { currentPlanIndex, planChecklistSummary, planStatusKind, planStatusLabel } from "../src/components/flow-state/plan-checklist";

describe("planStatusKind", () => {
  it("maps harness status words to pending, in progress, completed and failed", () => {
    expect(planStatusKind("pending")).toBe("pending");
    expect(planStatusKind("IN_PROGRESS")).toBe("in_progress");
    expect(planStatusKind("completed")).toBe("completed");
    expect(planStatusKind("failed")).toBe("failed");
    expect(planStatusKind("blockedOnReview")).toBe("pending");
  });
});

describe("currentPlanIndex", () => {
  it("prefers the first in-progress row, then the first pending", () => {
    const steps = [
      { status: "completed" },
      { status: "in_progress" },
      { status: "pending" },
    ];
    expect(currentPlanIndex(steps)).toBe(1);
    expect(currentPlanIndex(steps.map(() => ({ status: "completed" })))).toBe(-1);
    expect(currentPlanIndex([{ status: "completed" }, { status: "pending" }])).toBe(1);
  });
});

describe("planChecklistSummary", () => {
  it("names the current step in the plan", () => {
    expect(
      planChecklistSummary([
        { title: "Read", status: "completed" },
        { title: "Fix", status: "in_progress" },
      ]),
    ).toBe("Step 2 of 2: Fix");
  });
});

describe("planStatusLabel", () => {
  it("gives short labels for each marker kind", () => {
    expect(planStatusLabel("in_progress")).toBe("In progress");
    expect(planStatusLabel("failed")).toBe("Failed");
  });
});