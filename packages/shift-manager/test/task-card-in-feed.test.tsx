// @vitest-environment happy-dom
/**
 * One card per task the turn filed. Status comes from the board, so a task
 * the feed still holds as running can show errored.
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OutputItem } from "@flow-state-dev/core/items";
import { SessionScope, TaskBoardMeta } from "../src/components/TaskBoardMeta";
import { TASKS_POLL_MS } from "../src/components/TasksPanel";

type Row = { id: string; goal: string; title?: string; status: string; assignee?: string; attempts: number };
let rows: Row[] = [];
const calls: string[] = [];
const lab = { clients: { userId: "alice" }, snapshot: { readAt: 1 } };
vi.mock("../src/lib/lab-data", () => ({ useLab: () => lab }));
vi.mock("../src/lib/conversation-tasks", () => ({
  readConversationTasks: async (_c: unknown, flow: string, sessionId: string) => {
    calls.push(`list ${flow} ${sessionId}`);
    return rows.map((row) => ({ ...row }));
  },
}));

beforeEach(() => {
  rows = [];
  calls.length = 0;
  lab.snapshot = { readAt: 1 };
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
    rows = [{ ...rows[0]!, status: "parked" }];
    await tick(TASKS_POLL_MS);
    expect(cards()[0]).toMatchObject({ status: "parked", text: expect.stringContaining("needs you") });
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
