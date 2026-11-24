// @vitest-environment happy-dom
/**
 * The in-flight line every host draws while work runs: the chat under a
 * request, a task's feed in the teammates popup, the coding lab's task sheet.
 *
 * Why it matters: the label is whatever the run is doing now, and a coding run
 * says a whole shell command. In a narrow task pane that text must not push
 * the label onto a second line or shove the timer off the edge, so the label is
 * cut on one line with the full text on hover, and the timer never wraps or
 * shrinks.
 *
 * Red state produced before this was trusted: the indicator as it stood (label
 * free to wrap, no `title`, timer free to shrink) fails every case here.
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StreamingIndicator } from "../../registry/components/streaming-indicator";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const LONG = "Running pnpm --filter @flow-state-dev/engine test -- --reporter=verbose test/stream-resume.test.ts test/views.test.ts";

describe("the in-flight line stays on one line", () => {
  it("cuts a long label at the edge and keeps the whole of it on hover", () => {
    render(<StreamingIndicator message={LONG} />);
    const label = screen.getByTitle(LONG);
    expect(label.textContent).toBe(LONG);
    expect(label.className).toContain("truncate");
    expect(label.className).toContain("min-w-0");
  });

  it("says Tidying up... on one line too, with the same hover text", () => {
    render(<StreamingIndicator message={LONG} isFinishing />);
    const label = screen.getByTitle("Tidying up...");
    expect(label.className).toContain("truncate");
  });

  it("keeps the timer whole beside a long label: it neither wraps nor shrinks", () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(10_000_000);
    render(<StreamingIndicator message={LONG} since={10_000_000 - 252_000} />);
    const timer = screen.getByTestId("run-timer");
    expect(timer.textContent).toBe("(4m 12s)");
    expect(timer.className).toContain("whitespace-nowrap");
    expect(timer.className).toContain("shrink-0");
    act(() => void vi.advanceTimersByTime(3_000));
    expect(timer.textContent).toBe("(4m 15s)");
  });
});
