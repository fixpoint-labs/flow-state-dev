// @vitest-environment happy-dom
/**
 * <Conversation> is the one way a view shows and sends into a conversation with
 * a seat. Drawn here as a view that isn't the Shift Coordinator's: another seat
 * and name, its own test ids, its own rendering of an item. The read and the
 * send are stood in for; what is checked is what the component does with them:
 * the session it reads and sends into, when it lets a line go, the read-back
 * while a reply is in flight, what a failed line leaves behind, and the retry
 * landing in the same session.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ClientHttpError, type SessionSummary } from "@flow-state-dev/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GAPS } from "../src/gaps";
import type { Seat } from "../src/lib/reads";
import { TurnNotDelivered } from "../src/lib/send";

const read = vi.fn();
const sendTurn = vi.fn();
const createSession = vi.fn();
// One object, as the provider hands one: a fresh `clients` each render would re-read forever.
const lab = { clients: { userId: "u_1", sessions: { createSession } }, refresh: vi.fn() };
vi.mock("../src/lib/lab-data", () => ({ useLab: () => lab }));
vi.mock("../src/lib/run", async (original) => ({ ...(await original<typeof import("../src/lib/run")>()), readSessionItems: (...a: unknown[]) => read(...a) }));
vi.mock("../src/lib/send", async (original) => ({ ...(await original<typeof import("../src/lib/send")>()), sendTurn: (...a: unknown[]) => sendTurn(...a) }));

import { Conversation } from "../src/components/Conversation";

// A worker on the shared `agent` flow: its sessions are that flow's, naming it as their worker.
const seat = { id: "eng.reviewer", kind: "agent", door: "talk" } as unknown as Seat;
const session = (id: string): SessionSummary =>
  ({ id, flowKind: "agent", flowId: "agent", state: { workerId: "eng.reviewer" }, createdAt: 1, parentSessionId: null }) as unknown as SessionSummary;
const item = (id: string, text: string) => ({ id, requestId: "r", type: "message", role: "assistant", ts: Date.UTC(2026, 9, 7, 17, 34), text });
const delivered = { requestId: "q", suspended: false, stopped: null };

beforeEach(() => {
  read.mockReset();
  sendTurn.mockReset();
  createSession.mockReset();
  createSession.mockResolvedValue({});
  lab.refresh.mockReset();
  read.mockResolvedValue({ items: [], truncated: false });
});
afterEach(() => cleanup());

const drawn = (sessions: SessionSummary[], over: Partial<Parameters<typeof Conversation>[0]> = {}) =>
  render(
    <Conversation
      seat={seat}
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
  it("says what it is before a first line, under that view's own ids", () => {
    drawn([]);
    expect(screen.getByTestId("rev-conversation-empty").textContent).toBe("Nothing said to the reviewer yet.");
    expect(screen.getByTestId("rev-composer")).toBeTruthy();
    expect(screen.queryByTestId("cos")).toBeNull();
  });

  it("keeps its look hooks the same whatever its test id, so one rule styles every conversation", () => {
    const { container } = drawn([]);
    expect(container.querySelector('[data-look="conversation-feed"]')).toBeTruthy();
    expect(container.querySelector('[data-look="rev-feed"]')).toBeNull();
  });

  it("reads the seat's session, labels its messages with the view's name, and lets the view draw them", async () => {
    read.mockResolvedValue({ items: [item("a", "Looks good"), item("b", "One nit")], truncated: false });
    drawn([session("s1")]);
    expect((await screen.findAllByTestId("mine")).map((n) => n.textContent)).toEqual(["Looks good", "One nit"]);
    expect(read.mock.calls[0]![1]).toBe("s1");
    expect(screen.getAllByText("REVIEWER")).toHaveLength(2);
  });

  it("says the seat has the line while one from this page is in flight", () => {
    drawn([], { working: true });
    expect(screen.getByTestId("rev-working").textContent).toContain("Reviewer is working on it");
  });
});

describe("when a line may go", () => {
  it("holds it until a listed session has been read, then lets it through", async () => {
    let release!: (v: unknown) => void;
    read.mockReturnValue(new Promise((resolve) => (release = resolve)));
    drawn([session("s1")]);
    expect(screen.getByTestId("rev-composer-blocked").textContent).toBe("Reading the conversation first…");
    await act(async () => release({ items: [], truncated: false }));
    expect(screen.queryByTestId("rev-composer-blocked")).toBeNull();
  });

  it("sends nothing to a seat that takes no message, and says why", () => {
    drawn([], { seat: { id: "eng.reviewer", kind: "agent", door: null } as unknown as Seat });
    expect(screen.getByTestId("rev-composer-blocked").textContent).toContain("eng.reviewer");
  });

  it("sends nothing to a worker whose flow it can't name, since its session couldn't be opened", () => {
    drawn([], { seat: { id: "eng.reviewer", kind: null, door: "talk" } as unknown as Seat });
    expect(screen.getByTestId("rev-composer-blocked").textContent).toContain("eng.reviewer");
  });

  it("isn't another worker's conversation on the same flow", async () => {
    const theirs = { ...session("s9"), state: { workerId: "eng.author" } } as unknown as SessionSummary;
    drawn([theirs]);
    expect(screen.getByTestId("rev-conversation-empty")).toBeTruthy();
    expect(read).not.toHaveBeenCalled();
  });

  it("holds it when the conversation failed to load", async () => {
    read.mockRejectedValue(new Error("down"));
    drawn([session("s1")]);
    expect((await screen.findByTestId("rev-composer-blocked")).textContent).toContain("didn't load");
  });
});

describe("sending", () => {
  it("goes through the one send path, to the seat's door, into the session read", async () => {
    sendTurn.mockResolvedValue(delivered);
    drawn([session("s1")]);
    await send("ship it?");
    // To the worker's flow, never an address carrying the worker; the session names the worker.
    expect(sendTurn.mock.calls[0]![1]).toEqual({ sessionId: "s1", flowId: "agent", door: "talk" });
    expect(createSession).not.toHaveBeenCalled();
    expect(sendTurn.mock.calls[0]![2]).toBe("ship it?");
  });

  it("reads the session back as soon as it holds the line, while the reply is still in flight", async () => {
    let finish!: () => void;
    sendTurn.mockImplementation(async (_c, _t, _m, opts: { onHeld: () => void }) => {
      opts.onHeld();
      await new Promise<void>((resolve) => (finish = resolve));
      return delivered;
    });
    drawn([session("s1")]);
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    await send("one more");
    // The read-back happened with the send still unresolved.
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId("rev-composer-status").getAttribute("data-state")).not.toBe("delivered");
    await act(async () => finish());
  });

  it("reads the Lab again and shows the reason when the door refuses, keeping the line", async () => {
    sendTurn.mockRejectedValue(new TurnNotDelivered("refused", "no thanks"));
    drawn([session("s1")]);
    await send("nope");
    expect(lab.refresh).toHaveBeenCalled();
    expect(screen.getByTestId("rev-composer-error").textContent).toContain("no thanks");
    expect((screen.getByTestId("rev-composer-input") as HTMLInputElement).value).toBe("nope");
  });

  it("starts a conversation with a first line, and a retry after it failed lands in the same session", async () => {
    sendTurn.mockRejectedValueOnce(new TurnNotDelivered("not-sent", "offline")).mockResolvedValue(delivered);
    // The retry finds the session the first attempt opened: the Lab answers 409, and the line still goes.
    createSession.mockResolvedValueOnce({}).mockRejectedValueOnce(new ClientHttpError("exists", { status: 409, body: null }));
    drawn([]);
    await send("hello");
    await send("hello");
    const [first, second] = sendTurn.mock.calls.map((call) => (call[1] as { sessionId: string }).sessionId);
    expect(first).toMatch(/^conv_[0-9a-f]{32}$/);
    // A new id here would orphan a session the Lab may already have opened.
    expect(second).toBe(first);
    // Opened naming the worker before the door's request runs in it: an action can't name one.
    expect(createSession.mock.calls[0]![0]).toEqual({ flowKind: "agent", userId: "u_1", sessionId: first, state: { workerId: "eng.reviewer" } });
    expect(createSession.mock.invocationCallOrder[0]!).toBeLessThan(sendTurn.mock.invocationCallOrder[0]!);
  });

  it("sends a line handed in from elsewhere once, as if typed", async () => {
    sendTurn.mockResolvedValue(delivered);
    const taken = vi.fn();
    drawn([session("s1")], { autoSend: "from the palette", onAutoSend: taken });
    await waitFor(() => expect(sendTurn).toHaveBeenCalledTimes(1));
    expect(sendTurn.mock.calls[0]![2]).toBe("from the palette");
    expect(taken).toHaveBeenCalledTimes(1);
  });
});
