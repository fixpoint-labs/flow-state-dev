// @vitest-environment happy-dom
/**
 * A line the running turn took shows while that turn still runs, and a line
 * it didn't take waits as the next turn while the page stays on the running
 * one (FIX-2265).
 *
 * The steer request records the line in session state, and the page follows
 * only the turn's stream, so without a re-read the line would stay hidden
 * until the turn ends. The session hook and the client are stubbed: the
 * stub's `refresh` is the only way the recorded line reaches the page.
 *
 * Red states produced before this was trusted:
 *   - drop the re-read after a taken line, and the "shows a taken line" case
 *     fails (no line-taken note).
 *   - send a refused line through the session hook (`sendAction`), as the
 *     page did, and the "stays on the running turn" case fails: the hook
 *     leaves the running turn's stream for the waiting line's.
 *   - follow the waiting line whenever streaming stops, and the "stream
 *     drops" case fails: the page leaves a turn that still runs.
 *   - one button that stops while a turn runs, as the page had, and the
 *     "Send and Stop" case fails: there is no Send to press, and pressing
 *     the one button stops the turn and keeps the line in the box.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCallback, useState, type ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const steerRunningTurn = vi.fn();
const sendAction = vi.fn(async () => undefined);
const followRequest = vi.fn();
const abortRequest = vi.fn(async () => undefined);
/** The client's `flow(kind).send`: a line sent beside the running turn. */
const clientSend = vi.fn(async () => ({ id: "line-1" }));
/** Ends the running turn in the stubbed hook. */
let endTurn: () => void = () => undefined;
/** The session's running requests, as the client lists them. */
let inProgress: Array<{ id: string; actionName: string; startedAtMs: number }> = [];
/** Session state the server holds; `refresh` reads it. */
let serverState: Record<string, unknown> = {};

vi.mock("@flow-state-dev/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@flow-state-dev/client")>()),
  steerRunningTurn: (...args: unknown[]) => steerRunningTurn(...args),
  createClient: () => ({
    flow: () => ({ send: (...args: unknown[]) => clientSend(...(args as [])) }),
    sessions: { requests: async () => inProgress },
  }),
}));

vi.mock("@flow-state-dev/react", () => ({
  FlowProvider: ({ children }: { children: ReactNode }) => children,
  useResourceManifest: () => ({ manifest: undefined, error: undefined }),
  useResourceCollectionList: () => ({ items: [], error: undefined }),
  useSession: () => {
    const [snapshot, setSnapshot] = useState({ clientData: { session: serverState } });
    const refresh = useCallback(async () => setSnapshot({ clientData: { session: serverState } }), []);
    const [isStreaming, setIsStreaming] = useState(true);
    endTurn = () => setIsStreaming(false);
    return {
      snapshot,
      refresh,
      sendAction,
      followRequest,
      abortRequest,
      detail: undefined,
      isLoading: false,
      isStreaming,
      isFinishing: false,
      statusMessage: "",
      latestRequest: null,
      items: [{ id: "i1", type: "message", role: "user", requestId: "turn-1", content: [] }],
    };
  },
}));

vi.mock("@/components/flow-state/request-group", () => ({ RequestGroupRenderer: () => null }));

const { HarnessSessionView } = await import("@/components/harness-session");

afterEach(() => {
  cleanup();
  steerRunningTurn.mockReset();
  sendAction.mockClear();
  followRequest.mockClear();
  abortRequest.mockClear();
  clientSend.mockClear();
  serverState = {};
  inProgress = [];
  localStorage.clear();
});

function sendLine(text: string) {
  const box = screen.getByPlaceholderText("Ask Cursor…") as HTMLTextAreaElement;
  fireEvent.change(box, { target: { value: text } });
  fireEvent.submit(box.closest("form")!);
}

function mount() {
  render(
    <HarnessSessionView
      label="Cursor"
      flowKind="cursor-session"
      sessionId="s1"
      models={{ models: [], defaultId: null, reason: null, fallbackId: null }}
    />,
  );
}

describe("a line sent while the turn runs", () => {
  it("shows a taken line while the turn still runs", async () => {
    steerRunningTurn.mockImplementation(async () => {
      // The steer request's `onTaken` records the line before it answers.
      serverState = { turns: { "turn-1": { steered: ["use v3"] } } };
      return { taken: true, live: true };
    });
    mount();
    sendLine("use v3");
    await waitFor(() => expect(screen.getByTestId("line-taken").textContent).toContain("use v3"));
    expect(sendAction).not.toHaveBeenCalled();
  });

  it("sends a line the turn refused as the next turn, with no taken note, and stays on the running turn", async () => {
    steerRunningTurn.mockResolvedValue({ taken: false, live: true });
    mount();
    sendLine("later");
    await waitFor(() => expect(clientSend).toHaveBeenCalledWith("turn", { prompt: "later" }, { sessionId: "s1" }));
    await waitFor(() => expect(screen.getByTestId("line-after")).toBeTruthy());
    expect(screen.queryByTestId("line-taken")).toBeNull();
    // The hook still follows the running turn: nothing moved it to the line.
    expect(sendAction).not.toHaveBeenCalled();
    expect(followRequest).not.toHaveBeenCalled();
  });

  it("follows the waiting line once the running turn ends", async () => {
    steerRunningTurn.mockResolvedValue({ taken: false, live: false });
    mount();
    sendLine("after that");
    await waitFor(() => expect(clientSend).toHaveBeenCalled());
    expect(followRequest).not.toHaveBeenCalled();
    act(() => endTurn());
    await waitFor(() => expect(followRequest).toHaveBeenCalledWith("line-1"));
    expect(followRequest).toHaveBeenCalledTimes(1);
  });

  it("while a turn runs, Send sends the line and clears the box, and Stop is a button of its own", async () => {
    steerRunningTurn.mockResolvedValue({ taken: false, live: false });
    mount();
    expect(screen.getByTestId("line-hint").textContent).toContain("joins this turn if Cursor can take it, or runs after this turn");
    const box = screen.getByPlaceholderText("Ask Cursor…") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "after that" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await waitFor(() => expect(clientSend).toHaveBeenCalledWith("turn", { prompt: "after that" }, { sessionId: "s1" }));
    await waitFor(() => expect(box.value).toBe(""));
    expect(abortRequest).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(abortRequest).toHaveBeenCalledTimes(1);
  });

  it("stays on the running turn when only its stream ended", async () => {
    steerRunningTurn.mockResolvedValue({ taken: false, live: false });
    mount();
    sendLine("after that");
    await waitFor(() => expect(clientSend).toHaveBeenCalled());
    // The stream dropped; the server still runs the turn, and the line waits behind it.
    inProgress = [
      { id: "turn-1", actionName: "turn", startedAtMs: 1 },
      { id: "line-1", actionName: "turn", startedAtMs: 2 },
    ];
    act(() => endTurn());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(followRequest).not.toHaveBeenCalled();
  });
});
