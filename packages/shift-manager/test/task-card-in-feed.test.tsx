// @vitest-environment happy-dom
/**
 * One card per task the turn filed. Status comes from the board, so a task
 * the feed still holds as running can show errored.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OutputItem } from "@flow-state-dev/core/items";
import { SessionScope, TaskBoardMeta } from "../src/components/TaskBoardMeta";
import { TASKS_POLL_MS } from "../src/components/TasksPanel";

type Row = { id: string; goal: string; title?: string; status: string; assignee?: string; attempts: number };
let rows: Row[] = [];
let failing = false;
const calls: string[] = [];
let refreshes = 0;
const lab: { client: { userId: string }; snapshot: Record<string, unknown>; refresh: () => Promise<void> } = {
  client: { userId: "alice" },
  snapshot: { readAt: 1 },
  refresh: async () => void refreshes++,
};
vi.mock("../src/lib/lab-data", () => ({ useLab: () => lab }));
// The user's conversation with the Error Reporter, as the snapshot lists it; `null` before a first line.
let reporterConversation: string | null = null;
const conversationsAskedFor: unknown[] = [];
vi.mock("../src/lib/conversation", () => ({
  useConversationSession: (worker: unknown) => {
    conversationsAskedFor.push(worker);
    return worker === undefined ? null : reporterConversation;
  },
}));
const navigated: unknown[] = [];
vi.mock("../src/lib/routes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/routes")>()),
  navigate: (route: unknown) => void navigated.push(route),
}));
vi.mock("../src/lib/conversation-tasks", () => ({
  readConversationTasks: async (_c: unknown, flow: string, sessionId: string) => {
    calls.push(`list ${flow} ${sessionId}`);
    if (failing) throw new Error("network");
    return rows.map((row) => ({ ...row }));
  },
}));

beforeEach(() => {
  rows = [];
  failing = false;
  refreshes = 0;
  calls.length = 0;
  lab.snapshot = { readAt: 1 };
  reporterConversation = null;
  conversationsAskedFor.length = 0;
  navigated.length = 0;
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});
const tick = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

const meta = (requestId: string) =>
  ({ id: `m-${requestId}`, type: "component", component: "task-board-meta", requestId, status: "completed", data: { collectionId: "tasks", status: "active" } }) as never;

const filed = (requestId: string, id: string, title: string, assignee: string): OutputItem =>
  ({
    id: `c-${id}`,
    type: "component",
    component: "task-change",
    requestId,
    status: "completed",
    data: { collectionId: "tasks", taskId: id, kind: "added", task: { id, goal: `${title}, in full`, title, status: "in_progress", assignee } },
  }) as unknown as OutputItem;

const scope = (items: OutputItem[], requestIds: string[]) => (
  <SessionScope sessionId="s1" flow="coordinator" items={items}>
    {requestIds.map((requestId) => (
      <TaskBoardMeta key={requestId} item={meta(requestId)} />
    ))}
  </SessionScope>
);

const cards = () =>
  screen.queryAllByTestId("task-card").map((card) => ({
    id: card.getAttribute("data-task-id"),
    status: card.getAttribute("data-status"),
    text: card.textContent,
  }));

describe("a delegated post's task in the feed", () => {
  it("is one card for the task its turn filed, not the conversation's list", async () => {
    const items = [filed("r1", "t1", "Post for eng.pm", "eng.pm"), filed("r2", "t2", "Post for eng.qa", "eng.qa")];
    rows = [
      { id: "t1", goal: "Post for eng.pm, in full", title: "Post for eng.pm", status: "completed", assignee: "eng.pm", attempts: 1 },
      { id: "t2", goal: "Post for eng.qa, in full", title: "Post for eng.qa", status: "in_progress", assignee: "eng.qa", attempts: 1 },
    ];
    render(scope(items, ["r2"]));
    await tick(0);
    expect(cards()).toEqual([{ id: "t2", status: "in_progress", text: expect.stringContaining("Post for eng.qa") }]);
    expect(cards()[0]!.text).toContain("eng.qa");
    expect(cards()[0]!.text).toContain("running");
    expect(screen.queryByText("Post for eng.pm")).toBeNull();
    expect(screen.getByTestId("task-open").getAttribute("aria-label")).toBe("Open Post for eng.qa");
  });

  it("shows a task that failed as failed, though the feed only holds it running", async () => {
    rows = [{ id: "t1", goal: "Post for eng.pm, in full", title: "Post for eng.pm", status: "errored", assignee: "eng.pm", attempts: 1 }];
    render(scope([filed("r1", "t1", "Post for eng.pm", "eng.pm")], ["r1"]));
    await tick(0);
    expect(cards()).toEqual([{ id: "t1", status: "errored", text: expect.stringContaining("errored") }]);
    expect(document.querySelector(".animate-spin")).toBeNull();
  });

  it("follows the task as it moves, with no reload, and reads nothing more once it has ended", async () => {
    rows = [{ id: "t1", goal: "g", title: "Post for eng.pm", status: "in_progress", assignee: "eng.pm", attempts: 1 }];
    render(scope([filed("r1", "t1", "Post for eng.pm", "eng.pm")], ["r1"]));
    await tick(0);
    expect(cards()[0]!.status).toBe("in_progress");
    rows = [{ ...rows[0]!, status: "completed" }];
    await tick(TASKS_POLL_MS);
    expect(cards()[0]).toMatchObject({ status: "completed", text: expect.stringContaining("completed") });
    // The task moved: the Lab is read again, so what it counts agrees with the card.
    expect(refreshes).toBe(1);
    const read = calls.length;
    await tick(TASKS_POLL_MS * 20);
    expect(calls).toHaveLength(read);
  });

  it("reads the board again when the Lab is read again, so a task that took a message shows running", async () => {
    rows = [{ id: "t1", goal: "g", title: "Post for eng.pm", status: "completed", assignee: "eng.pm", attempts: 1 }];
    const items = [filed("r1", "t1", "Post for eng.pm", "eng.pm")];
    const { rerender } = render(scope(items, ["r1"]));
    await tick(0);
    expect(cards()[0]!.status).toBe("completed");
    rows = [{ ...rows[0]!, status: "in_progress" }];
    lab.snapshot = { readAt: 2 };
    rerender(scope(items, ["r1"]));
    await tick(0);
    expect(cards()[0]!.status).toBe("in_progress");
  });

  it("keeps reading through a failed read, so a task that ended while the read failed still shows ended", async () => {
    rows = [{ id: "t1", goal: "g", title: "Post for eng.pm", status: "in_progress", assignee: "eng.pm", attempts: 1 }];
    render(scope([filed("r1", "t1", "Post for eng.pm", "eng.pm")], ["r1"]));
    await tick(0);
    failing = true;
    await tick(TASKS_POLL_MS);
    expect(cards()[0]!.status).toBe("in_progress");
    failing = false;
    rows = [{ ...rows[0]!, status: "errored" }];
    await tick(TASKS_POLL_MS);
    expect(cards()[0]!.status).toBe("errored");
  });

  it("reads one board for every card in the feed", async () => {
    const items = [filed("r1", "t1", "Post for eng.pm", "eng.pm"), filed("r2", "t2", "Post for eng.qa", "eng.qa")];
    rows = [
      { id: "t1", goal: "g", title: "Post for eng.pm", status: "in_progress", assignee: "eng.pm", attempts: 1 },
      { id: "t2", goal: "g", title: "Post for eng.qa", status: "in_progress", assignee: "eng.qa", attempts: 1 },
    ];
    render(scope(items, ["r1", "r2"]));
    await tick(0);
    expect(calls).toEqual(["list coordinator s1"]);
  });
});

describe("a cancelled task's card", () => {
  const reporter = { id: "error-reporter", kind: "error-reporter", door: "run", rules: true, team: "general", name: "Error Reporter" };
  const withReporter = () => {
    lab.snapshot = { readAt: 1, inventory: { ok: true, value: { workers: [reporter] } }, sessions: [] };
  };
  const cancelledRow = { id: "t1", goal: "g", title: "Post for eng.pm", status: "cancelled", assignee: "eng.pm", attempts: 1 };

  it("tells the user to tell the Error Reporter, naming the task, if it was cancelled because something went wrong", async () => {
    // A cancel isn't reported on its own: the user is the only one who knows it hid a problem.
    withReporter();
    rows = [cancelledRow];
    render(scope([filed("r1", "t1", "Post for eng.pm", "eng.pm")], ["r1"]));
    await tick(0);
    const note = screen.getByTestId("task-cancelled-note");
    expect(note.textContent).toContain("Cancelled because something went wrong?");
    expect(note.textContent).toContain("Error Reporter");
    expect(note.textContent).toContain("t1");
    expect(conversationsAskedFor).toContainEqual(reporter);
  });

  it("opens the user's conversation with the Error Reporter from the note when they have one", async () => {
    withReporter();
    reporterConversation = "s-reporter";
    rows = [cancelledRow];
    render(scope([filed("r1", "t1", "Post for eng.pm", "eng.pm")], ["r1"]));
    await tick(0);
    fireEvent.click(screen.getByTestId("task-cancelled-report"));
    expect(navigated).toEqual([{ level: "session", sessionId: "s-reporter" }]);
  });

  it("names no worker to tell when the Lab has no Error Reporter", async () => {
    rows = [cancelledRow];
    render(scope([filed("r1", "t1", "Post for eng.pm", "eng.pm")], ["r1"]));
    await tick(0);
    expect(screen.queryByTestId("task-cancelled-note")).toBeNull();
  });

  it("isn't on a task that failed or finished: a failure is reported without asking", async () => {
    withReporter();
    rows = [{ ...cancelledRow, status: "errored" }];
    const { rerender } = render(scope([filed("r1", "t1", "Post for eng.pm", "eng.pm")], ["r1"]));
    await tick(0);
    expect(screen.queryByTestId("task-cancelled-note")).toBeNull();
    rows = [{ ...cancelledRow, status: "completed" }];
    lab.snapshot = { ...lab.snapshot, readAt: 2 };
    rerender(scope([filed("r1", "t1", "Post for eng.pm", "eng.pm")], ["r1"]));
    await tick(0);
    expect(cards()[0]!.status).toBe("completed");
    expect(screen.queryByTestId("task-cancelled-note")).toBeNull();
  });
});
