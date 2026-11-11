// @vitest-environment happy-dom
// FIX-1794 S11; FIX-2623.
/**
 * TASKS, at Shift Coordinator: the tasks the user's conversation filed,
 * watched through the conversation's own task-list view.
 *
 * What it lists is what that view answered: the conversation's own board,
 * never a store or a Lab-wide walk. It listens on the topics the view's
 * answer names and none of its own, reads on the view's own timer where push
 * can miss a change, and knows no tool's name.
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SubscribeOptions, WireNotice, WireTopic } from "@flow-state-dev/client";
import { TasksPanel } from "../src/components/TasksPanel";

/** The view's own timer where push can miss a change: `useView`'s default. */
const VIEW_POLL_MS = 3_000;
import { toWorker } from "../src/lib/reads";

type StoredTask = { id: string; goal: string; title?: string; status: string; assignee?: string; attempts: number };
let rows: StoredTask[] = [];
let refusal: string | null = null;
const calls: string[] = [];

const refreshes: number[] = [];
const { subscriptions, board } = vi.hoisted(() => ({
  subscriptions: [] as Array<{ topics: readonly WireTopic[]; options: SubscribeOptions; closed: boolean }>,
  /** What the faked view answers; set below. */
  board: { view: (async () => undefined) as (ref: { flow: string; view: string }, input: unknown, options?: { sessionId?: string }) => Promise<unknown> },
}));
vi.mock("../src/lib/lab-data", () => {
  // The Lab's one client, its `view` and `subscribe` faked so a case answers the view and delivers the notices.
  const subscribe = (topics: readonly WireTopic[], options: SubscribeOptions) => {
    const entry = { topics, options, closed: false };
    subscriptions.push(entry);
    return { close: () => void (entry.closed = true) };
  };
  const view = (ref: { flow: string; view: string }, input: unknown, options?: { sessionId?: string }) => board.view(ref, input, options);
  const lab = { client: { userId: "alice", subscribe, view }, refresh: async () => void refreshes.push(Date.now()) };
  return { useLab: () => lab };
});

/** The topics the faked view's answer names: the conversation's session and the user, as the board's list reaches them. */
const answerTopics = (sessionId: string): WireTopic[] => [{ scope: "session", id: sessionId }, { scope: "user" }];

/** The panel's open subscription. */
function open() {
  const live = subscriptions.filter((s) => !s.closed);
  if (live.length === 0) throw new Error("no open subscription");
  return live[live.length - 1]!;
}

/** Hand the open subscription a notice, or `null` for a connect, reconnect or tick. */
async function hear(notice: WireNotice | null) {
  await act(async () => {
    open().options.onChange(notice);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
board.view = async (ref, _input, options) => {
  calls.push(`${ref.view} ${ref.flow} ${options?.sessionId}`);
  if (refusal !== null) throw new Error(refusal);
  const listed = [...rows];
  const answer = { value: listed, topics: answerTopics(options!.sessionId!), keys: listed.map((task) => task.id) };
  // A case holding reads open answers each when it releases it.
  if (holdReads) return new Promise((resolve) => held.push(() => resolve(answer)));
  return answer;
};
/** What one mount reads: once, and once more when it listens on the topics the answer named. */
const MOUNT = ["listTasks_tasks coordinator s1", "listTasks_tasks coordinator s1"];

let holdReads = false;
const held: Array<() => void> = [];

const shiftCoordinator = toWorker({ id: "shift-coordinator", kind: "coordinator", door: "run" })!;

beforeEach(() => {
  holdReads = false;
  held.length = 0;
  rows = [];
  refusal = null;
  calls.length = 0;
  refreshes.length = 0;
  subscriptions.length = 0;
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
    render(<TasksPanel worker={shiftCoordinator} sessionId={null} />);
    await settle();
    expect(screen.getByTestId("shift-coordinator-tasks-none")).toBeTruthy();
    expect(calls).toEqual([]);
  });

  it("lists what the conversation's own read answers: each task's goal, status and delegate", async () => {
    rows = [
      { id: "t1", goal: "Audit the licenses", status: "completed", assignee: "licenses", attempts: 1 },
      { id: "t2", goal: "Write the release notes", status: "pending", attempts: 0 },
    ];
    render(<TasksPanel worker={shiftCoordinator} sessionId="s1" />);
    await settle();
    expect(calls).toEqual(MOUNT);
    expect(shown()).toEqual([
      { id: "t1", status: "completed", text: expect.stringContaining("Audit the licenses") },
      { id: "t2", status: "pending", text: expect.stringContaining("Write the release notes") },
    ]);
    expect(shown()[0]!.text).toContain("licenses");
    expect(shown()[1]!.text).toContain("unassigned");
  });

  it("says so when the conversation has filed nothing", async () => {
    render(<TasksPanel worker={shiftCoordinator} sessionId="s1" />);
    await settle();
    expect(screen.getByTestId("shift-coordinator-tasks-empty")).toBeTruthy();
  });

  it("reads once more after it listens on the answer's topics, and not again on a rerender", async () => {
    rows = [{ id: "t1", goal: "Audit the licenses", status: "completed", assignee: "licenses", attempts: 1 }];
    const view = render(<TasksPanel worker={shiftCoordinator} sessionId="s1" />);
    await settle();
    view.rerender(<TasksPanel worker={shiftCoordinator} sessionId="s1" />);
    await settle();
    expect(calls).toEqual(MOUNT);
  });

  it("never shows one conversation's tasks under another, but keeps its own list while reading it again", async () => {
    rows = [{ id: "t1", goal: "Audit the licenses", status: "in_progress", assignee: "licenses", attempts: 1 }];
    const view = render(<TasksPanel worker={shiftCoordinator} sessionId="s1" />);
    await settle();
    // Same conversation, drawn again: its list stays up.
    view.rerender(<TasksPanel worker={shiftCoordinator} sessionId="s1" />);
    expect(shown().map((task) => task.id)).toEqual(["t1"]);
    await settle();
    // Another conversation: the first one's tasks are gone before its read answers.
    rows = [{ id: "t2", goal: "Write the release notes", status: "pending", attempts: 0 }];
    view.rerender(<TasksPanel worker={shiftCoordinator} sessionId="s2" />);
    expect(shown()).toEqual([]);
    expect(screen.getByTestId("shift-coordinator-tasks-reading")).toBeTruthy();
    await settle();
    expect(shown().map((task) => task.id)).toEqual(["t2"]);
  });

  it("says the tasks didn't load when the view fails", async () => {
    refusal = "This conversation keeps no task board.";
    render(<TasksPanel worker={shiftCoordinator} sessionId="s1" />);
    await settle();
    expect(screen.getByTestId("shift-coordinator-tasks-failure").textContent).toContain("didn't load");
  });

  describe("at the Shift Coordinator, whose conversation never ends (activeOnly)", () => {
    const mixed: StoredTask[] = [
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
      render(<TasksPanel worker={shiftCoordinator} sessionId="s1" activeOnly />);
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
      render(<TasksPanel worker={shiftCoordinator} sessionId="s1" activeOnly />);
      await settle();
      expect(screen.getByTestId("shift-coordinator-tasks-none-active")).toBeTruthy();
      expect(shown()).toEqual([]);
      expect(screen.getAllByTestId("shift-coordinator-task-group").map((el) => el.getAttribute("data-group"))).toEqual(["done"]);
    });

    it("leaves a workstream's board whole: there every task is a subtask of the one piece of work", async () => {
      rows = mixed;
      render(<TasksPanel worker={shiftCoordinator} sessionId="s1" />);
      await settle();
      expect(shown().map((task) => task.id)).toEqual(["t1", "t2", "t3", "t4", "t5", "t6"]);
      expect(screen.queryAllByTestId("shift-coordinator-task-group")).toEqual([]);
    });
  });

  describe("a task that ends between the user's lines (board notices, FIX-2429)", () => {
    it("names no topic: it listens, through the Lab's client, on the topics the view's answer named", async () => {
      render(<TasksPanel worker={shiftCoordinator} sessionId="s1" />);
      await settle();
      expect(open().topics).toEqual(answerTopics("s1"));
    });

    it("reads again on a board notice, and leaves reloading the Lab to the snapshot's own subscription when a task moved", async () => {
      rows = [{ id: "t1", goal: "Audit the licenses", status: "in_progress", assignee: "licenses", attempts: 1 }];
      render(<TasksPanel worker={shiftCoordinator} sessionId="s1" />);
      await settle();
      expect(calls).toEqual(MOUNT);
      rows = [{ id: "t1", goal: "Audit the licenses", status: "completed", assignee: "licenses", attempts: 1 }];
      await hear({ topic: { scope: "session", id: "s1", resource: "tasks" }, kind: "board" });
      expect(calls).toHaveLength(MOUNT.length + 1);
      expect(shown()).toEqual([{ id: "t1", status: "completed", text: expect.stringContaining("Audit the licenses") }]);
      // The snapshot hears the same move itself (FIX-2409): a second read here would be a second way.
      expect(refreshes).toHaveLength(0);
    });

    it("reads on the view's own timer where push can miss a change, and still hears every notice", async () => {
      rows = [{ id: "t1", goal: "Audit the licenses", status: "completed", assignee: "licenses", attempts: 1 }];
      render(<TasksPanel worker={shiftCoordinator} sessionId="s1" />);
      await settle();
      expect(open().options.pollIntervalMs).toBe(VIEW_POLL_MS);
      expect(calls).toEqual(MOUNT);
      rows = [...rows, { id: "t2", goal: "Write the release notes", status: "pending", attempts: 0 }];
      await hear({ topic: { scope: "session", id: "s1", resource: "tasks" }, kind: "board" });
      expect(shown().map((task) => task.id)).toEqual(["t1", "t2"]);
    });

    it("reloads nothing when it unmounts with a read still in flight", async () => {
      rows = [{ id: "t1", goal: "Audit the licenses", status: "in_progress", assignee: "licenses", attempts: 1 }];
      const view = render(<TasksPanel worker={shiftCoordinator} sessionId="s1" />);
      await settle();
      // A notice's read is in flight, and would show the task moved.
      holdReads = true;
      rows = [{ id: "t1", goal: "Audit the licenses", status: "completed", assignee: "licenses", attempts: 1 }];
      await hear({ topic: { scope: "session", id: "s1", resource: "tasks" }, kind: "board" });
      expect(held.length).toBeGreaterThan(0);
      view.unmount();
      await act(async () => {
        held.forEach((release) => release());
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(refreshes).toHaveLength(0);
    });
  });
});

describe("opening a task from the panel", () => {
  it("each task opens its own session on the conversation's board", async () => {
    rows = [{ id: "t1", goal: "Audit the licenses", status: "in_progress", assignee: "licenses", attempts: 1 }];
    window.history.pushState(null, "", "/");
    render(<TasksPanel worker={shiftCoordinator} sessionId="s1" />);
    await settle();
    await act(async () => screen.getByTestId("shift-coordinator-task-open").click());
    // The route is the same one the Tasks list and Jump to go to.
    expect(window.location.pathname).toBe("/tasks/s1.tasks/t1/session");
  });

  it("opens a failed task from its errored group, so a failure is one click from its session", async () => {
    rows = [{ id: "t3", goal: "Rotate the keys", status: "errored", assignee: "keys", attempts: 2 }];
    window.history.pushState(null, "", "/");
    render(<TasksPanel worker={shiftCoordinator} sessionId="s1" activeOnly />);
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
    render(<TasksPanel worker={shiftCoordinator} sessionId="s1" />);
    await settle();
    const text = shown().map((t) => t.text);
    expect(text[0]).toContain("Look at flow state");
    expect(text[0]).not.toContain("Take a quick look");
    expect(text[1]).toContain("Write the release notes");
  });
});
