// @vitest-environment happy-dom
/**
 * While an agent's step is in flight, the group's own line says what it is
 * doing, so the streaming indicator under it would say the same thing twice.
 * The indicator comes back whenever no step is in flight, which is when it is
 * the only sign the request is alive.
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RequestGroupRenderer } from "../../registry/components/request-group";
import { messageItem, reasoningItem, toolItem } from "../../stories/fixtures/items";

afterEach(cleanup);

const bash = (description: string, status: "completed" | "in_progress") =>
  toolItem({ name: "Bash", args: { command: "pnpm test", description }, status });

type StreamItem = Parameters<typeof RequestGroupRenderer>[0]["items"][number];

function renderStream(items: StreamItem[], statusMessage?: string) {
  render(<RequestGroupRenderer items={[messageItem({ role: "user" }), ...items]} isStreaming statusMessage={statusMessage} />);
}

describe("the streaming indicator beside a live group", () => {
  it("is not shown while a step is in flight, so the same words are not on screen twice", () => {
    renderStream([bash("Read core harness contract", "in_progress")], "Read core harness contract");
    expect(screen.getAllByText(/Read core harness contract/)).toHaveLength(1);
    expect(screen.queryByText("Working...")).toBeNull();
  });

  it("is shown when the steps so far are done and the agent is between them", () => {
    renderStream([bash("Read core harness contract", "completed")]);
    expect(screen.getByText("Working...")).toBeTruthy();
  });

  it("is shown before the first step", () => {
    renderStream([], "Starting Claude Code…");
    expect(screen.getByText("Starting Claude Code…")).toBeTruthy();
  });

  it("is not shown while a thought is in flight either", () => {
    renderStream([reasoningItem({ text: "Weighing the options", status: "in_progress" })], "Weighing the options");
    expect(screen.getAllByText(/Weighing the options/)).toHaveLength(1);
    expect(screen.queryByText("Working...")).toBeNull();
  });

  // The group shows what `ItemsRenderer` shows, so the rule reads the same
  // render stream: an item it drops is not a step on screen, and one it keeps
  // is, wherever it sits among the others.
  it("is not shown when a trace item follows the running step", () => {
    const trace = { ...messageItem({ role: "assistant" }), type: "block_trace" } as unknown as StreamItem;
    renderStream([bash("Read core harness contract", "in_progress"), trace], "Read core harness contract");
    expect(screen.getAllByText(/Read core harness contract/)).toHaveLength(1);
    expect(screen.queryByText("Working...")).toBeNull();
  });

  it("is not shown while an earlier call is still running behind a later one that finished", () => {
    renderStream([bash("Read the slow file", "in_progress"), bash("Read the fast file", "completed")], "Read the slow file");
    expect(screen.queryByText("Working...")).toBeNull();
    expect(screen.getAllByText(/Read the slow file/)).toHaveLength(1);
  });

  it("is shown when the running step is one the group does not render", () => {
    const hidden = { ...bash("Read core harness contract", "in_progress"), itemVisibility: { history: false } } as StreamItem;
    renderStream([hidden]);
    expect(screen.getByText("Working...")).toBeTruthy();
  });
});

// A run that works for minutes with nothing new to say still reads as alive:
// the line carries how long the request has been going, counted from its first
// item, whether or not the indicator is showing its own words.
describe("the elapsed time beside a live request", () => {
  const START = 1_000_000;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(START);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const startedAt = (items: StreamItem[]) => [{ ...messageItem({ role: "user" }), ts: START }, ...items];
  const live = (items: StreamItem[], statusMessage?: string) =>
    render(<RequestGroupRenderer items={startedAt(items)} isStreaming statusMessage={statusMessage} />);
  const tick = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

  it("counts up beside the indicator from the request's first item", () => {
    live([bash("Read core harness contract", "completed")]);
    expect(screen.queryByTestId("run-timer")).toBeNull();
    tick(84_000);
    expect(screen.getByTestId("run-timer").textContent).toBe("(1m 24s)");
    tick(1_000);
    expect(screen.getByTestId("run-timer").textContent).toBe("(1m 25s)");
  });

  it("is still there while a step is in flight and the indicator is hidden", () => {
    live([bash("Read core harness contract", "in_progress")], "Read core harness contract");
    tick(42_000);
    expect(screen.getByTestId("run-timer").textContent).toBe("(42s)");
    expect(screen.queryByTestId("streaming-indicator")).toBeNull();
    expect(screen.getAllByText(/Read core harness contract/)).toHaveLength(1);
  });

  it("runs in hours for a long request, and from the first item, not from mount", () => {
    vi.setSystemTime(START + 3_780_000);
    live([bash("Read core harness contract", "completed")]);
    expect(screen.getByTestId("run-timer").textContent).toBe("(1h 3m)");
  });

  it("is gone once the request stops streaming", () => {
    const { rerender } = live([bash("Read core harness contract", "completed")]);
    tick(5_000);
    rerender(<RequestGroupRenderer items={startedAt([bash("Read core harness contract", "completed")])} isStreaming={false} />);
    expect(screen.queryByTestId("run-timer")).toBeNull();
  });

  it("stops ticking when the request ends", () => {
    const { unmount } = live([bash("Read core harness contract", "completed")]);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
