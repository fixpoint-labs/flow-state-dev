// @vitest-environment happy-dom
/**
 * The task Session on the run session's feed (FIX-2374), with the reads stood
 * in for. Two things the feed's window changes, pinned here:
 *
 * - The feed opens on the session's newest items. A task claimed before that
 *   window still shows its newest steps: attribution learns the board's tasks
 *   from its `task-change` claims, read on their own.
 * - Items come from the page's one feed for the run session; the run's status
 *   is the task's (`TaskProvider`, on the run's own stream), not the Session's.
 */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const lab = { client: { userId: "u_1" }, snapshot: undefined, refresh: vi.fn() };
vi.mock("../src/lib/lab-data", () => ({ useLab: () => lab }));

// FIX-2774: a task's asks read the inbox view, which this test doesn't serve.
vi.mock("../src/lib/inbox", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/inbox")>()),
  useInbox: () => ({ section: undefined, stale: false, refresh: () => {} }),
}));

const run = { flowId: "agent", sessionId: "s_run", requestId: "req_run" };
const task = {
  row: undefined,
  run: { kind: "open", run },
  waiting: false,
  gaveUp: false,
  retryRow: vi.fn(),
  retryRun: vi.fn(),
  sent: [] as string[],
  boardRef: "conv_1",
  taskId: "t1",
};
vi.mock("../src/lib/task", () => ({ useTask: () => task }));

type Follower = import("./helpers/fake-feed").FakeFeed;
const { feeds } = vi.hoisted(() => ({ feeds: [] as Follower[] }));
const readTaskClaims = vi.fn();
vi.mock("../src/lib/session-feeds", async () => (await import("./helpers/fake-feed")).fakeFeeds(feeds));
vi.mock("../src/lib/task-items", async (original) => ({
  ...(await original<typeof import("../src/lib/task-items")>()),
  readTaskClaims: (...args: unknown[]) => readTaskClaims(...args),
}));

import { RECEIVED_MESSAGE_DATA_TYPE, taskBriefMetadata } from "@flow-state-dev/workforce/browser";
import { collectionOfBoard } from "../src/lib/reads";
import { TaskSession } from "../src/surfaces/TaskSession";

const step = (n: number) => ({
  id: `m${n}`,
  type: "message",
  role: "assistant",
  status: "completed",
  requestId: "req_run",
  itemIndex: n,
  ts: 100 + n,
  taskId: "t1",
  content: [{ type: "output_text", text: `step ${n}` }],
});
const claim = {
  id: "tc1",
  type: "data",
  dataType: "task-change",
  status: "completed",
  requestId: "req_board",
  itemIndex: 0,
  ts: 1,
  value: { collectionId: collectionOfBoard("conv_1"), taskId: "t1", kind: "claimed" },
};

beforeEach(() => {
  feeds.length = 0;
  readTaskClaims.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("a task Session that opens on the newest items", () => {
  it("shows the task's newest steps when its claim is older than the window, without a Load earlier press", async () => {
    readTaskClaims.mockResolvedValue([claim]);
    render(<TaskSession />);
    // The window: the newest steps only, with older items before it.
    await act(async () => feeds.at(-1)!.onRead({ items: [step(1), step(2)], truncated: true, loadEarlier: vi.fn() }));

    expect(readTaskClaims).toHaveBeenCalledWith(lab.client, "s_run", collectionOfBoard("conv_1"));
    const ids = screen.getAllByTestId("session-item").map((el) => el.getAttribute("data-item-id"));
    // The claim teaches the attribution; it is never drawn itself.
    expect(ids).toEqual(["m1", "m2"]);
  });

  it("keeps a failed claims read on screen through later feed updates, and Retry reads the claims again", async () => {
    readTaskClaims.mockRejectedValueOnce(new Error("the store is down")).mockResolvedValue([claim]);
    render(<TaskSession />);
    await act(async () => feeds.at(-1)!.onRead({ items: [step(1)], truncated: true, loadEarlier: vi.fn() }));
    expect(screen.getByTestId("session-failure").textContent).toContain("the store is down");
    // A new step on the stream: the claims are still missing, so the failure stays.
    await act(async () => feeds.at(-1)!.onRead({ items: [step(1), step(2)], truncated: true, loadEarlier: vi.fn() }));
    expect(screen.getByTestId("session-failure")).toBeTruthy();

    fireEvent.click(within(screen.getByTestId("session-failure")).getByRole("button"));
    await act(async () => feeds.at(-1)!.onRead({ items: [step(1), step(2)], truncated: true, loadEarlier: vi.fn() }));
    expect(screen.getAllByTestId("session-item").map((el) => el.getAttribute("data-item-id"))).toEqual(["m1", "m2"]);
  });

  it("reads no claims when the whole session is in view: its claims are already there", async () => {
    render(<TaskSession />);
    await act(async () => feeds.at(-1)!.onRead({ items: [claim, step(1)], truncated: false }));
    expect(readTaskClaims).not.toHaveBeenCalled();
    expect(screen.getAllByTestId("session-item").map((el) => el.getAttribute("data-item-id"))).toEqual(["m1"]);
  });
});

describe("the task's brief", () => {
  const brief = {
    id: "b1",
    type: "message",
    role: "user",
    status: "completed",
    requestId: "req_run",
    itemIndex: 0,
    ts: 100,
    taskId: "t1",
    metadata: taskBriefMetadata({ taskId: "t1" }),
    content: [{ type: "output_text", text: "Since this task was filed, fix the flaky test." }],
  };
  const typed = { ...brief, id: "u1", itemIndex: 3, metadata: undefined, content: [{ type: "output_text", text: "Keep the old flag name." }] };

  it("is one folded Task brief line, not a line the user typed, and opens to the brief", async () => {
    render(<TaskSession />);
    await act(async () => feeds.at(-1)!.onRead({ items: [claim, brief, step(1), typed], truncated: false }));

    const [briefRow, , typedRow] = screen.getAllByTestId("session-item");
    // The brief is what the session was handed: no user bubble, and not marked as the user's line.
    expect(within(briefRow!).queryByTestId("message")).toBeNull();
    expect(briefRow!.hasAttribute("data-sent-line")).toBe(false);
    const line = briefRow!.querySelector<HTMLElement>("[data-line=brief]")!;
    expect(line.textContent).toContain("Task brief");
    expect(line.textContent).not.toContain("fix the flaky test");
    fireEvent.click(within(line).getByRole("button"));
    expect(line.textContent).toContain("fix the flaky test");

    // Words the user typed still read as theirs, and are still the user's line for jump-to-latest.
    expect(within(typedRow!).getByTestId("message").getAttribute("data-message-role")).toBe("user");
    expect(typedRow!.getAttribute("data-sent-line")).toBe("u1");
  });
});

describe("another worker's lines in a task's run", () => {
  it("names the sender as the conversation does: the Shift Coordinator by its label, not its id", async () => {
    const received = {
      id: "r1",
      type: "data",
      dataType: RECEIVED_MESSAGE_DATA_TYPE,
      status: "completed",
      requestId: "req_run",
      itemIndex: 1,
      ts: 101,
      taskId: "t1",
      value: { id: "msg_1", from: "ops.shift-coordinator", text: "which branch?" },
    };
    render(<TaskSession />);
    await act(async () => feeds.at(-1)!.onRead({ items: [claim, received], truncated: false }));

    const line = document.querySelector<HTMLElement>("[data-line=received]")!;
    expect(line.textContent).toContain("Shift Coordinator");
    expect(line.textContent).not.toContain("ops.shift-coordinator");
  });
});

// A run someone stopped says so after its last line, as a conversation does; the board runs it again, so no Retry.
describe("a stopped run", () => {
  it("draws its stopped line after its last step, with no Retry", async () => {
    const stopped = Object.assign(task, { status: "aborted" });
    try {
      render(<TaskSession />);
      await act(async () => feeds.at(-1)!.onRead({ items: [claim, step(1)], truncated: false }));
      const items = screen.getAllByTestId("session-item");
      expect(items.at(-1)!.querySelector("[data-line=stopped]")).not.toBeNull();
      expect(screen.queryByRole("button", { name: /Retry/ })).toBeNull();
    } finally {
      delete (stopped as { status?: string }).status;
    }
  });
});

// A failed run's turn is the board's to run again: its failed line offers Retry while the task
// stands failed on the board, and Retry sends the task back to run, as the task's own Retry does.
describe("a failed run", () => {
  const failed = { id: "e1", type: "error", status: "completed", requestId: "req_run", itemIndex: 2, ts: 102, taskId: "t1", message: "the harness crashed", code: "HARNESS" };

  it("draws the shared failed line with Retry while its task stands failed, and Retry runs the task again on its board", async () => {
    const retry = vi.fn(async () => undefined);
    const held = Object.assign(task, { status: "failed", row: { id: "t1", status: "errored" }, board: { retry } });
    try {
      render(<TaskSession />);
      await act(async () => feeds.at(-1)!.onRead({ items: [claim, step(1), failed], truncated: false }));
      const line = document.querySelector<HTMLElement>("[data-line=failed]")!;
      expect(line.textContent).toContain("the harness crashed");
      await act(async () => fireEvent.click(within(line).getByRole("button", { name: /Retry/ })));
      expect(retry).toHaveBeenCalledWith("t1");
      // The board is read again, so the screen follows its new status.
      expect(task.retryRow).toHaveBeenCalled();
    } finally {
      delete (held as { status?: string }).status;
      delete (held as { board?: unknown }).board;
      Object.assign(held, { row: undefined });
    }
  });

  it("offers no Retry while the board still runs the task again on its own", async () => {
    const held = Object.assign(task, { status: "failed", row: { id: "t1", status: "pending" }, board: { retry: vi.fn() } });
    try {
      render(<TaskSession />);
      await act(async () => feeds.at(-1)!.onRead({ items: [claim, step(1), failed], truncated: false }));
      expect(document.querySelector("[data-line=failed]")).not.toBeNull();
      expect(screen.queryByRole("button", { name: /Retry/ })).toBeNull();
    } finally {
      delete (held as { status?: string }).status;
      delete (held as { board?: unknown }).board;
      Object.assign(held, { row: undefined });
    }
  });
});
