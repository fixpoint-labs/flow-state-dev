// @vitest-environment happy-dom
/**
 * An open hold or a pull-request wait with no live run must not draw a clock
 * that counts up: the panel, the popup and the conversation card show the
 * static label and either no time or time frozen at the hold.
 */
import { act, cleanup, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { CODER_FLOW, type CodingBoardTask } from "@flow-state-dev/harness-manager/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PopupView } from "../src/components/Popups";
import { TeammatePanel } from "../src/components/TeammatePanel";
import { TaskCard } from "../src/components/TaskCard";
import { rosterEntry } from "./scripted-server";
import { codingTask, hold, stubServer, TestProvider } from "./stub-server";
import { activeElapsedMs, runsNow } from "../src/lib/task";
import { useNow } from "../src/lib/use-watch";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const MIN = 60_000;
const worker = rosterEntry({ id: "lead", name: "Lead", description: "Runs the team" });

const base = (over: Partial<CodingBoardTask> = {}): CodingBoardTask => {
  const now = Date.now();
  return codingTask({
    id: "t1",
    assignee: "coder",
    title: "Ship the change",
    status: "in_progress",
    harness: "claude-code",
    runFlow: CODER_FLOW,
    run: { sessionId: "run-1", requestId: "req-1", attempt: 1, startedAt: now - 10 * MIN },
    ...over,
  });
};

const live = (over: Partial<CodingBoardTask> = {}): CodingBoardTask => base({ leaseUntil: Date.now() + 60 * MIN, ...over });

describe("idle tasks don't tick", () => {
  it("the panel holds useNow and shows no counting elapsed time on an open hold", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    const openedAt = Date.now() - 5 * MIN;
    const task = base({ asks: [hold("question", "Which branch?", { taskId: "t1", id: "h1", openedAt })], leaseUntil: undefined });
    const { client } = stubServer({ board: { s1: [task] } });
    render(
      <TestProvider client={client}>
        <TeammatePanel worker={worker} sessionId="s1" openTask={undefined} nameOf={(id) => id} isCoding={() => true} onOpen={() => {}} />
      </TestProvider>,
    );
  const panel = await screen.findByRole("complementary", { name: "Lead's panel" });
    const card = await within(panel).findByRole("button", { name: /Ship the change/ });
    const elapsed = () => card.querySelector("[data-elapsed]");
    expect(within(card).getByText("waiting on you")).toBeTruthy();
    const before = elapsed()?.textContent ?? null;
    act(() => vi.advanceTimersByTime(5_000));
    expect(elapsed()?.textContent ?? null).toBe(before);
    act(() => vi.advanceTimersByTime(60_000));
    expect(elapsed()?.textContent ?? null).toBe(before);
    const { result } = renderHook(() => useNow(1_000, false));
    const frozen = result.current;
    act(() => vi.advanceTimersByTime(60_000));
    expect(result.current).toBe(frozen);
  });

  it("a live run's elapsed time counts up again", () => {
    vi.useFakeTimers();
    const start = Date.now() - 4 * MIN;
    const task = live({ run: { sessionId: "run-1", requestId: "req-1", attempt: 1, startedAt: start }, leaseUntil: Date.now() + 60 * MIN });
    expect(runsNow(task, Date.now())).toBe(true);
    const first = activeElapsedMs(task, Date.now());
    vi.advanceTimersByTime(3_000);
    const next = activeElapsedMs(task, Date.now());
    expect(next! - first!).toBe(3_000);
  });

  it("the popup freezes attempt time while it waits on you and does not start useNow", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    const openedAt = Date.UTC(2026, 10, 4, 9, 0, 0);
    const started = openedAt - 8 * MIN;
    const task = base({
      asks: [hold("question", "Which file?", { taskId: "t1", openedAt })],
      run: { sessionId: "run-1", requestId: "req-1", attempt: 1, startedAt: started },
      leaseUntil: undefined,
    });
    vi.setSystemTime(openedAt + MIN);
    const { client } = stubServer({ board: { conversation: [task] } });
    render(
      <TestProvider client={client}>
        <PopupView popup={{ kind: "task", sessionId: "conversation", taskId: task.id }} nameOf={(id) => id} lookOf={() => ({}) as never} isCoding={() => true} coders={[]} onClose={() => {}} />
      </TestProvider>,
    );
    const popup = await screen.findByRole("dialog");
    const total = () => popup.querySelector("[data-run-total]")?.textContent ?? null;
    await waitFor(() => expect(total()).toBe("8m 0s"));
    act(() => vi.advanceTimersByTime(10_000));
    expect(total()).toBe("8m 0s");
  });

  it("the popup attempt clock runs again when a lease holds the task", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    const start = Date.UTC(2026, 10, 4, 9, 0, 0);
    vi.setSystemTime(start + 4 * MIN + 12_000);
    const task = live({
      run: { sessionId: "run-1", requestId: "req-1", attempt: 1, startedAt: start },
      leaseUntil: start + 86_400_000,
    });
    const { client } = stubServer({ board: { conversation: [task] }, items: { "run-1": [] }, requestStarts: { "req-1": start } });
    render(
      <TestProvider client={client}>
        <PopupView popup={{ kind: "task", sessionId: "conversation", taskId: task.id }} nameOf={(id) => id} lookOf={() => ({}) as never} isCoding={() => true} coders={[]} onClose={() => {}} />
      </TestProvider>,
    );
    const popup = await screen.findByRole("dialog");
    const total = () => popup.querySelector("[data-run-total]")?.textContent ?? "";
    await waitFor(() => expect(total()).toMatch(/^4m 1[23]s/));
    await act(async () => {
      vi.advanceTimersByTime(2_000);
    });
    await waitFor(() => expect(total()).toMatch(/^4m 1[456]s/));
  });

  it("the conversation card shows frozen time on a hold and does not tick", () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    const openedAt = Date.now() - 2 * MIN;
    const task = base({ asks: [hold("review", "Review", { taskId: "t1", openedAt })], leaseUntil: undefined });
    const { container, rerender } = render(<TaskCard task={task} coding nameOf={(id) => id} onOpen={() => {}} />);
    const since = () => container.querySelector("[data-task-since]")?.textContent ?? null;
    expect(since()).toMatch(/· 8m/);
    act(() => vi.advanceTimersByTime(30_000));
    rerender(<TaskCard task={task} coding nameOf={(id) => id} onOpen={() => {}} />);
    expect(since()).toMatch(/· 8m/);
  });

  it("the conversation card counts up while a live run holds the task", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    const start = Date.now() - 90_000;
    const task = live({ run: { sessionId: "run-1", requestId: "req-1", attempt: 1, startedAt: start }, leaseUntil: Date.now() + 60 * MIN });
    const { container, rerender } = render(<TaskCard task={task} coding nameOf={(id) => id} onOpen={() => {}} />);
    const since = () => container.querySelector("[data-task-since]")?.textContent ?? "";
    expect(since()).toBe("· 1m");
    act(() => vi.advanceTimersByTime(5_000));
    rerender(<TaskCard task={task} coding nameOf={(id) => id} onOpen={() => {}} />);
    await waitFor(() => expect(since()).toBe("· 1m"));
    act(() => vi.advanceTimersByTime(60_000));
    rerender(<TaskCard task={task} coding nameOf={(id) => id} onOpen={() => {}} />);
    await waitFor(() => expect(since()).toBe("· 2m"));
  });
});