// @vitest-environment happy-dom
/**
 * Jump to turns into a message to the Shift Coordinator when the query starts
 * with `> `: Enter sends the rest through the one send path, the palette closes
 * once the session holds the line, and a failed send keeps it open with the draft.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TurnNotDelivered } from "../src/lib/send";
import type { LoadedSnapshot } from "../src/lib/derive";
import { GAPS as gaps } from "../src/gaps";

const send = vi.fn();
vi.mock("../src/lib/cos", async (original) => ({ ...(await original<typeof import("../src/lib/cos")>()), sendToChiefOfStaff: (...args: unknown[]) => send(...args) }));
vi.mock("../src/lib/lab-data", () => ({ useLab: () => ({ clients: {}, refresh: vi.fn() }) }));

import { JumpTo } from "../src/surfaces/JumpTo";

const snapshot = {
  orgId: "org",
  sessions: [],
  boards: {},
  resources: { ok: true, value: [] },
  inventory: { ok: true, value: { workstreams: [], seats: [{ id: "chief-of-staff", kind: "agent", door: "talk" }] } },
} as unknown as LoadedSnapshot;

beforeEach(() => {
  send.mockReset();
});
afterEach(() => cleanup());

const type = (value: string) => fireEvent.change(screen.getByTestId("jump-input"), { target: { value } });
const enter = () => fireEvent.keyDown(screen.getByTestId("jump-input"), { key: "Enter" });

describe("`> ` in Jump to messages the Shift Coordinator", () => {
  it("switches off the results and sends the text after the prefix, then closes once the line is held", async () => {
    send.mockImplementation(async (_clients, _target, _message, onHeld: () => void) => {
      onHeld();
      return { requestId: "r", suspended: false, stopped: null };
    });
    const onClose = vi.fn();
    render(<JumpTo snapshot={snapshot} gaps={gaps} onClose={onClose} />);
    type("> ship the release");
    expect(screen.getByTestId("jump-message")).toBeTruthy();
    expect(screen.queryAllByTestId("jump-result")).toHaveLength(0);
    await act(async () => enter());
    expect(send.mock.calls[0]![1]).toMatchObject({ seatId: "chief-of-staff", door: "talk" });
    expect(send.mock.calls[0]![2]).toBe("ship the release");
    expect(onClose).toHaveBeenCalled();
  });

  it("a failed send stays open with the reason and the draft", async () => {
    send.mockRejectedValue(new TurnNotDelivered("refused", "no thanks"));
    const onClose = vi.fn();
    render(<JumpTo snapshot={snapshot} gaps={gaps} onClose={onClose} />);
    type("> hello");
    await act(async () => enter());
    expect(screen.getByTestId("jump-message-failure").textContent).toContain("no thanks");
    expect((screen.getByTestId("jump-input") as HTMLInputElement).value).toBe("> hello");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("a plain query still searches, and a bare `>` sends nothing", async () => {
    render(<JumpTo snapshot={snapshot} gaps={gaps} onClose={() => undefined} />);
    type("chief");
    expect(screen.queryByTestId("jump-message")).toBeNull();
    type("> ");
    await act(async () => enter());
    expect(send).not.toHaveBeenCalled();
  });
});
