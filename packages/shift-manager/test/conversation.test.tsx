// @vitest-environment happy-dom
/**
 * <Conversation> is the one way a view shows and sends into a conversation with
 * a seat. Drawn here as a view that isn't the Shift Coordinator's: another seat
 * and name, its own test ids, its own rendering of an item. The read and the
 * send are stood in for; what is checked is what the component does with them.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { SessionSummary } from "@flow-state-dev/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GAPS } from "../src/gaps";
import type { Seat } from "../src/lib/reads";

const read = vi.fn();
const sendTurn = vi.fn();
// One object, as the provider hands one: a fresh `clients` each render would re-read forever.
const lab = { clients: {}, refresh: vi.fn() };
vi.mock("../src/lib/lab-data", () => ({ useLab: () => lab }));
vi.mock("../src/lib/run", async (original) => ({ ...(await original<typeof import("../src/lib/run")>()), readSessionItems: (...a: unknown[]) => read(...a) }));
vi.mock("../src/lib/send", async (original) => ({ ...(await original<typeof import("../src/lib/send")>()), sendTurn: (...a: unknown[]) => sendTurn(...a) }));

import { Conversation } from "../src/components/Conversation";

const seat = { id: "eng.reviewer", door: "talk" } as unknown as Seat;
const session = (id: string): SessionSummary => ({ id, flowId: "eng.reviewer", createdAt: 1, parentSessionId: null }) as unknown as SessionSummary;
const item = (id: string, text: string) => ({ id, requestId: "r", type: "message", role: "assistant", ts: Date.UTC(2026, 9, 7, 17, 34), text });

beforeEach(() => {
  read.mockReset();
  sendTurn.mockReset();
});
afterEach(() => cleanup());

const drawn = (sessions: SessionSummary[], seatOver: Seat = seat) =>
  render(
    <Conversation
      seat={seatOver}
      sessions={sessions}
      gaps={GAPS}
      name="Reviewer"
      testId="rev"
      emptyText="Nothing said to the reviewer yet."
      renderItem={(it) => <span data-testid="mine">{(it as unknown as { text: string }).text}</span>}
    />,
  );

describe("a conversation drawn by a view of its own", () => {
  it("says what it is before a first line, under that view's own ids", () => {
    drawn([]);
    expect(screen.getByTestId("rev-conversation-empty").textContent).toBe("Nothing said to the reviewer yet.");
    expect(screen.getByTestId("rev-composer")).toBeTruthy();
    expect(screen.queryByTestId("cos")).toBeNull();
  });

  it("reads the seat's session, labels its messages with the view's name, and lets the view draw them", async () => {
    read.mockResolvedValue({ items: [item("a", "Looks good"), item("b", "One nit")], truncated: false });
    drawn([session("s1")]);
    expect((await screen.findAllByTestId("mine")).map((n) => n.textContent)).toEqual(["Looks good", "One nit"]);
    expect(read.mock.calls[0]![1]).toBe("s1");
    expect(screen.getAllByText("REVIEWER")).toHaveLength(2);
  });

  it("sends a typed line through the one send path, to the seat's door, once the session is read", async () => {
    read.mockResolvedValue({ items: [], truncated: false });
    sendTurn.mockResolvedValue({ requestId: "q", suspended: false, stopped: null });
    drawn([session("s1")]);
    const input = (await screen.findByTestId("rev-composer-input")) as HTMLInputElement;
    await act(async () => {});
    fireEvent.change(input, { target: { value: "ship it?" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("rev-composer-send"));
    });
    expect(sendTurn.mock.calls[0]![1]).toEqual({ sessionId: "s1", flowId: "eng.reviewer", door: "talk" });
    expect(sendTurn.mock.calls[0]![2]).toBe("ship it?");
  });

  it("sends nothing to a seat that takes no message, and says why", () => {
    drawn([], { id: "eng.reviewer", door: null } as unknown as Seat);
    expect(screen.getByTestId("rev-composer-blocked").textContent).toContain("eng.reviewer");
  });
});
