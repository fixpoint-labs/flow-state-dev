// @vitest-environment happy-dom
/**
 * A plan row reads at a glance: a mark for how far along it is, then the title
 * on its own line, so a long title wraps under the mark instead of squeezing
 * beside a label. A row nobody has started holds no status, and reads as to do,
 * not as a missing value.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { PlanRowLine } from "../components/plan-row";

afterEach(cleanup);

const row = (status: string | null, title: string | null = "Fix the drift") =>
  render(<ol><PlanRowLine rowKey="1" title={title} status={status} /></ol>);

describe("PlanRowLine", () => {
  it("shows a row with no status as to do, never as 'no status'", () => {
    row(null);
    expect(screen.getByTestId("plan-row").getAttribute("data-stage")).toBe("pending");
    expect(screen.getByTestId("plan-row-status").getAttribute("aria-label")).toBe("To do");
    expect(screen.queryByText("no status")).toBeNull();
  });

  it("marks each stage differently, so progress reads without the words", () => {
    const stages = ["pending", "in_progress", "completed"].map((status) => {
      row(status);
      const stage = screen.getByTestId("plan-row").getAttribute("data-stage");
      cleanup();
      return stage;
    });
    expect(stages).toEqual(["pending", "active", "done"]);
  });

  it("says a status it does not know in the harness's words", () => {
    row("deleted");
    expect(screen.getByTestId("plan-row").getAttribute("data-stage")).toBe("other");
    expect(screen.getByText("deleted")).toBeTruthy();
  });

  it("keeps the title whole, falling back to the row's key", () => {
    row("pending", "Run codex-real-cli.test.ts on a host that allows binding 127.0.0.1");
    expect(screen.getByText("Run codex-real-cli.test.ts on a host that allows binding 127.0.0.1")).toBeTruthy();
    cleanup();
    row("pending", null);
    expect(screen.getByText("1")).toBeTruthy();
  });
});
