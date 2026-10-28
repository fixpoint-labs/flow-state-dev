// @vitest-environment happy-dom
/**
 * `useHarnessLines`: a harness session's lines go into the running turn or
 * run after it, in the order typed, and the session view stays on the running
 * turn while a line's turn waits behind it.
 *
 * The session view is a stub the test drives (`isStreaming`, `followRequest`,
 * `sendAction`); the client is faked (`support/fake-client`), and the steer
 * call is stubbed, so the test sets each run's answer.
 *
 * Red states produced before these were trusted:
 *   - follow the waiting turn whenever streaming stops, and the "stream
 *     dropped" case fails: the view leaves a turn that still runs.
 *   - stay off the stream when only it dropped, and the same case fails:
 *     nothing follows the running turn again, so neither turn is seen.
 *   - follow a running turn again with no limit, and the "keeps dropping"
 *     case fails: the view reattaches on every drop.
 *   - act on a running-turns read after the view moved to another session,
 *     and the "session changed" case fails: the old session's turn is
 *     followed into the new session's view.
 *   - let a line steer while a sent turn still waits, and both "a later line
 *     runs after" cases fail: the line is taken into the running turn ahead
 *     of the one waiting.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { SessionView } from "../src/hooks/useSession";

const { steerRunningTurn, flowMock, sessionsMock } = vi.hoisted(() => ({
  steerRunningTurn: vi.fn(),
  flowMock: { send: vi.fn() },
  sessionsMock: { requests: vi.fn() }
}));

vi.mock("@flow-state-dev/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@flow-state-dev/client")>();
  const { fakeClient } = await import("./support/fake-client");
  return {
    ...actual,
    steerRunningTurn: (...args: unknown[]) => steerRunningTurn(...args),
    createClient: () => fakeClient({ flow: flowMock, sessions: sessionsMock })
  };
});

import { useHarnessLines } from "../src/hooks/useHarnessLines";

/** The session's running requests, as the client lists them. */
let running: Array<{ id: string; actionName: string; startedAtMs: number }> = [];
const followRequest = vi.fn();
const sendAction = vi.fn(async () => ({}));

function view(isStreaming: boolean, isLoading = false, sessionId = "s1"): SessionView {
  return { flowKind: "harness", sessionId, userId: "u", isStreaming, isLoading, followRequest, sendAction } as unknown as SessionView;
}

function mount(isStreaming = true) {
  return renderHook(({ session }) => useHarnessLines(session), { initialProps: { session: view(isStreaming) } });
}

beforeEach(() => {
  running = [];
  let sent = 0;
  flowMock.send.mockImplementation(async () => ({ request: { id: `line-${++sent}` } }));
  sessionsMock.requests.mockImplementation(async () => running);
  steerRunningTurn.mockResolvedValue({ taken: false, live: true });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useHarnessLines", () => {
  it("sends a line as a turn through the session view when no turn runs", async () => {
    const { result } = mount(false);
    await expect(result.current.send("hello")).resolves.toBe("turn");
    expect(sendAction).toHaveBeenCalledWith("turn", { prompt: "hello" }, { userMessage: "hello" });
    expect(steerRunningTurn).not.toHaveBeenCalled();
  });

  it("hands a line to the running turn when the run takes it", async () => {
    steerRunningTurn.mockResolvedValue({ taken: true, live: true });
    const { result } = mount();
    await expect(result.current.send("use v3")).resolves.toBe("taken");
    expect(flowMock.send).not.toHaveBeenCalled();
    expect(sendAction).not.toHaveBeenCalled();
  });

  it("sends a refused line as the next turn beside the running one, and follows it once the running turn ends", async () => {
    const { result, rerender } = mount();
    await expect(result.current.send("later")).resolves.toBe("after-this-turn");
    expect(flowMock.send).toHaveBeenCalledWith("turn", { prompt: "later" }, { sessionId: "s1" });
    // The view stays on the running turn.
    expect(sendAction).not.toHaveBeenCalled();
    expect(followRequest).not.toHaveBeenCalled();

    running = [{ id: "line-1", actionName: "turn", startedAtMs: 2 }];
    rerender({ session: view(false) });
    await waitFor(() => expect(followRequest).toHaveBeenCalledWith("line-1"));
    expect(followRequest).toHaveBeenCalledTimes(1);
  });

  it("when only the running turn's stream dropped, follows that turn again, then the waiting one once it ends", async () => {
    const { result, rerender } = mount();
    await result.current.send("later");
    // The stream dropped; the server still runs the turn, and the line waits behind it.
    running = [
      { id: "turn-1", actionName: "turn", startedAtMs: 1 },
      { id: "line-1", actionName: "turn", startedAtMs: 2 }
    ];
    rerender({ session: view(false) });
    // Left off the stream, the view would see neither turn end, and the waiting answer only on a reload.
    await waitFor(() => expect(followRequest).toHaveBeenCalledWith("turn-1"));
    expect(followRequest).toHaveBeenCalledTimes(1);

    rerender({ session: view(true) });
    running = [{ id: "line-1", actionName: "turn", startedAtMs: 2 }];
    rerender({ session: view(false) });
    await waitFor(() => expect(followRequest).toHaveBeenLastCalledWith("line-1"));
    expect(followRequest).toHaveBeenCalledTimes(2);
  });

  it("stops following a running turn again after its stream keeps dropping", async () => {
    const { result, rerender } = mount();
    await result.current.send("later");
    running = [
      { id: "turn-1", actionName: "turn", startedAtMs: 1 },
      { id: "line-1", actionName: "turn", startedAtMs: 2 }
    ];
    for (let drop = 1; drop <= 5; drop++) {
      rerender({ session: view(false) });
      // One read when the view opened, then one per drop.
      await waitFor(() => expect(sessionsMock.requests).toHaveBeenCalledTimes(drop + 1));
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
      rerender({ session: view(true) });
    }
    expect(followRequest).toHaveBeenCalledTimes(3);
    expect(followRequest).not.toHaveBeenCalledWith("line-1");
  });

  it("ignores a running-turns read that lands after the view moved to another session", async () => {
    const { result, rerender } = mount();
    await result.current.send("later");
    let answer: (turns: typeof running) => void = () => undefined;
    sessionsMock.requests.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    rerender({ session: view(false) });
    await waitFor(() => expect(sessionsMock.requests).toHaveBeenCalledTimes(2));

    rerender({ session: view(false, false, "s2") });
    await act(async () => {
      answer([
        { id: "turn-1", actionName: "turn", startedAtMs: 1 },
        { id: "line-1", actionName: "turn", startedAtMs: 2 }
      ]);
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(followRequest).not.toHaveBeenCalledWith("turn-1");
  });

  it("while a sent turn still waits, a later line runs after it rather than steering past it", async () => {
    const { result, rerender } = mount();
    await result.current.send("first");
    await result.current.send("second");
    // The running turn ends; the view follows the first waiting line, and the second still waits.
    running = [
      { id: "line-1", actionName: "turn", startedAtMs: 2 },
      { id: "line-2", actionName: "turn", startedAtMs: 3 }
    ];
    rerender({ session: view(false) });
    await waitFor(() => expect(followRequest).toHaveBeenCalledWith("line-1"));
    rerender({ session: view(true) });
    steerRunningTurn.mockClear();
    steerRunningTurn.mockResolvedValue({ taken: true, live: true });

    await expect(result.current.send("third")).resolves.toBe("after-this-turn");
    expect(steerRunningTurn).not.toHaveBeenCalled();
    expect(flowMock.send).toHaveBeenLastCalledWith("turn", { prompt: "third" }, { sessionId: "s1" });
  });

  it("opened while turns wait, follows the oldest running turn, and a later line runs after the waiting ones", async () => {
    running = [
      { id: "turn-b", actionName: "turn", startedAtMs: 2 },
      { id: "turn-a", actionName: "turn", startedAtMs: 1 }
    ];
    steerRunningTurn.mockResolvedValue({ taken: true, live: true });
    const { result } = mount();
    await waitFor(() => expect(followRequest).toHaveBeenCalledWith("turn-a"));

    await expect(result.current.send("after both")).resolves.toBe("after-this-turn");
    expect(steerRunningTurn).not.toHaveBeenCalled();
  });

  it("opened with one turn running, follows nothing new", async () => {
    running = [{ id: "turn-a", actionName: "turn", startedAtMs: 1 }];
    mount();
    await waitFor(() => expect(sessionsMock.requests).toHaveBeenCalled());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(followRequest).not.toHaveBeenCalled();
  });
});
