// @vitest-environment happy-dom
/**
 * TASKS, at Shift Coordinator (FIX-1794 S11): the tasks the user's
 * conversation filed, read through the conversation's own `listTasks` read.
 *
 * What it lists is what that read answered: the conversation's own board, never
 * a store or a Lab-wide walk. It reads again each time the Lab is read again,
 * which is after each turn the user sends (the reload floor), and on no
 * tool's name.
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TASKS_POLL_MS, TasksPanel } from "../src/components/TasksPanel";
import { toWorker } from "../src/lib/reads";

type Row = { id: string; goal: string; title?: string; status: string; assignee?: string; attempts: number };
let rows: Row[] = [];
let refusal: string | null = null;
const calls: string[] = [];

const refreshes: number[] = [];
vi.mock("../src/lib/lab-data", () => {
  const lab = { client: { userId: "alice" }, refresh: async () => void refreshes.push(Date.now()) };
  return { useLab: () => lab };
});
vi.mock("../src/lib/conversation-tasks", () => ({
  readConversationTasks: async (_c: unknown, flow: string, sessionId: string) => {
    calls.push(`list ${flow} ${sessionId}`);
    if (refusal !== null) throw new Error(refusal);
    return [...rows];
  },
}));

const shiftCoordinator = toWorker({ id: "shift-coordinator", kind: "coordinator", door: "run" })!;

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
  screen.queryAllByTestId("shift-coordinator-task").map((li) => ({
    id: li.getAttribute("data-task-id"),
    status: li.getAttribute("data-status"),
    text: li.textContent,
  }));

describe("the tasks panel (S11)", () => {
  it("says tasks belong to a conversation before there is one, and reads nothing", async () => {
    render(<TasksPanel worker={shiftCoordinator} sessionId={null} readAt={1} />);
    await settle();
    expect(screen.getByTestId("shift-coordinator-tasks-none")).toBeTruthy();
    expect(calls).toEqual([]);
  });

  it("lists what the conversation's own read answers: each task's goal, status and delegate", async () => {
    rows = [
      { id: "t1", goal: "Audit the licenses", status: "completed", assignee: "licenses", attempts: 1 },
      { id: "t2", goal: "Write the release notes", status: "pending", attempts: 0 },
    ];
    render(<TasksPanel worker={shiftCoordinator} sessionId="s1" readAt={1} />);
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
    render(<TasksPanel worker={shiftCoordinator} sessionId="s1" readAt={1} />);
    await settle();
    expect(screen.getByTestId("shift-coordinator-tasks-empty")).toBeTruthy();
  });

  it("reads again when the Lab is read again, and only then", async () => {
    rows = [{ id: "t1", goal: "Audit the licenses", status: "in_progress", assignee: "licenses", attempts: 1 }];
    const view = render(<TasksPanel worker={shiftCoordinator} sessionId="s1" readAt={1} />);
    await settle();
    view.rerender(<TasksPanel worker={shiftCoordinator} sessionId="s1" readAt={1} />);
    await settle();
    expect(calls).toEqual(["list coordinator s1"]);
    rows = [{ id: "t1", goal: "Audit the licenses", status: "completed", assignee: "licenses", attempts: 1 }];
    view.rerender(<TasksPanel worker={shiftCoordinator} sessionId="s1" readAt={2} />);
    await settle();
    expect(calls).toEqual(["list coordinator s1", "list coordinator s1"]);
    expect(shown()).toEqual([{ id: "t1", status: "completed", text: expect.stringContaining("Audit the licenses") }]);
  });

  it("never shows one conversation's tasks under another, but keeps its own list while reading it again", async () => {
    rows = [{ id: "t1", goal: "Audit the licenses", status: "in_progress", assignee: "licenses", attempts: 1 }];
    const view = render(<TasksPanel worker={shiftCoordinator} sessionId="s1" readAt={1} />);
    await settle();
    // Same conversation, read again: its list stays up until the new answer lands.
    view.rerender(<TasksPanel worker={shiftCoordinator} sessionId="s1" readAt={2} />);
    expect(shown().map((task) => task.id)).toEqual(["t1"]);
    await settle();
    // Another conversation: the first one's tasks are gone before its read answers.
    rows = [{ id: "t2", goal: "Write the release notes", status: "pending", attempts: 0 }];
    view.rerender(<TasksPanel worker={shiftCoordinator} sessionId="s2" readAt={2} />);
    expect(shown()).toEqual([]);
    expect(screen.getByTestId("shift-coordinator-tasks-reading")).toBeTruthy();
    await settle();
    expect(shown().map((task) => task.id)).toEqual(["t2"]);
  });

  it("shows why the read failed", async () => {
    refusal = "This conversation keeps no task board.";
    render(<TasksPanel worker={shiftCoordinator} sessionId="s1" readAt={1} />);
    await settle();
    expect(screen.getByTestId("shift-coordinator-tasks-failure").textContent).toContain("This conversation keeps no task board.");
  });

  describe("at the Shift Coordinator, whose conversation never ends (activeOnly)", () => {
    const mixed: Row[] = [
      { id: "t1", goal: "Audit the licenses", status: "completed", assignee: "licenses", attempts: 1 },
      { id: "t2", goal: "Write the release notes", status: "in_progress", assignee: "notes", attempts: 1 },
      { id: "t3", goal: "Rotate the keys", status: "errored", assignee: "keys", attempts: 2 },
      { id: "t4", goal: "Drop the old flag", status: "cancelled", attempts: 0 },
      { id: "t5", goal: "Draft the launch post", status: "pending", attempts: 0 },
      { id: "t6", goal: "Check the docs links", status: "completed", assignee: "docs", attempts: 1 },
    ];
    const group = (name: string) => screen.getAllByTestId("shift-coordinator-task-group").find((el) => el.getAttribute("data-group") === name);

    it("lists only the active tasks, and folds done and errored into counts that open", async () => {
      rows = mixed;
      render(<TasksPanel worker={shiftCoordinator} sessionId="s1" readAt={1} activeOnly />);
      await settle();
      expect(shown().map((task) => task.id)).toEqual(["t2", "t5"]);
      expect(group("done")!.textContent).toContain("3 done");
      expect(group("errored")!.textContent).toContain("1 errored");
      act(() => group("errored")!.querySelector("button")!.click());
      expect(shown().map((task) => task.id)).toEqual(["t2", "t5", "t3"]);
      act(() => group("done")!.querySelector("button")!.click());
      expect(shown().map((task) => task.id)).toEqual(["t2", "t5", "t1", "t4", "t6", "t3"]);
    });

    it("says no task is active when every task has ended, and draws no empty group", async () => {
      rows = [{ id: "t1", goal: "Audit the licenses", status: "completed", assignee: "licenses", attempts: 1 }];
      render(<TasksPanel worker={shiftCoordinator} sessionId="s1" readAt={1} activeOnly />);
      await settle();
      expect(screen.getByTestId("shift-coordinator-tasks-none-active")).toBeTruthy();
      expect(shown()).toEqual([]);
      expect(screen.getAllByTestId("shift-coordinator-task-group").map((el) => el.getAttribute("data-group"))).toEqual(["done"]);
    });

    it("leaves a workstream's board whole: there every task is a subtask of the one piece of work", async () => {
      rows = mixed;
      render(<TasksPanel worker={shiftCoordinator} sessionId="s1" readAt={1} />);
      await settle();
      expect(shown().map((task) => task.id)).toEqual(["t1", "t2", "t3", "t4", "t5", "t6"]);
      expect(screen.queryAllByTestId("shift-coordinator-task-group")).toEqual([]);
    });
  });

  describe("a task that ends between the user's lines", () => {
    beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }));
    afterEach(() => vi.useRealTimers());
    const tick = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

    it("is read again while a task is open, and reloads the Lab when one ends, so the coordinator's turn on it shows", async () => {
      rows = [{ id: "t1", goal: "Audit the licenses", status: "in_progress", assignee: "licenses", attempts: 1 }];
      render(<TasksPanel worker={shiftCoordinator} sessionId="s1" readAt={1} />);
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
      render(<TasksPanel worker={shiftCoordinator} sessionId="s1" readAt={1} />);
      await tick(0);
      await tick(TASKS_POLL_MS * 20);
      expect(calls).toEqual(["list coordinator s1"]);
      expect(refreshes).toHaveLength(0);
    });
  });
});

describe("opening a task from the panel", () => {
  it("each task opens its own session on the conversation's board", async () => {
    rows = [{ id: "t1", goal: "Audit the licenses", status: "in_progress", assignee: "licenses", attempts: 1 }];
    window.history.pushState(null, "", "/");
    render(<TasksPanel worker={shiftCoordinator} sessionId="s1" readAt={1} />);
    await settle();
    await act(async () => screen.getByTestId("shift-coordinator-task-open").click());
    // The route is the same one the Tasks list and Jump to go to.
    expect(window.location.pathname).toBe("/tasks/s1.tasks/t1/session");
  });

  it("opens a failed task from its errored group, so a failure is one click from its session", async () => {
    rows = [{ id: "t3", goal: "Rotate the keys", status: "errored", assignee: "keys", attempts: 2 }];
    window.history.pushState(null, "", "/");
    render(<TasksPanel worker={shiftCoordinator} sessionId="s1" readAt={1} activeOnly />);
    await settle();
    act(() => screen.getByTestId("shift-coordinator-task-group").querySelector("button")!.click());
    await act(async () => screen.getByTestId("shift-coordinator-task-open").click());
    expect(window.location.pathname).toBe("/tasks/s1.tasks/t3/session");
  });
});

describe("a task's label in the panel", () => {
  it("is its title when it has one, and its goal when it has none", async () => {
    rows = [
      { id: "t1", goal: "Take a quick look at the flow state code in the repository and report back", title: "Look at flow state", status: "in_progress", attempts: 1 },
      { id: "t2", goal: "Write the release notes", status: "pending", attempts: 0 },
    ];
    render(<TasksPanel worker={shiftCoordinator} sessionId="s1" readAt={1} />);
    await settle();
    const text = shown().map((t) => t.text);
    expect(text[0]).toContain("Look at flow state");
    expect(text[0]).not.toContain("Take a quick look");
    expect(text[1]).toContain("Write the release notes");
  });
});
