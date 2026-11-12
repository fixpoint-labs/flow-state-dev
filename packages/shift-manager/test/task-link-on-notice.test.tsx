// @vitest-environment happy-dom
/**
 * A task screen waiting on its row's run link reads the board on a board
 * notice, not every 2 s: the run writes its link to the row, and that write
 * publishes a `board` notice on the filing conversation's topic, narrowed to
 * its board (`tasks`). While push covers the page nothing else reads; where
 * push can miss a change, the subscription keeps the old 2 s pace. The wait
 * ends once the link lands, and a failed read ends it and shows the failure,
 * with Retry.
 *
 * The client's own live read rides a subscription the test drives; its
 * connect is the subscription's first `onChange(null)`, as the push hub's is.
 */
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WireNotice, WireTopic } from "@flow-state-dev/client";
import { liveRead } from "@flow-state-dev/client/internal";
import type { LoadedSnapshot } from "../src/lib/derive";
import type { BoardTaskView } from "../src/lib/reads";

type Opened = { topics: readonly WireTopic[]; pollIntervalMs?: number; onChange: (notice: WireNotice | null) => void; closed: boolean };
const opened: Opened[] = [];
const subscribe = (topics: readonly WireTopic[], options: { onChange: (notice: WireNotice | null) => void; pollIntervalMs?: number }) => {
  const entry: Opened = { topics, pollIntervalMs: options.pollIntervalMs, onChange: options.onChange, closed: false };
  opened.push(entry);
  // The socket's connect.
  queueMicrotask(() => {
    if (!entry.closed) entry.onChange(null);
  });
  return { close: () => void (entry.closed = true) };
};
const open = () => opened.filter((o) => !o.closed);
const hear = (notice: WireNotice) => open().forEach((o) => o.onChange(notice));

const CONVERSATION = "conv_1";
const BOARD = `${CONVERSATION}.tasks`;
const boardTask = (run: BoardTaskView["run"]) => ({ boardRef: BOARD, ownerSessionId: CONVERSATION, id: "t1", title: "Fix it", status: "in_progress", run }) as BoardTaskView;
const LINK = { sessionId: "s_run", requestId: "req_run", attempt: 1 };

let board: BoardTaskView[] = [];
let failBoard = false;
let boardReads = 0;
const reader = {
  readBoard: async () => {
    boardReads += 1;
    if (failBoard) throw new Error("board offline");
    return board;
  },
};
const client = {
  userId: "u_1",
  // The run's flow and record, once a link names one: never answered here, so the screen stays on the row.
  sessions: { get: () => new Promise(() => {}) },
  live: (topics: readonly WireTopic[], options: Parameters<typeof liveRead>[2]) => liveRead(subscribe as never, topics, options),
};
vi.mock("../src/lib/lab-data", () => ({ useLab: () => ({ client, reader }) }));

import { TaskProvider, useTask, type TaskView } from "../src/lib/task";

const shown: TaskView[] = [];
function Probe() {
  shown.push(useTask());
  return null;
}
const snapshot = { sessions: [{ id: CONVERSATION, flowKind: "agent", parentSessionId: null }], boards: {}, readAt: 1 } as unknown as LoadedSnapshot;
const last = () => shown.at(-1)!;
const settle = () => new Promise((r) => setTimeout(r, 50));
const boardNotice: WireNotice = { topic: { scope: "session", id: CONVERSATION, resource: "tasks" }, kind: "board" };

beforeEach(() => {
  opened.splice(0);
  shown.splice(0);
  board = [boardTask(null)];
  failBoard = false;
  boardReads = 0;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("a task waiting on its run link", () => {
  it("reads the board on a board notice, not on a clock, and opens the run once the link lands; at the old pace where push can miss one", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(
      <TaskProvider snapshot={snapshot} boardRef={BOARD} taskId="t1">
        <Probe />
      </TaskProvider>,
    );
    await waitFor(() => expect(last().row?.id).toBe("t1"), { timeout: 3_000 });
    expect(last().waiting).toBe(true);

    // Push covers the page: nothing on a clock, and nothing for another kind of notice on the conversation.
    await vi.advanceTimersByTimeAsync(12_000);
    hear({ topic: { scope: "session", id: CONVERSATION }, kind: "items" });
    hear({ topic: { scope: "session", id: CONVERSATION }, kind: "request" });
    await settle();
    expect(boardReads).toBe(1);
    expect(last().waiting).toBe(true);
    const sub = open()[0];
    expect(sub?.topics).toEqual([{ scope: "session", id: CONVERSATION, resource: "tasks" }]);
    expect(sub?.pollIntervalMs).toBe(2_000);

    // The run writes its link: the row's write is a board notice.
    board = [boardTask(LINK)];
    hear(boardNotice);
    await waitFor(() => expect(last().row?.run).toEqual(LINK));
    expect(boardReads).toBe(2);
    // The wait is over: it hears nothing more.
    expect(last().waiting).toBe(false);
    expect(open()).toEqual([]);
  });

  it("stops at a failed read and shows it, and Retry reads the board again", async () => {
    render(
      <TaskProvider snapshot={snapshot} boardRef={BOARD} taskId="t1">
        <Probe />
      </TaskProvider>,
    );
    await waitFor(() => expect(boardReads).toBe(1));
    failBoard = true;
    hear(boardNotice);
    await waitFor(() => expect(last().rowFailure).toBeDefined());
    expect(last().waiting).toBe(false);
    expect(open()).toEqual([]);

    failBoard = false;
    board = [boardTask(LINK)];
    last().retryRow();
    await waitFor(() => expect(last().row?.run).toEqual(LINK));
    expect(last().rowFailure).toBeUndefined();
  });
});
