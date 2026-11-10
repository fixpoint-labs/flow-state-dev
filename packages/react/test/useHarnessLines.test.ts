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
 *   - follow the running turn again when the view refuses it (the person
 *     stopped it), and the "stopped" case fails: the waiting turn is never
 *     followed.
 *   - act on a running-turns read after the view moved to another session,
 *     and the "session changed" case fails: the old session's turn is
 *     followed into the new session's view.
 *   - let a line steer while a sent turn still waits, and both "a later line
 *     runs after" cases fail: the line is taken into the running turn ahead
 *     of the one waiting.
 *   - send every waiting line to the server at once, and the "one waiting
 *     turn on the server" cases fail: two `defer` turns wait together, and
 *     the server starts them in no set order.
 *   - send the next held line as soon as the view moves to the one before
 *     it, and "until the turn before it has started" fails: the two wait on
 *     the server together while the first hasn't claimed the session.
 *   - ignore `input`, and the "input" cases fail: the turn gets `{ prompt }`.
 *   - send a new line while an older one is still held, and the "older one
 *     is still held" case fails: the new line jumps it, and the held one is
 *     never sent.
 *   - clear the held lines when the view moves to another session, and the
 *     "moving to another session" case fails: they are never sent.
 *   - move the queue only once the new session has loaded, and the "still
 *     loads" case fails: a line sent for the new session goes to the old one.
 *   - keep a session marked checked when the queue moves off it, and the
 *     "coming back" case fails: its waiting turns are never read again.
 *   - let a failed send's retry for a session left run, and the "fails later"
 *     case fails: the new session's held line is sent to the old one.
 *   - let a line whose steer answers late join the queue after the view
 *     moved, and the "steer answers after" case fails: s1's line waits in
 *     s2's queue, to be sent to s2.
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

function view(isStreaming: boolean, isLoading = false, sessionId = "s1", items: Array<{ requestId: string }> = []): SessionView {
  return { flowKind: "harness", sessionId, userId: "u", isStreaming, isLoading, followRequest, sendAction, items } as unknown as SessionView;
}

function mount(isStreaming = true) {
  return renderHook(({ session }) => useHarnessLines(session), { initialProps: { session: view(isStreaming) } });
}

/** The chat-agent flow's shape: a `run` action with its own input, and no steer. */
function mountChat(isStreaming = true) {
  return renderHook(
    ({ session }) =>
      useHarnessLines(session, {
        turnAction: "run",
        input: (line) => ({ message: line, mode: "ask" }),
        sendOne: (line, _running, sender) => sender.turn(line).then(() => "turn" as const)
      }),
    { initialProps: { session: view(isStreaming) } }
  );
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

describe("useHarnessLines, a line with files", () => {
  const shot = { type: "file" as const, mediaType: "image/png", data: "ref-of-shot", filename: "shot.png" };

  it("sends its files with the turn when no turn runs", async () => {
    const { result } = mount(false);
    await expect(result.current.send("what is this?", { attachments: [shot] })).resolves.toBe("turn");
    expect(sendAction).toHaveBeenCalledWith("turn", { prompt: "what is this?" }, { userMessage: "what is this?", attachments: [shot] });
  });

  it("never steers while a turn runs: it waits as the next turn, files and all", async () => {
    steerRunningTurn.mockResolvedValue({ taken: true, live: true });
    const { result } = mount();
    await expect(result.current.send("and this one", { attachments: [shot] })).resolves.toBe("after-this-turn");
    expect(steerRunningTurn).not.toHaveBeenCalled();
    expect(flowMock.send).toHaveBeenCalledWith("turn", { prompt: "and this one" }, { sessionId: "s1", attachments: [shot] });
    await waitFor(() => expect(result.current.waiting).toEqual([expect.objectContaining({ text: "and this one" })]));
  });

  it("sends no files for an empty list, and still steers", async () => {
    steerRunningTurn.mockResolvedValue({ taken: true, live: true });
    const { result } = mount();
    await expect(result.current.send("use v3", { attachments: [] })).resolves.toBe("taken");
  });
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

  it("when the person stopped the running turn, moves on to the waiting one", async () => {
    // The view refuses a turn the person stopped.
    followRequest.mockImplementation((id: string) => id !== "turn-1");
    const { result, rerender } = mount();
    await result.current.send("later");
    running = [
      { id: "turn-1", actionName: "turn", startedAtMs: 1 },
      { id: "line-1", actionName: "turn", startedAtMs: 2 }
    ];
    rerender({ session: view(false) });
    await waitFor(() => expect(followRequest).toHaveBeenLastCalledWith("line-1"));
    followRequest.mockReset();
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
    // The running turn ends; the view follows the first waiting line, and the second waits in the page.
    running = [{ id: "line-1", actionName: "turn", startedAtMs: 2 }];
    rerender({ session: view(false) });
    await waitFor(() => expect(followRequest).toHaveBeenCalledWith("line-1"));
    // The first line's turn starts: its first item. The second is sent to wait behind it.
    rerender({ session: view(true, false, "s1", [{ requestId: "line-1" }]) });
    await waitFor(() => expect(flowMock.send).toHaveBeenLastCalledWith("turn", { prompt: "second" }, { sessionId: "s1" }));
    steerRunningTurn.mockClear();
    steerRunningTurn.mockResolvedValue({ taken: true, live: true });

    await expect(result.current.send("third")).resolves.toBe("after-this-turn");
    expect(steerRunningTurn).not.toHaveBeenCalled();
    // The third waits in the page while the second waits on the server.
    expect(flowMock.send).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(result.current.waiting.map((line) => line.text)).toEqual(["second", "third"]));
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

  it("sends a turn with the input `input` makes of the line, through the view or the client", async () => {
    const idle = mountChat(false);
    await expect(idle.result.current.send("hello")).resolves.toBe("turn");
    expect(sendAction).toHaveBeenCalledWith("run", { message: "hello", mode: "ask" }, { userMessage: "hello" });
    idle.unmount();

    const { result } = mountChat();
    await result.current.send("later");
    expect(flowMock.send).toHaveBeenCalledWith("run", { message: "later", mode: "ask" }, { sessionId: "s1" });
  });

  it("keeps one waiting turn on the server: later lines wait in the page and go in the order typed", async () => {
    const { result, rerender } = mountChat();
    await act(async () => {
      await result.current.send("second");
      await result.current.send("third");
    });
    // Both are listed, in order; only the first is on the server.
    expect(result.current.waiting.map((line) => line.text)).toEqual(["second", "third"]);
    expect(flowMock.send).toHaveBeenCalledTimes(1);
    expect(flowMock.send).toHaveBeenLastCalledWith("run", { message: "second", mode: "ask" }, { sessionId: "s1" });

    // The running turn ends: the view moves to the second line's turn, which leaves the list.
    running = [{ id: "line-1", actionName: "run", startedAtMs: 2 }];
    rerender({ session: view(false) });
    await waitFor(() => expect(followRequest).toHaveBeenCalledWith("line-1"));
    await waitFor(() => expect(result.current.waiting.map((line) => line.text)).toEqual(["third"]));
    // Until the turn before it has started, the third stays in the page.
    rerender({ session: view(true) });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(flowMock.send).toHaveBeenCalledTimes(1);

    // The second's turn has its first item: it started, so the third goes to wait behind it.
    rerender({ session: view(true, false, "s1", [{ requestId: "line-1" }]) });
    await waitFor(() => expect(flowMock.send).toHaveBeenCalledTimes(2));
    expect(flowMock.send).toHaveBeenLastCalledWith("run", { message: "third", mode: "ask" }, { sessionId: "s1" });
    expect(result.current.waiting.map((line) => line.text)).toEqual(["third"]);

    // The second's turn ends: the view moves to the third's, and nothing waits.
    running = [{ id: "line-2", actionName: "run", startedAtMs: 3 }];
    rerender({ session: view(false, false, "s1", [{ requestId: "line-1" }]) });
    await waitFor(() => expect(followRequest).toHaveBeenLastCalledWith("line-2"));
    await waitFor(() => expect(result.current.waiting).toEqual([]));
  });

  it("a line sent while an older one is still held waits behind it, even when the turn before ended unseen", async () => {
    const { result, rerender } = mountChat();
    await act(async () => {
      await result.current.send("second");
      await result.current.send("third");
    });
    // The running turn ends: the view moves to the second's turn, and the third stays held.
    running = [{ id: "line-1", actionName: "run", startedAtMs: 2 }];
    rerender({ session: view(false) });
    await waitFor(() => expect(followRequest).toHaveBeenCalledWith("line-1"));
    rerender({ session: view(true) });
    // The second's turn ends before any of its items is seen, and the read of what runs is slow.
    let answer: (turns: typeof running) => void = () => undefined;
    sessionsMock.requests.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    rerender({ session: view(false) });
    await waitFor(() => expect(sessionsMock.requests).toHaveBeenCalledTimes(3));

    // A line sent during that read: the held third goes first, not the new one.
    await act(async () => {
      await result.current.send("fourth");
    });
    expect(flowMock.send).toHaveBeenCalledTimes(2);
    expect(flowMock.send).toHaveBeenLastCalledWith("run", { message: "third", mode: "ask" }, { sessionId: "s1" });
    await act(async () => {
      answer([]);
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    // The view moves to the third's turn; the fourth waits held behind it, nothing stranded.
    await waitFor(() => expect(followRequest).toHaveBeenLastCalledWith("line-2"));
    expect(result.current.waiting.map((line) => line.text)).toEqual(["fourth"]);
  });

  it("moving to another session sends the lines held for the one left, in the order typed, rather than dropping them", async () => {
    const { result, rerender } = mountChat();
    await act(async () => {
      await result.current.send("second");
      await result.current.send("third");
      await result.current.send("fourth");
    });
    expect(flowMock.send).toHaveBeenCalledTimes(1);

    rerender({ session: view(false, false, "s2") });
    await waitFor(() => expect(flowMock.send).toHaveBeenCalledTimes(3));
    expect(flowMock.send.mock.calls.slice(1)).toEqual([
      ["run", { message: "third", mode: "ask" }, { sessionId: "s1" }],
      ["run", { message: "fourth", mode: "ask" }, { sessionId: "s1" }]
    ]);
    // The new session's view lists none of them.
    expect(result.current.waiting).toEqual([]);
  });

  it("a line sent while the next session still loads goes to that session, not the one left", async () => {
    const { result, rerender } = mountChat();
    await act(async () => {
      await result.current.send("second");
      await result.current.send("third");
    });
    // The view moves to s2, still loading, with a turn running there.
    rerender({ session: view(true, true, "s2") });
    await waitFor(() => expect(flowMock.send).toHaveBeenCalledWith("run", { message: "third", mode: "ask" }, { sessionId: "s1" }));
    await act(async () => {
      await result.current.send("for s2");
    });
    rerender({ session: view(true, false, "s2") });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(flowMock.send).toHaveBeenLastCalledWith("run", { message: "for s2", mode: "ask" }, { sessionId: "s2" });
    expect(flowMock.send).not.toHaveBeenCalledWith("run", { message: "for s2", mode: "ask" }, { sessionId: "s1" });
    expect(result.current.waiting.map((line) => line.text)).toEqual(["for s2"]);
  });

  it("coming back to a session before the other one loads reads its waiting turns again", async () => {
    const { result, rerender } = mount();
    await result.current.send("waits");
    await waitFor(() => expect(result.current.waiting.map((line) => line.text)).toEqual(["waits"]));
    // Off to s2, back to s1 before s2 loads; s1 still has its turn and the waiting one.
    rerender({ session: view(true, true, "s2") });
    running = [
      { id: "turn-1", actionName: "turn", startedAtMs: 1 },
      { id: "line-1", actionName: "turn", startedAtMs: 2 }
    ];
    rerender({ session: view(true, false, "s1") });
    await waitFor(() => expect(followRequest).toHaveBeenCalledWith("turn-1"));
    expect(result.current.waiting.map((line) => line.key)).toEqual(["line-1"]);
  });

  it("a send for a session left that fails later never sends the new session's lines there", async () => {
    const { result, rerender } = mountChat();
    await act(async () => {
      await result.current.send("a2");
      await result.current.send("a3");
    });
    // s1's turn ends: the view follows a2's turn; it starts, and a3's send goes out and hangs.
    running = [{ id: "line-1", actionName: "run", startedAtMs: 2 }];
    rerender({ session: view(false) });
    await waitFor(() => expect(followRequest).toHaveBeenCalledWith("line-1"));
    let fail: (error: Error) => void = () => undefined;
    flowMock.send.mockImplementationOnce(() => new Promise((_resolve, reject) => (fail = reject)));
    rerender({ session: view(true, false, "s1", [{ requestId: "line-1" }]) });
    await waitFor(() => expect(flowMock.send).toHaveBeenCalledTimes(2));

    // The view moves to s2, where a turn runs: b2 waits on the server, b3 is held.
    running = [];
    rerender({ session: view(true, false, "s2") });
    await act(async () => {
      await result.current.send("b2");
      await result.current.send("b3");
    });
    expect(flowMock.send).toHaveBeenLastCalledWith("run", { message: "b2", mode: "ask" }, { sessionId: "s2" });
    // s2's turn ends: the view follows b2's, which ends unseen while the read of what runs is slow.
    running = [{ id: "line-2", actionName: "run", startedAtMs: 3 }];
    rerender({ session: view(false, false, "s2") });
    await waitFor(() => expect(followRequest).toHaveBeenCalledWith("line-2"));
    rerender({ session: view(true, false, "s2") });
    sessionsMock.requests.mockImplementationOnce(() => new Promise(() => undefined));
    rerender({ session: view(false, false, "s2") });

    // a3's send to s1 fails now: b3 must not be sent to s1.
    await act(async () => {
      fail(new Error("refused"));
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(flowMock.send).not.toHaveBeenCalledWith("run", { message: "b3", mode: "ask" }, { sessionId: "s1" });
  });

  it("a line whose steer answers after the view moved still goes to its own session", async () => {
    const { result, rerender } = mount();
    await waitFor(() => expect(sessionsMock.requests).toHaveBeenCalled());
    let answer: (outcome: { taken: boolean; live: boolean }) => void = () => undefined;
    steerRunningTurn.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    let sent: Promise<string> | undefined;
    act(() => {
      sent = result.current.send("for s1");
    });
    await waitFor(() => expect(steerRunningTurn).toHaveBeenCalled());

    // The view moves to s2, which opens with a turn running and one waiting.
    running = [
      { id: "turn-b", actionName: "turn", startedAtMs: 1 },
      { id: "wait-b", actionName: "turn", startedAtMs: 2 }
    ];
    rerender({ session: view(true, false, "s2") });
    await waitFor(() => expect(followRequest).toHaveBeenCalledWith("turn-b"));

    // s1's run refuses the line now: it is sent to s1, and s2's queue never holds it.
    await act(async () => {
      answer({ taken: false, live: true });
      await sent;
    });
    expect(flowMock.send).toHaveBeenCalledWith("turn", { prompt: "for s1" }, { sessionId: "s1" });
    expect(result.current.waiting.map((line) => line.key)).toEqual(["wait-b"]);
  });

  it("a waiting line whose turn can't be sent leaves the list, and its send rejects", async () => {
    flowMock.send.mockRejectedValueOnce(new Error("refused"));
    const { result } = mountChat();
    let outcome: Promise<string> | undefined;
    await act(async () => {
      outcome = result.current.send("second");
      await expect(outcome).rejects.toThrow("refused");
    });
    expect(result.current.waiting).toEqual([]);
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
