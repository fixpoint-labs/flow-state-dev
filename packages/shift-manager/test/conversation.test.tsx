// @vitest-environment happy-dom
/**
 * <Conversation> is the one way a view shows and sends into a conversation with
 * a worker. Drawn here as a view that isn't the Shift Coordinator's: another worker
 * and name, its own test ids, its own rendering of an item. The read and the
 * send are stood in for; what is checked is what the component does with them:
 * the session it reads and sends into, when it lets a line go, the read-back
 * while a reply is in flight, what a failed line leaves behind, and the retry
 * landing in the same session.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { SessionSummary } from "@flow-state-dev/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GAPS } from "../src/gaps";
import type { Worker } from "../src/lib/reads";
import { TurnNotDelivered } from "../src/lib/send";

const read = vi.fn();
const sendTurn = vi.fn();
const ensureWorkerSession = vi.fn();
// One object, as the provider hands one: a fresh `client` each render would re-read forever.
const lab = {
  client: { userId: "u_1" },
  refresh: vi.fn(),
  snapshot: { orgId: "org_1", sessions: [], inventory: { ok: true, value: { workers: [] } } },
};
const workforce = { ensureWorkerSession };
vi.mock("../src/lib/lab-data", () => ({ useLab: () => lab }));
vi.mock("../src/lib/workforce", () => ({ useWorkforce: () => workforce }));
vi.mock("../src/lib/run", async (original) => ({ ...(await original<typeof import("../src/lib/run")>()), readSessionItems: (...a: unknown[]) => read(...a) }));
vi.mock("../src/lib/send", async (original) => ({ ...(await original<typeof import("../src/lib/send")>()), sendTurn: (...a: unknown[]) => sendTurn(...a) }));
// A page with no Web Crypto can't hash a derived address: this worker's derivation fails the way it would there.
const UNHASHABLE = "eng.unhashable";
vi.mock("@flow-state-dev/workforce/browser", async (original) => {
  const real = await original<typeof import("@flow-state-dev/workforce/browser")>();
  return {
    ...real,
    deriveWorkerSessionId: (input: Parameters<typeof real.deriveWorkerSessionId>[0]) =>
      input.criteria.worker === UNHASHABLE ? Promise.reject(new Error("crypto.subtle is not available")) : real.deriveWorkerSessionId(input),
  };
});

import { deriveWorkerSessionId } from "@flow-state-dev/workforce/browser";
import { Conversation } from "../src/components/Conversation";
import { RECEIVED_MESSAGE_COMPONENT } from "@flow-state-dev/workforce/browser";

// The reviewer's conversation: the session at its derived address, where a worker's message lands too.
const s1 = await deriveWorkerSessionId({ userId: "u_1", orgId: "org_1", flow: "agent", criteria: { worker: "eng.reviewer" } });

// A worker on the shared `agent` flow: its sessions are that flow's, naming it as their worker.
const worker = { id: "eng.reviewer", kind: "agent", door: "talk" } as unknown as Worker;
const session = (id: string): SessionSummary =>
  ({ id, flowKind: "agent", flowId: "agent", state: { workerId: "eng.reviewer" }, createdAt: 1, parentSessionId: null }) as unknown as SessionSummary;
const item = (id: string, text: string) => ({ id, requestId: "r", type: "message", role: "assistant", ts: Date.UTC(2026, 9, 7, 17, 34), text });
const delivered = { requestId: "q", suspended: false, stopped: null };

beforeEach(() => {
  read.mockReset();
  sendTurn.mockReset();
  ensureWorkerSession.mockReset();
  ensureWorkerSession.mockResolvedValue({ id: s1 });
  lab.refresh.mockReset();
  read.mockResolvedValue({ items: [], truncated: false });
});
afterEach(() => cleanup());

const drawn = (sessions: SessionSummary[], over: Partial<Parameters<typeof Conversation>[0]> = {}) =>
  render(
    <Conversation
      worker={worker}
      sessions={sessions}
      gaps={GAPS}
      name="Reviewer"
      testId="rev"
      emptyText="Nothing said to the reviewer yet."
      renderItem={(it) => <span data-testid="mine">{(it as unknown as { text: string }).text}</span>}
      {...over}
    />,
  );

/** Type a line and press send, once the composer has let go of "Reading the conversation first…". */
async function send(line: string) {
  const input = screen.getByTestId("rev-composer-input") as HTMLInputElement;
  await waitFor(() => expect(input.disabled).toBe(false));
  fireEvent.change(input, { target: { value: line } });
  await act(async () => {
    fireEvent.click(screen.getByTestId("rev-composer-send"));
  });
}

describe("what a view of its own draws", () => {
  it("says what it is before a first line, under that view's own ids", async () => {
    drawn([]);
    expect((await screen.findByTestId("rev-conversation-empty")).textContent).toBe("Nothing said to the reviewer yet.");
    expect(screen.getByTestId("rev-composer")).toBeTruthy();
    expect(screen.queryByTestId("shift-coordinator")).toBeNull();
  });

  it("says what it is in a session opened before a first line, rather than drawing nothing", async () => {
    // A project's Stream opens its coordinator session as the tab opens, so the
    // session exists and reads empty: the screen must still say what it is.
    drawn([], { session: "s1" });
    expect((await screen.findByTestId("rev-conversation-empty")).textContent).toBe("Nothing said to the reviewer yet.");
    expect(read.mock.calls[0]![1]).toBe("s1");
  });

  it("says what it is in a session that holds only items the feed never draws, rather than drawing an empty list", async () => {
    // Reading the worker's standing rules runs in this session before any line is sent, and the Lab
    // keeps the write it makes: the user has still said nothing, so the screen must say so.
    read.mockResolvedValue({
      items: [
        { id: "sc1", requestId: "r", type: "state_change", ts: 1 },
        { id: "rc1", requestId: "r", type: "resource_change", ts: 1 },
        { id: "sr1", requestId: "r", type: "suspension_resume", ts: 1 },
        { id: "co1", requestId: "r", type: "continuation", ts: 1 },
      ],
      truncated: false,
    });
    drawn([session(s1)]);
    expect((await screen.findByTestId("rev-conversation-empty")).textContent).toBe("Nothing said to the reviewer yet.");
    expect(screen.queryByTestId("rev-items")).toBeNull();
    expect(screen.queryByTestId("mine")).toBeNull();
  });

  it("doesn't call a cut-short read empty when what it holds draws nothing: later items may", async () => {
    read.mockResolvedValue({ items: [{ id: "sc1", requestId: "r", type: "state_change", ts: 1 }], truncated: true });
    drawn([session(s1)]);
    expect(await screen.findByTestId("rev-truncated")).toBeTruthy();
    expect(screen.queryByTestId("rev-conversation-empty")).toBeNull();
  });

  it("keeps its look hooks the same whatever its test id, so one rule styles every conversation", () => {
    const { container } = drawn([]);
    expect(container.querySelector('[data-look="conversation-feed"]')).toBeTruthy();
    expect(container.querySelector('[data-look="rev-feed"]')).toBeNull();
  });

  it("reads the worker's session, labels its messages with the view's name, and lets the view draw them", async () => {
    read.mockResolvedValue({ items: [item("a", "Looks good"), item("b", "One nit")], truncated: false });
    drawn([session(s1)]);
    expect((await screen.findAllByTestId("mine")).map((n) => n.textContent)).toEqual(["Looks good", "One nit"]);
    expect(read.mock.calls[0]![1]).toBe(s1);
    expect(screen.getAllByText("REVIEWER")).toHaveLength(2);
  });

  it("draws another worker's message as its own item under its sender's name, with a link to Messages, whatever the view draws", async () => {
    const received = {
      id: "m",
      requestId: "r",
      type: "component",
      component: RECEIVED_MESSAGE_COMPONENT,
      ts: Date.UTC(2026, 9, 7, 17, 33),
      data: { id: "msg_1", from: "eng.author", text: "the codename?", inReplyTo: "msg_0" },
    };
    read.mockResolvedValue({ items: [received, item("a", "BLUE-HERON")], truncated: false });
    drawn([session(s1)]);
    await screen.findAllByTestId("mine");
    // The view's renderItem draws its own messages, never another worker's.
    expect(screen.getAllByTestId("mine").map((n) => n.textContent)).toEqual(["BLUE-HERON"]);
    const drawnMessage = screen.getByTestId("received-message");
    expect(drawnMessage.textContent).toContain("ENG.AUTHOR");
    expect(drawnMessage.textContent).toContain("the codename?");
    expect(screen.getByTestId("received-message-answers")).toBeTruthy();
    expect(screen.getAllByTestId("received-message-messages")).toHaveLength(1);
    expect(screen.getAllByText("REVIEWER")).toHaveLength(1);
  });

  it("says the worker has the line while one from this page is in flight", () => {
    drawn([], { working: true });
    expect(screen.getByTestId("rev-working").textContent).toContain("Reviewer is working on it");
  });
});

describe("when a line may go", () => {
  it("holds it until a listed session has been read, then lets it through", async () => {
    let release!: (v: unknown) => void;
    read.mockReturnValue(new Promise((resolve) => (release = resolve)));
    drawn([session(s1)]);
    expect(screen.getByTestId("rev-composer-blocked").textContent).toBe("Reading the conversation first…");
    await act(async () => release({ items: [], truncated: false }));
    expect(screen.queryByTestId("rev-composer-blocked")).toBeNull();
  });

  it("sends nothing to a worker that takes no message, and says why", () => {
    drawn([], { worker: { id: "eng.reviewer", kind: "agent", door: null } as unknown as Worker });
    expect(screen.getByTestId("rev-composer-blocked").textContent).toContain("eng.reviewer");
  });

  it("sends nothing to a worker whose flow it can't name, since its session couldn't be opened", () => {
    drawn([], { worker: { id: "eng.reviewer", kind: null, door: "talk" } as unknown as Worker });
    expect(screen.getByTestId("rev-composer-blocked").textContent).toContain("eng.reviewer");
  });

  it("isn't another worker's conversation on the same flow", async () => {
    const theirs = { ...session("s9"), state: { workerId: "eng.author" } } as unknown as SessionSummary;
    drawn([theirs]);
    expect(await screen.findByTestId("rev-conversation-empty")).toBeTruthy();
    expect(read).not.toHaveBeenCalled();
  });

  it("holds it, and says why, when the conversation's address couldn't be worked out, rather than reading forever", async () => {
    drawn([], { worker: { id: UNHASHABLE, kind: "agent", door: "talk" } as unknown as Worker });
    await waitFor(() => expect(screen.getByTestId("rev-composer-blocked").textContent).toContain("didn't load"));
    expect(ensureWorkerSession).not.toHaveBeenCalled();
  });

  it("holds it when the conversation failed to load", async () => {
    read.mockRejectedValue(new Error("down"));
    drawn([session(s1)]);
    // The composer is blocked from the first render ("Reading the conversation first…"), so a
    // findByTestId would return before the failed read re-renders it; wait for the failure's text.
    await waitFor(() => expect(screen.getByTestId("rev-composer-blocked").textContent).toContain("didn't load"));
  });
});

describe("an open conversation", () => {
  afterEach(() => vi.useRealTimers());

  it("is read again every 5 s, so another worker's message shows without a line sent (FIX-1989)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    read.mockResolvedValueOnce({ items: [], truncated: false });
    read.mockResolvedValue({ items: [item("i1", "From eng.author: the build is green.")], truncated: false });
    drawn([session(s1)]);
    await act(async () => {});
    expect(read).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("mine")).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_999);
    });
    expect(read).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(read).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("mine").textContent).toBe("From eng.author: the build is green.");
  });

  it("keeps the last read on screen, and the composer open, when a later read fails", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    read.mockResolvedValueOnce({ items: [item("i1", "Shipped.")], truncated: false });
    read.mockRejectedValue(new Error("down"));
    drawn([session(s1)]);
    await act(async () => {});
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(read).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("mine").textContent).toBe("Shipped.");
    expect(screen.queryByTestId("rev-composer-blocked")).toBeNull();
  });

  it("sends nothing into a session the view draws read-only, and says why, whatever the worker", async () => {
    drawn([session(s1)], { readOnly: "This is a task's session. It is read here, not written to." });
    await act(async () => {});
    expect(screen.getByTestId("rev-composer-blocked").textContent).toBe("This is a task's session. It is read here, not written to.");
  });
});

describe("sending", () => {
  it("goes through the one send path, to the worker's door, into the session read", async () => {
    sendTurn.mockResolvedValue(delivered);
    drawn([session(s1)]);
    await send("ship it?");
    // To the worker's flow, never an address carrying the worker; the session names the worker.
    expect(sendTurn.mock.calls[0]![1]).toEqual({ sessionId: s1, flowId: "agent", door: "talk" });
    expect(ensureWorkerSession).not.toHaveBeenCalled();
    expect(sendTurn.mock.calls[0]![2]).toBe("ship it?");
  });

  it("reads the session back as soon as it holds the line, while the reply is still in flight", async () => {
    let finish!: () => void;
    sendTurn.mockImplementation(async (_c, _t, _m, opts: { onHeld: () => void }) => {
      opts.onHeld();
      await new Promise<void>((resolve) => (finish = resolve));
      return delivered;
    });
    drawn([session(s1)]);
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    await send("one more");
    // The read-back happened with the send still unresolved.
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId("rev-composer-status").getAttribute("data-state")).not.toBe("delivered");
    await act(async () => finish());
  });

  it("reads the Lab again and shows the reason when the door refuses, keeping the line", async () => {
    sendTurn.mockRejectedValue(new TurnNotDelivered("refused", "no thanks"));
    drawn([session(s1)]);
    await send("nope");
    expect(lab.refresh).toHaveBeenCalled();
    expect(screen.getByTestId("rev-composer-error").textContent).toContain("no thanks");
    expect((screen.getByTestId("rev-composer-input") as HTMLInputElement).value).toBe("nope");
  });

  it("starts a conversation with a first line at the worker's derived address, and a retry lands in the same session", async () => {
    sendTurn.mockRejectedValueOnce(new TurnNotDelivered("not-sent", "offline")).mockResolvedValue(delivered);
    drawn([]);
    await send("hello");
    await send("hello");
    const [first, second] = sendTurn.mock.calls.map((call) => (call[1] as { sessionId: string }).sessionId);
    // The address another worker's message lands in, so the user and the workers share one conversation.
    expect(first).toBe(s1);
    expect(second).toBe(first);
    // Opened through Workforce, naming the worker, before the door's request runs in it.
    expect(ensureWorkerSession.mock.calls[0]![0]).toEqual({ worker: "eng.reviewer" });
    expect(ensureWorkerSession.mock.invocationCallOrder[0]!).toBeLessThan(sendTurn.mock.invocationCallOrder[0]!);
  });

  it("isn't a session the user opened with the worker at any other id", async () => {
    drawn([session("conv_random")]);
    expect(await screen.findByTestId("rev-conversation-empty")).toBeTruthy();
    expect(read).not.toHaveBeenCalled();
  });

  it("sends a line handed in from elsewhere once, as if typed", async () => {
    sendTurn.mockResolvedValue(delivered);
    const taken = vi.fn();
    drawn([session(s1)], { autoSend: "from the palette", onAutoSend: taken });
    await waitFor(() => expect(sendTurn).toHaveBeenCalledTimes(1));
    expect(sendTurn.mock.calls[0]![2]).toBe("from the palette");
    expect(taken).toHaveBeenCalledTimes(1);
  });
});
