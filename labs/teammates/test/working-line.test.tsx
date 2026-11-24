// @vitest-environment happy-dom
/**
 * A running task's feed ends in a live line that says it is alive and what it
 * is doing now. Without it, a run between steps (a long test run, a big edit)
 * reads as a feed that went quiet, with only the header's RUNNING to go on.
 * The line names the most specific status there is (the tool call in flight,
 * then the plan step in progress, then a plain "Working..."), counts the time
 * since the current request started, and is gone the moment the task stops running. The
 * call in flight is read from the run session's items, the plan from
 * harness-manager's recorded work view, the note from the board row, and the
 * request start from its stream.
 */
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { CODER_FLOW, type CodingBoardTask } from "@flow-state-dev/harness-manager/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PopupView } from "../src/components/Popups";
import { attemptStartedAt } from "../src/lib/task";
import { codingTask, hold, stubServer, TestProvider, type StubData } from "./stub-server";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const STARTED = Date.UTC(2026, 10, 4, 9, 0, 0);

/** The run's items so far: it has done things, and a command is still running. */
const item = (id: string, status: string, body: Record<string, unknown>) => ({ id, requestId: "req-1", status, provenance: { blockName: "claude-code-agent" }, ...body });
const said = item("s1", "completed", { type: "message", role: "assistant", content: [{ type: "output_text", text: "Looking at the log." }] });
const test = (status: string) => item("t1", status, { type: "tool_output", toolCall: { name: "Bash", arguments: JSON.stringify({ command: "cd labs/teammates && pnpm test" }) } });

const RUNNING: CodingBoardTask = codingTask({
  id: "t-1",
  assignee: "coder.claude-code",
  title: "Fix session log ordering",
  status: "in_progress",
  harness: "claude-code",
  runFlow: CODER_FLOW,
  run: { sessionId: "run-1", requestId: "req-1", attempt: 1, startedAt: STARTED },
});

/** The popup on a running task, over a stand-in server a test changes as the board and the run would. */
function open(task: CodingBoardTask = RUNNING, extra: Omit<StubData, "board"> = {}) {
  const data: StubData = { board: { conversation: [task] }, items: { "run-1": [said, test("in_progress")] }, requestStarts: { "req-1": STARTED }, ...extra };
  const server = stubServer(data);
  render(
    <TestProvider client={server.client}>
      <PopupView popup={{ kind: "task", sessionId: "conversation", taskId: task.id }} nameOf={(id) => id} lookOf={() => ({}) as never} isCoding={() => true} coders={[]} onClose={() => {}} />
    </TestProvider>,
  );
  const setTask = (next: Partial<CodingBoardTask>) => (data.board!.conversation![0] = { ...data.board!.conversation![0]!, ...next });
  return { popup: screen.getByRole("dialog"), server, data, setTask };
}

const line = (popup: HTMLElement) => within(popup).queryByTestId("streaming-indicator");

describe("a running task's feed ends in a live working line", () => {
  it("names the tool call in flight, then the plan step, then falls back to Working...", async () => {
    const { popup, server, data, setTask } = open(RUNNING, { plan: { "req-1": [{ title: "Add regression test", status: "in_progress" }] } });
    await waitFor(() => expect(line(popup)?.textContent).toContain("Running pnpm test"));
    // The run it reads is the task's own: its session and its request.
    expect(new Set(server.planReads)).toEqual(new Set(["req-1"]));

    // The command finished; the plan step in progress is the most specific status left.
    data.plan!["req-1"] = [{ title: "Read the adapter", status: "completed" }, { title: "Add regression test", status: "in_progress" }, { title: "Run checks", status: "pending" }];
    act(() => server.push("run-1", test("completed")));
    await waitFor(() => expect(line(popup)?.textContent).toContain("Step 2 of 3: Add regression test"));

    // Nothing more specific: the run's own note, and with no note, the plain label.
    delete data.plan!["req-1"];
    setTask({ statusNote: "Reading the session log" });
    await waitFor(() => expect(line(popup)?.textContent).toContain("Reading the session log"));
    setTask({ statusNote: undefined });
    await waitFor(() => expect(line(popup)?.textContent).toMatch(/^Working\.\.\./));
  });

  it("reads no recorded work for a plain teammate task: that view is the coding flow's, and refuses a run on another flow", async () => {
    const plain = { ...RUNNING, assignee: "writer", harness: null, runFlow: "agent" };
    const { popup, server } = open(plain);
    await waitFor(() => expect(within(popup).getByText("Looking at the log.")).toBeTruthy());
    // Its run's own feed still reads; the coding flow's plan view never does.
    await new Promise((settle) => setTimeout(settle, 300));
    expect(server.planReads).toEqual([]);
  });

  it("follows a re-run in the same session: the new request is the run it reads", async () => {
    const { popup, server, setTask } = open();
    await waitFor(() => expect(line(popup)).not.toBeNull());
    setTask({ run: { sessionId: "run-1", requestId: "req-2", attempt: 2, startedAt: STARTED } });
    await waitFor(() => expect(server.planReads).toContain("req-2"));
  });

  it("counts the time since the request started, and keeps counting", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(STARTED + 4 * 60_000 + 12_000);
    const { popup } = open();
    await waitFor(() => expect(within(popup).getByTestId("run-timer").textContent).toBe("(4m 12s)"));
    act(() => vi.advanceTimersByTime(3_000));
    expect(within(popup).getByTestId("run-timer").textContent).toBe("(4m 15s)");
  });

  it("on a task woken after a long wait, the live line counts this reply and the header counts the attempt", async () => {
    // The attempt started two days ago and waited on its pull request; a message woke it 90 seconds ago, as a new turn.
    const WOKEN = STARTED + 2 * 86_400_000 + 3 * 3_600_000;
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(WOKEN + 90_000);
    const earlier = { ...said, ts: STARTED + 60_000 };
    const reply = (id: string, ts: number, status: string) => ({ ...test(status), id, requestId: "req-2", ts });
    const task = { ...RUNNING, run: { ...RUNNING.run!, requestId: "req-2" } };
    const { popup } = open(task, { items: { "run-1": [earlier, reply("t2", WOKEN, "completed"), reply("t3", WOKEN + 30_000, "in_progress")] }, requestStarts: { "req-2": WOKEN } });
    await waitFor(() => expect(within(popup).getByTestId("run-timer").textContent).toBe("(1m 30s)"));
    // Never the attempt's age on the live line: that reads as a reply stuck for days.
    expect(within(popup).getByTestId("run-timer").textContent).not.toContain("h");
    expect(popup.querySelector("[data-run-total]")?.textContent).toBe("2d 3h");
    expect(popup.querySelector("[data-run-total]")?.getAttribute("title")).toBe("Time on this attempt, waits included");
    act(() => vi.advanceTimersByTime(2_000));
    expect(within(popup).getByTestId("run-timer").textContent).toBe("(1m 32s)");
  });

  it("uses the request start even when the reply begins before the newest page", async () => {
    const woken = STARTED + 2 * 86_400_000;
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(woken + 90_000);
    const items = Array.from({ length: 250 }, (_, i) => ({
      ...test(i === 249 ? "in_progress" : "completed"),
      id: `tool-${i}`, requestId: "req-2", ts: woken + i * 200,
    }));
    const task = { ...RUNNING, run: { ...RUNNING.run!, requestId: "req-2" } };
    const { popup } = open(task, { items: { "run-1": items }, requestStarts: { "req-2": woken } });
    await waitFor(() => expect(within(popup).getByTestId("run-timer").textContent).toBe("(1m 30s)"));
  });

  it("hides the reply timer when its start is unavailable", async () => {
    const { popup } = open(RUNNING, { requestStarts: {} });
    await waitFor(() => expect(line(popup)).not.toBeNull());
    expect(within(popup).queryByTestId("run-timer")).toBeNull();
  });

  it("switches the reply timer when a new request arrives in the same session", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(STARTED + 90_000);
    const { popup, server, setTask } = open(RUNNING, { requestStarts: { "req-1": STARTED, "req-2": STARTED + 60_000 } });
    await waitFor(() => expect(within(popup).getByTestId("run-timer").textContent).toBe("(1m 30s)"));
    setTask({ run: { ...RUNNING.run!, requestId: "req-2" } });
    const next = { ...test("in_progress"), id: "new", requestId: "req-2", ts: STARTED + 60_000 };
    act(() => { server.push("run-1", next); vi.advanceTimersByTime(100); });
    await waitFor(() => expect(within(popup).getByTestId("run-timer").textContent).toBe("(30s)"));
  });

  it.each([
    ["done", { status: "completed", detail: { answer: "Fixed.", answerCut: false } }],
    ["failed", { status: "errored", error: "The checks stayed red." }],
    ["cancelled", { status: "cancelled" }],
  ] as const)("is gone once the task is %s", async (word, ended) => {
    const { popup, setTask } = open();
    await waitFor(() => expect(line(popup)).not.toBeNull());
    setTask({ ...ended, completedAt: STARTED + 120_000 });
    await waitFor(() => expect(line(popup)).toBeNull());
    expect(within(popup).getByText(word, { selector: "[data-overlay-status]" })).toBeTruthy();
    expect(popup.querySelector("[data-run-total]")).toBeNull();
  });

  it("is not shown while the task waits on you: the hold says what it needs instead", async () => {
    const { popup } = open({ ...RUNNING, asks: [hold("question", "Which file?", { taskId: "t-1" })] });
    expect(await within(popup).findByRole("region", { name: "Waiting on you" })).toBeTruthy();
    expect(line(popup)).toBeNull();
  });

  it("times this attempt from its run link's start, which a retry renews", () => {
    // This attempt's start wins over the task's own, which a retry keeps from its first run.
    expect(attemptStartedAt({ ...RUNNING, startedAt: STARTED - 1 })).toBe(STARTED);
    // A row with no run link yet falls back to the task's own start.
    expect(attemptStartedAt({ ...RUNNING, run: undefined, startedAt: STARTED - 1 })).toBe(STARTED - 1);
  });
});
