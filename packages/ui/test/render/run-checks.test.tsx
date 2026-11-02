// @vitest-environment happy-dom
/**
 * A reviewer sees whether a run's checks passed before accepting it: the
 * count on one line, each command under it, and the output of a red one
 * without having to look for it. No checks draws nothing, since "0/0 passed"
 * would be a claim nobody checked.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RunChecks } from "../../registry/components/run-checks";

afterEach(cleanup);

const green = { command: "pnpm typecheck", exitCode: 0, timedOut: false, skipped: false, durationMs: 4200, tail: "done" };
const red = { command: "pnpm test", exitCode: 1, timedOut: false, skipped: false, durationMs: 900, tail: "FAIL src/a.test.ts" };

describe("a run's checks", () => {
  it("says how many passed, closed when all did, and opens into each command and its output", () => {
    const { container } = render(<RunChecks checks={[green, { ...green, command: "pnpm lint" }]} />);
    const summary = screen.getByRole("button", { name: "Checks 2/2 passed" });
    expect(container.firstElementChild?.getAttribute("data-state")).toBe("passed");
    expect(screen.queryByText("pnpm typecheck")).toBeNull();
    fireEvent.click(summary);
    fireEvent.click(screen.getByRole("button", { name: /pnpm typecheck/ }));
    expect(screen.getByText("done")).toBeTruthy();
  });

  it("opens a red set by itself, with the failing command's output showing", () => {
    const { container } = render(<RunChecks checks={[green, red]} />);
    expect(screen.getByRole("button", { name: "Checks 1/2 passed" })).toBeTruthy();
    expect(container.firstElementChild?.getAttribute("data-state")).toBe("failed");
    expect(screen.getByText("FAIL src/a.test.ts")).toBeTruthy();
    expect(screen.getByText(/exit 1/)).toBeTruthy();
    expect(screen.queryByText("done")).toBeNull();
  });

  it("names a check that ran out of time and one skipped after it as red", () => {
    render(<RunChecks checks={[{ ...red, exitCode: null, timedOut: true }, { ...green, skipped: true, durationMs: 0, tail: "" }]} />);
    expect(screen.getByRole("button", { name: "Checks 0/2 passed" })).toBeTruthy();
    expect(screen.getByText(/timed out/)).toBeTruthy();
    expect(screen.getByText("skipped")).toBeTruthy();
  });

  it("draws nothing when no check ran", () => {
    expect(render(<RunChecks checks={null} />).container.innerHTML).toBe("");
    cleanup();
    expect(render(<RunChecks checks={[]} />).container.innerHTML).toBe("");
  });
});
