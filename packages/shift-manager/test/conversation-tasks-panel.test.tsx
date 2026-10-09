// @vitest-environment happy-dom
/**
 * TASKS, at Shift Coordinator (FIX-1794 S11): the tasks the person's
 * conversation filed, read through the conversation's own `listTasks` action.
 *
 * What it lists is what that read answered: the conversation's own board, never
 * a store or a Lab-wide walk. It reads again each time the Lab is read again,
 * which is after each turn the person sends (the reload floor), and on no
 * tool's name.
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TASKS_POLL_MS, TasksPanel } from "../src/components/TasksPanel";
import { toSeat } from "../src/lib/reads";

type Row = { id: string; goal: string; status: string; assignee?: string; attempts: number };
let rows: Row[] = [];
let refusal: string | null = null;
const calls: string[] = [];

const refreshes: number[] = [];
vi.mock("../src/lib/lab-data", () => {
  const lab = { clients: { userId: "alice" }, refresh: async () => void refreshes.push(Date.now()) };
  return { useLab: () => lab };
});
vi.mock("../src/lib/conversation-tasks", () => ({
  readConversationTasks: async (_c: unknown, kind: string, sessionId: string) => {
    calls.push(`list ${kind} ${sessionId}`);
    if (refusal !== null) throw new Error(refusal);
    return [...rows];
  },
}));

const cos = toSeat({ id: "chief-of-staff", kind: "coordinator", door: "run" })!;

beforeEach(() => {
  rows = [];
  refusal = null;
  calls.length = 0;
  refreshes.length = 0;
});
afterEach(cleanup);

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const shown = () =>
  screen.queryAllByTestId("cos-task").map((li) => ({
    id: li.getAttribute("data-task-id"),
    status: li.getAttribute("data-status"),
    text: li.textContent,
  }));

describe("the tasks panel (S11)", () => {
  it("says tasks belong to a conversation before there is one, and reads nothing", async () => {
    render(<TasksPanel seat={cos} sessionId={null} readAt={1} />);
    await settle();
    expect(screen.getByTestId("cos-tasks-none")).toBeTruthy();
    expect(calls).toEqual([]);
  });

  it("lists what the conversation's own read answers: each task's goal, status and delegate", async () => {
    rows = [
      { id: "t1", goal: "Audit the licenses", status: "completed", assignee: "licenses", attempts: 1 },
      { id: "t2", goal: "Write the release notes", status: "pending", attempts: 0 },
    ];
    render(<TasksPanel seat={cos} sessionId="s1" readAt={1} />);
    await settle();
    expect(calls).toEqual(["list coordinator s1"]);
    expect(shown()).toEqual([
      { id: "t1", status: "completed", text: expect.stringContaining("Audit the licenses") },
      { id: "t2", status: "pending", text: expect.stringContaining("Write the release notes") },
    ]);
    expect(shown()[0]!.text).toContain("licenses");
    expect(shown()[1]!.text).toContain("unassigned");
  });

  it("says so when the conversation has filed nothing", async () => {
    render(<TasksPanel seat={cos} sessionId="s1" readAt={1} />);
    await settle();
    expect(screen.getByTestId("cos-tasks-empty")).toBeTruthy();
  });

  it("reads again when the Lab is read again, and only then", async () => {
    rows = [{ id: "t1", goal: "Audit the licenses", status: "in_progress", assignee: "licenses", attempts: 1 }];
    const view = render(<TasksPanel seat={cos} sessionId="s1" readAt={1} />);
    await settle();
    view.rerender(<TasksPanel seat={cos} sessionId="s1" readAt={1} />);
    await settle();
    expect(calls).toEqual(["list coordinator s1"]);
    rows = [{ id: "t1", goal: "Audit the licenses", status: "completed", assignee: "licenses", attempts: 1 }];
    view.rerender(<TasksPanel seat={cos} sessionId="s1" readAt={2} />);
    await settle();
    expect(calls).toEqual(["list coordinator s1", "list coordinator s1"]);
    expect(shown()).toEqual([{ id: "t1", status: "completed", text: expect.stringContaining("Audit the licenses") }]);
  });

  it("never shows one conversation's tasks under another, but keeps its own list while reading it again", async () => {
    rows = [{ id: "t1", goal: "Audit the licenses", status: "in_progress", assignee: "licenses", attempts: 1 }];
    const view = render(<TasksPanel seat={cos} sessionId="s1" readAt={1} />);
    await settle();
    // Same conversation, read again: its list stays up until the new answer lands.
    view.rerender(<TasksPanel seat={cos} sessionId="s1" readAt={2} />);
    expect(shown().map((task) => task.id)).toEqual(["t1"]);
    await settle();
    // Another conversation: the first one's tasks are gone before its read answers.
    rows = [{ id: "t2", goal: "Write the release notes", status: "pending", attempts: 0 }];
    view.rerender(<TasksPanel seat={cos} sessionId="s2" readAt={2} />);
    expect(shown()).toEqual([]);
    expect(screen.getByTestId("cos-tasks-reading")).toBeTruthy();
    await settle();
    expect(shown().map((task) => task.id)).toEqual(["t2"]);
  });

  it("shows why the read failed", async () => {
    refusal = "This conversation keeps no task board.";
    render(<TasksPanel seat={cos} sessionId="s1" readAt={1} />);
    await settle();
    expect(screen.getByTestId("cos-tasks-failure").textContent).toContain("This conversation keeps no task board.");
  });

  describe("a task that ends between the person's lines", () => {
    beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }));
    afterEach(() => vi.useRealTimers());
    const tick = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

    it("is read again while a task is open, and reloads the Lab when one ends, so the coordinator's turn on it shows", async () => {
      rows = [{ id: "t1", goal: "Audit the licenses", status: "in_progress", assignee: "licenses", attempts: 1 }];
      render(<TasksPanel seat={cos} sessionId="s1" readAt={1} />);
      await tick(0);
      expect(calls).toHaveLength(1);
      await tick(TASKS_POLL_MS);
      expect(calls).toHaveLength(2);
      expect(refreshes).toHaveLength(0);
      rows = [{ id: "t1", goal: "Audit the licenses", status: "completed", assignee: "licenses", attempts: 1 }];
      await tick(TASKS_POLL_MS);
      expect(shown()).toEqual([{ id: "t1", status: "completed", text: expect.stringContaining("Audit the licenses") }]);
      expect(refreshes).toHaveLength(1);
    });

    it("reads nothing more while no task is open and none just ended", async () => {
      rows = [{ id: "t1", goal: "Audit the licenses", status: "completed", assignee: "licenses", attempts: 1 }];
      render(<TasksPanel seat={cos} sessionId="s1" readAt={1} />);
      await tick(0);
      await tick(TASKS_POLL_MS * 20);
      expect(calls).toEqual(["list coordinator s1"]);
      expect(refreshes).toHaveLength(0);
    });
  });
});
