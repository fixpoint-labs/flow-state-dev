// @vitest-environment happy-dom
/**
 * The harness plan checklist in a coding task's popup: rows, markers, truncated note.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PlanChecklist } from "../src/components/PlanChecklist";

afterEach(cleanup);

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