// @vitest-environment happy-dom
/**
 * The task Session on the run session's feed (FIX-2374), with the reads stood
 * in for. Two things the feed's window changes, pinned here:
 *
 * - The feed opens on the session's newest items. A task claimed before that
 *   window still shows its newest steps: attribution learns the board's tasks
 *   from its `task-change` claims, read on their own.
 * - Items come from the feed, so the run's request stream carries only its
 *   status. That stream doesn't reconnect; when it drops while the run is still
 *   going, the Session follows the run again, so its status can still settle.
 */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const lab = { client: { userId: "u_1" }, snapshot: undefined, refresh: vi.fn() };
vi.mock("../src/lib/lab-data", () => ({ useLab: () => lab }));

const reportStatus = vi.fn();
const run = { flowId: "agent", sessionId: "s_run", requestId: "req_run" };
const task = {
  row: undefined,
  run: { kind: "open", run },
  waiting: false,
  gaveUp: false,
  retryRow: vi.fn(),
  retryRun: vi.fn(),
  reportStatus,
  sent: [] as string[],
  unstamped: [] as string[],
  boardRef: "conv_1",
  taskId: "t1",
};
vi.mock("../src/lib/task", () => ({ useTask: () => task }));

type Follower = { onRead(read: unknown): void; onFailure(failure: unknown): void };
type RequestFollower = { onItem(item: unknown): void; onStatus(status: string): void; onError(failure: unknown): void };
const feeds: Follower[] = [];
const requests: RequestFollower[] = [];
const readTaskClaims = vi.fn();
const readRunRecord = vi.fn();
vi.mock("../src/lib/run", async (original) => ({
  ...(await original<typeof import("../src/lib/run")>()),
  followSessionItems: (_client: unknown, _sessionId: string, to: Follower) => {
    feeds.push(to);
    return () => {};
  },
  followRequest: (_client: unknown, _run: unknown, to: RequestFollower) => {
    requests.push(to);
    return { close: () => {} };
  },
  readTaskClaims: (...args: unknown[]) => readTaskClaims(...args),
  readRunRecord: (...args: unknown[]) => readRunRecord(...args),
}));

import { taskBriefMetadata } from "@flow-state-dev/workforce/browser";
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
  type: "component",
  component: "task-change",
  status: "completed",
  requestId: "req_board",
  itemIndex: 0,
  ts: 1,
  data: { collectionId: collectionOfBoard("conv_1"), taskId: "t1", kind: "claimed" },
};

beforeEach(() => {
  feeds.length = 0;
  requests.length = 0;
  readTaskClaims.mockReset();
  readRunRecord.mockReset();
  reportStatus.mockReset();
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

describe("the run's status after its stream drops", () => {
  it("follows a run still going again, so its end still reaches the screen", async () => {
    vi.useFakeTimers();
    readRunRecord.mockResolvedValue({ status: "in_progress" });
    render(<TaskSession />);
    await act(async () => feeds.at(-1)!.onRead({ items: [claim, step(1)], truncated: false }));
    expect(requests).toHaveLength(1);

    await act(async () => requests[0]!.onError({ message: "the stream dropped" }));
    expect(reportStatus).toHaveBeenCalledWith("in_progress", undefined);
    await act(async () => vi.advanceTimersByTimeAsync(3_000));
    expect(requests).toHaveLength(2);

    await act(async () => requests[1]!.onStatus("completed"));
    expect(reportStatus).toHaveBeenLastCalledWith("completed");
    // The items stayed through the drop.
    expect(screen.getAllByTestId("session-item")).toHaveLength(1);
  });

  it("doesn't follow a run that the record says has ended", async () => {
    vi.useFakeTimers();
    readRunRecord.mockResolvedValue({ status: "completed", endedAtMs: 500 });
    render(<TaskSession />);
    await act(async () => feeds.at(-1)!.onRead({ items: [claim, step(1)], truncated: false }));
    await act(async () => requests[0]!.onError({ message: "the stream dropped" }));
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(reportStatus).toHaveBeenCalledWith("completed", 500);
    expect(requests).toHaveLength(1);
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
    const line = within(briefRow!).getByTestId("task-brief");
    expect(line.textContent).toContain("Task brief");
    expect(line.textContent).not.toContain("fix the flaky test");
    fireEvent.click(within(line).getByRole("button"));
    expect(line.textContent).toContain("fix the flaky test");

    // Words the user typed still read as theirs.
    expect(within(typedRow!).getByTestId("message").getAttribute("data-message-role")).toBe("user");
  });
});
