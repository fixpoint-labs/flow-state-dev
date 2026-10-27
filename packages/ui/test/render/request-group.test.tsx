// @vitest-environment happy-dom
/**
 * While an agent's step is in flight, the group's own line says what it is
 * doing, so the streaming indicator under it does not repeat the status words:
 * it keeps its plain "Working..." label and the clock instead. The line never
 * collapses to a bare timer and comes back, and the status words return
 * whenever no step is in flight.
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
  it("does not repeat a running step's words, and keeps its own label", () => {
    renderStream([bash("Read core harness contract", "in_progress")], "Read core harness contract");
    expect(screen.getAllByText(/Read core harness contract/)).toHaveLength(1);
    expect(screen.getByText("Working...")).toBeTruthy();
  });

  it("is shown when the steps so far are done and the agent is between them", () => {
    renderStream([bash("Read core harness contract", "completed")]);
    expect(screen.getByText("Working...")).toBeTruthy();
  });

  it("is shown before the first step", () => {
    renderStream([], "Starting Claude Code…");
    expect(screen.getByText("Starting Claude Code…")).toBeTruthy();
  });

  it("does the same while a thought is in flight", () => {
    renderStream([reasoningItem({ text: "Weighing the options", status: "in_progress" })], "Weighing the options");
    expect(screen.getAllByText(/Weighing the options/)).toHaveLength(1);
    expect(screen.getByText("Working...")).toBeTruthy();
  });

  // The group shows what `ItemsRenderer` shows, so the rule reads the same
  // render stream: an item it drops is not a step on screen, and one it keeps
  // is, wherever it sits among the others.
  it("keeps the step's words out when a trace item follows the running step", () => {
    const trace = { ...messageItem({ role: "assistant" }), type: "block_trace" } as unknown as StreamItem;
    renderStream([bash("Read core harness contract", "in_progress"), trace], "Read core harness contract");
    expect(screen.getAllByText(/Read core harness contract/)).toHaveLength(1);
    expect(screen.getByTestId("streaming-indicator")).toBeTruthy();
  });

  it("keeps the step's words out while an earlier call is still running behind a later one that finished", () => {
    renderStream([bash("Read the slow file", "in_progress"), bash("Read the fast file", "completed")], "Read the slow file");
    expect(screen.getAllByText(/Read the slow file/)).toHaveLength(1);
    expect(screen.getByTestId("streaming-indicator")).toBeTruthy();
  });

  it("shows the status words when the running step is one the group does not render", () => {
    const hidden = { ...bash("Read core harness contract", "in_progress"), itemVisibility: { history: false } } as StreamItem;
    renderStream([hidden], "Read core harness contract");
    expect(screen.getAllByText(/Read core harness contract/)).toHaveLength(1);
    expect(screen.getByTestId("streaming-indicator")).toBeTruthy();
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

  it("sits beside the label while a step is in flight, never alone", () => {
    live([bash("Read core harness contract", "in_progress")], "Read core harness contract");
    tick(42_000);
    const indicator = screen.getByTestId("streaming-indicator");
    expect(indicator.textContent).toContain("Working...");
    expect(indicator.textContent).toContain("(42s)");
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
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

// The line a finished run leaves behind, where the indicator was.
describe("the worked-for line after a request", () => {
  const START = new Date(2026, 9, 27, 16, 25, 0).getTime();
  const done = (items: StreamItem[]) => [{ ...messageItem({ role: "user" }), ts: START }, ...items];
  const settled = (completedAt: number) => ({ ...bash("Run the suite", "completed"), completedAt }) as StreamItem;

  it("says how long the run took and when it ended", () => {
    const end = START + (3 * 60 + 24) * 1000;
    render(<RequestGroupRenderer items={done([settled(end)])} isStreaming={false} showWorkedFor />);
    const line = screen.getByTestId("worked-for").textContent ?? "";
    expect(line).toContain("Worked for 3m 24s");
    expect(line).toContain(new Date(end).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
  });

  it("takes the end from the request record when it has one, over the items", () => {
    const itemsEnd = START + 5_000;
    const recordEnd = START + (2 * 60 + 10) * 1000;
    render(<RequestGroupRenderer items={done([settled(itemsEnd)])} isStreaming={false} showWorkedFor latestCompletedAtMs={recordEnd} />);
    expect(screen.getByTestId("worked-for").textContent).toContain("Worked for 2m 10s");
  });

  it("is off unless asked for, so a chat reply is unchanged", () => {
    render(<RequestGroupRenderer items={done([settled(START + 5_000)])} isStreaming={false} />);
    expect(screen.queryByTestId("worked-for")).toBeNull();
  });

  it("waits for the run to end rather than appearing beside the indicator", () => {
    render(<RequestGroupRenderer items={done([settled(START + 5_000)])} isStreaming showWorkedFor />);
    expect(screen.queryByTestId("worked-for")).toBeNull();
  });

  it("stays quiet for a run under a second", () => {
    render(<RequestGroupRenderer items={done([settled(START + 400)])} isStreaming={false} showWorkedFor />);
    expect(screen.queryByTestId("worked-for")).toBeNull();
  });
});
