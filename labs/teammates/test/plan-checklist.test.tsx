// @vitest-environment happy-dom
/**
 * The harness plan checklist: pure mapping and popup rendering.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PlanChecklist } from "../src/components/PlanChecklist";
import { currentPlanIndex, planChecklistSummary, planStatusKind, planStatusLabel } from "../src/components/flow-state/plan-checklist";

afterEach(cleanup);

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

describe("PlanChecklist", () => {
  it("shows each step with a status marker and a truncated note when the plan was cut", () => {
    render(
      <PlanChecklist
        running
        plan={{
          truncated: true,
          rows: [
            { id: "1", title: "Read the task", status: "completed" },
            { id: "2", title: "Fix the bug", status: "in_progress" },
          ],
        }}
      />,
    );
    expect(screen.getByText(/Step 2 of 2: Fix the bug/)).toBeTruthy();
    expect(screen.getByText("Read the task")).toBeTruthy();
    expect(screen.getByText("More steps were recorded than this view shows.")).toBeTruthy();
    expect(screen.getAllByText("In progress").length).toBeGreaterThan(0);
  });

  it("renders nothing for an empty plan", () => {
    const { container } = render(<PlanChecklist running={false} plan={{ truncated: false, rows: [] }} />);
    expect(container.querySelector("[data-plan-checklist]")).toBeNull();
  });
});