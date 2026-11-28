// @vitest-environment happy-dom
// BR-3; FIX-2776 D3.
/**
 * One open task, on package reads: its row from orchestration's
 * task-list view on the conversation that holds the board, live, with no
 * re-read of its own; its run's status from the run's own request stream; and
 * Interrupt as a stop of that one run through workforce's `stopRun`, drawn
 * *interrupted* only once the run's stream says `aborted` (the run's record decides).
 *
 * The view, the stream and the workforce client are stood in for.
 */
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const CONVERSATION = "conv_1";
const BOARD = `${CONVERSATION}.tasks`;
const LINK = { sessionId: "s_run", requestId: "req_run", attempt: 1 };

const state = vi.hoisted(() => ({
  tasks: undefined as unknown[] | undefined,
  stale: false,
  status: "in_progress",
  completedAt: undefined as number | undefined,
  streaming: true,
  viewed: [] as Array<{ flow: string | null; sessionId: string | null }>,
  streamed: [] as Array<{ flowKind?: string; requestId?: string; enabled?: boolean }>,
}));
const stopRun = vi.fn();
const sessionsGet = vi.fn();
const client = { userId: "u_1", sessions: { get: (id: string) => sessionsGet(id) } };
const boardRetry = vi.fn();
const boardActions = { retry: (id: string) => boardRetry(id) };
vi.mock("../src/lib/lab-data", () => ({ useLab: () => ({ client }) }));
vi.mock("../src/lib/directory", () => ({ useSessions: () => ({ list: [{ id: CONVERSATION, flowId: "coordinator" }] }) }));
vi.mock("../src/lib/inbox", () => ({ useBoardActions: (at: unknown) => (at === undefined ? undefined : boardActions) }));
vi.mock("../src/lib/workforce", () => ({ useWorkforce: () => ({ stopRun }) }));
vi.mock("../src/lib/conversation-tasks", async (original) => ({
  ...(await original<typeof import("../src/lib/conversation-tasks")>()),
  useConversationTasks: (flow: string | null, sessionId: string | null) => {
    state.viewed.push({ flow, sessionId });
    return { tasks: flow === null ? undefined : state.tasks, stale: state.stale };
  },
}));
vi.mock("@flow-state-dev/react", async (original) => ({
  ...(await original<typeof import("@flow-state-dev/react")>()),
  useRequestStream: (options: { flowKind?: string; source: { requestId?: string }; enabled?: boolean }) => {
    state.streamed.push({ flowKind: options.flowKind, requestId: options.source.requestId, enabled: options.enabled });
    return { status: state.status, ...(state.completedAt === undefined ? {} : { completedAt: state.completedAt }), items: [], messages: [], blockOutputs: [], isStreaming: state.streaming, isFinishing: false, close: () => {} };
  },
}));

import { MISSING_FOR_MS, TaskProvider, useTask, type TaskView } from "../src/lib/task";

const shown: TaskView[] = [];
function Probe() {
  shown.push(useTask());
  return null;
}
const last = () => shown.at(-1)!;
const task = (run: typeof LINK | undefined) => ({ id: "t1", goal: "Fix it", status: "in_progress", attempts: 1, ...(run === undefined ? {} : { run }) });
const draw = () =>
  render(
    <TaskProvider boardRef={BOARD} taskId="t1">
      <Probe />
    </TaskProvider>,
  );
const settle = () => act(async () => new Promise((r) => setTimeout(r, 0)));

beforeEach(() => {
  shown.splice(0);
  state.viewed.splice(0);
  state.streamed.splice(0);
  state.tasks = [task(undefined)];
  state.stale = false;
  state.status = "in_progress";
  state.completedAt = undefined;
  state.streaming = true;
  stopRun.mockReset();
  boardRetry.mockReset();
  sessionsGet.mockReset();
  sessionsGet.mockImplementation(async (id: string) => ({ id, flowKind: "agent", flowId: id === CONVERSATION ? "coordinator" : "agent:desk" }));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("a task's entry on its board", () => {
  it("is the board's view on the conversation that holds it, through the flow that conversation runs on", async () => {
    draw();
    await settle();
    expect(state.viewed.at(-1)).toEqual({ flow: "coordinator", sessionId: CONVERSATION });
    expect(last().row).toMatchObject({ id: "t1", boardRef: BOARD, title: "Fix it", run: null, deps: [], attachments: [] });
    expect(last().waiting).toBe(true);
  });

  it("opens the run once the view brings its link, on the flow the run's session names", async () => {
    const { rerender } = draw();
    await settle();
    expect(last().run).toEqual({ kind: "none" });
    state.tasks = [task(LINK)];
    rerender(
      <TaskProvider boardRef={BOARD} taskId="t1">
        <Probe />
      </TaskProvider>,
    );
    await settle();
    expect(last().run).toEqual({ kind: "open", run: { ...LINK, flowId: "agent:desk" } });
    expect(state.streamed.at(-1)).toEqual({ flowKind: "agent:desk", requestId: "req_run", enabled: true });
  });

  it("is called missing once its deadline passes from the view's first answer, and found if the view brings it first", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    state.tasks = [];
    draw();
    await settle();
    expect(last().gaveUp).toBe(false);
    await act(async () => vi.advanceTimersByTimeAsync(MISSING_FOR_MS + 10));
    expect(last().gaveUp).toBe(true);
  });

  // Greptile 4621742279: Retry on a task called missing waits a fresh deadline, and is called missing again
  // when it passes with the task still not there.
  it("waits a fresh deadline on Retry once it was called missing, and is called missing again when that passes", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    state.tasks = [];
    draw();
    await settle();
    await act(async () => vi.advanceTimersByTimeAsync(MISSING_FOR_MS + 10));
    expect(last().gaveUp).toBe(true);
    await act(async () => last().retryRow());
    expect(last().gaveUp).toBe(false);
    await act(async () => vi.advanceTimersByTimeAsync(MISSING_FOR_MS + 10));
    expect(last().gaveUp).toBe(true);
  });

  it("shows the view's failure, never 'no such task', while it has never answered", async () => {
    state.tasks = undefined;
    state.stale = true;
    draw();
    await settle();
    expect(last().rowFailure?.message).toMatch(/didn't load/);
    expect(last().gaveUp).toBe(false);
  });
});

describe("a run its link names but nobody can read", () => {
  // Codex 4617770920: a request that isn't there, or isn't the user's, ends its stream (404, 403) with no status:
  // the screen says so, never draws it running, and offers no Interrupt.
  it("fails the run when its stream gave up before the request said how it stands", async () => {
    state.tasks = [task(LINK)];
    state.streaming = false;
    draw();
    await settle();
    expect(last().run.kind).toBe("failed");
    expect(last().status).toBeUndefined();
  });
});

describe("Interrupt (D3)", () => {
  it("stops the one run through workforce, and draws interrupted only once the run's stream says aborted, at the time it ended", async () => {
    state.tasks = [task(LINK)];
    stopRun.mockResolvedValue(undefined);
    const { rerender } = draw();
    await settle();
    await act(async () => last().requestInterrupt());
    expect(stopRun).toHaveBeenCalledWith("s_run", "req_run");
    // The stop was taken, but the run hasn't said so: still pending, still running.
    expect(last().interrupt).toEqual({ kind: "pending" });
    expect(last().status).toBe("in_progress");
    expect(last().stoppedAt).toBeUndefined();
    state.status = "aborted";
    state.completedAt = 4_242;
    rerender(
      <TaskProvider boardRef={BOARD} taskId="t1">
        <Probe />
      </TaskProvider>,
    );
    await settle();
    expect(last().status).toBe("aborted");
    expect(last().interrupt).toEqual({ kind: "idle" });
    expect(last().stoppedAt).toBe(4_242);
  });

  it("says why when the stop is refused, and the run stays as it was", async () => {
    state.tasks = [task(LINK)];
    stopRun.mockRejectedValue(new Error("Request failed (403)"));
    draw();
    await settle();
    await act(async () => last().requestInterrupt());
    expect(last().interrupt.kind).toBe("refused");
    expect(last().status).toBe("in_progress");
  });
});

// A failed task's Retry is the board's own, made here once: the task's lines Retry through it.
describe("Retry on a failed task", () => {
  // The row is the task-list view's, kept current by it: the Retry reads no whole Lab.
  it("runs the task again on its board", async () => {
    boardRetry.mockResolvedValue(undefined);
    draw();
    await settle();
    await act(async () => last().retryTask!());
    expect(boardRetry).toHaveBeenCalledWith("t1");
  });

  it("reads the row again when the board refuses, and the refusal reaches the caller", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    state.tasks = [];
    boardRetry.mockRejectedValue(new Error("not errored"));
    draw();
    await settle();
    await act(async () => vi.advanceTimersByTimeAsync(MISSING_FOR_MS + 10));
    expect(last().gaveUp).toBe(true);
    await act(async () => expect(last().retryTask!()).rejects.toThrow("not errored"));
    // The row's deadline starts afresh: the row is read again.
    expect(last().gaveUp).toBe(false);
  });
});
