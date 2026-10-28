// @vitest-environment happy-dom
/**
 * A line the running turn took shows while that turn still runs.
 *
 * The steer request records the line in session state, and the page follows
 * only the turn's stream, so without a re-read the line would stay hidden
 * until the turn ends. The session hook and the steer call are stubbed: the
 * stub's `refresh` is the only way the recorded line reaches the page.
 *
 * Red state produced before this was trusted: drop the re-read after a taken
 * line, and the "shows a taken line" case fails (no line-taken note).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCallback, useState, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const steerRunningTurn = vi.fn();
const sendAction = vi.fn(async () => undefined);
/** Session state the server holds; `refresh` reads it. */
let serverState: Record<string, unknown> = {};

vi.mock("@flow-state-dev/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@flow-state-dev/client")>()),
  steerRunningTurn: (...args: unknown[]) => steerRunningTurn(...args),
}));

vi.mock("@flow-state-dev/react", () => ({
  FlowProvider: ({ children }: { children: ReactNode }) => children,
  useResourceManifest: () => ({ manifest: undefined, error: undefined }),
  useResourceCollectionList: () => ({ items: [], error: undefined }),
  useSession: () => {
    const [snapshot, setSnapshot] = useState({ clientData: { session: serverState } });
    const refresh = useCallback(async () => setSnapshot({ clientData: { session: serverState } }), []);
    return {
      snapshot,
      refresh,
      sendAction,
      abortRequest: vi.fn(),
      detail: undefined,
      isLoading: false,
      isStreaming: true,
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
  serverState = {};
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

  it("sends a line the turn refused as the next turn, with no taken note", async () => {
    steerRunningTurn.mockResolvedValue({ taken: false, live: true });
    mount();
    sendLine("later");
    await waitFor(() => expect(sendAction).toHaveBeenCalledWith("turn", { prompt: "later" }, { userMessage: "later" }));
    expect(screen.queryByTestId("line-taken")).toBeNull();
  });
});
