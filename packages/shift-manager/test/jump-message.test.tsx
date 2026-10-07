// @vitest-environment happy-dom
/**
 * Jump to turns into a message to the Shift Coordinator when the query starts
 * with `> `. It doesn't send: it hands the line to the Coordinator's own
 * composer, which sends it as if typed there, so the feed follows it and a
 * failure shows in the composer. A palette with no one to send to stays open.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TurnComposer } from "../src/components/TurnComposer";
import { TurnNotDelivered } from "../src/lib/send";
import type { LoadedSnapshot } from "../src/lib/derive";
import { clearHandedLine, handToChiefOfStaff, useHandedLine } from "../src/lib/outbox";
import { GAPS as gaps } from "../src/gaps";
import { JumpTo } from "../src/surfaces/JumpTo";

const withSeats = (seats: unknown[]) =>
  ({
    orgId: "org",
    sessions: [],
    boards: {},
    resources: { ok: true, value: [] },
    inventory: { ok: true, value: { workstreams: [], seats } },
  }) as unknown as LoadedSnapshot;
const snapshot = withSeats([{ id: "chief-of-staff", kind: "agent", door: "talk" }]);

afterEach(() => {
  cleanup();
  clearHandedLine();
});

const type = (value: string) => fireEvent.change(screen.getByTestId("jump-input"), { target: { value } });
const enter = () => fireEvent.keyDown(screen.getByTestId("jump-input"), { key: "Enter" });

/** The Coordinator's composer, wired as `Talk` wires it to the handed line. */
function Composer({ send, blocked = null }: { send: (message: string) => Promise<void>; blocked?: string | null }) {
  const handed = useHandedLine();
  return <TurnComposer testId="c" label="Message" placeholder="" blocked={blocked} send={send} autoSend={handed} onAutoSend={clearHandedLine} />;
}

describe("`> ` in Jump to messages the Shift Coordinator", () => {
  it("switches off the results, then hands the text after the prefix over and closes", () => {
    const onClose = vi.fn();
    render(<JumpTo snapshot={snapshot} gaps={gaps} onClose={onClose} />);
    type("> ship the release");
    expect(screen.getByTestId("jump-message")).toBeTruthy();
    expect(screen.queryAllByTestId("jump-result")).toHaveLength(0);
    enter();
    expect(onClose).toHaveBeenCalled();
    expect(window.location.pathname).toBe("/cos");
    cleanup();
    const send = vi.fn(async () => undefined);
    render(<Composer send={send} />);
    expect(send).toHaveBeenCalledWith("ship the release", expect.any(Function));
  });

  it("stays open with the reason when there is no Coordinator, and hands nothing over", () => {
    const onClose = vi.fn();
    render(<JumpTo snapshot={withSeats([])} gaps={gaps} onClose={onClose} />);
    type("> hello");
    enter();
    expect(screen.getByTestId("jump-message-failure")).toBeTruthy();
    expect((screen.getByTestId("jump-input") as HTMLInputElement).value).toBe("> hello");
    expect(onClose).not.toHaveBeenCalled();
    expect(useHandedLineNow()).toBeNull();
  });

  it("a plain query still searches, and a bare `>` hands nothing over", () => {
    render(<JumpTo snapshot={snapshot} gaps={gaps} onClose={() => undefined} />);
    type("chief");
    expect(screen.queryByTestId("jump-message")).toBeNull();
    type("> ");
    enter();
    expect(useHandedLineNow()).toBeNull();
  });
});

describe("the Coordinator's composer sends a handed line like a typed one", () => {
  it("waits until it isn't blocked, and sends once", async () => {
    const send = vi.fn(async () => undefined);
    handToChiefOfStaff("later");
    const view = render(<Composer send={send} blocked="Reading the conversation first…" />);
    expect(send).not.toHaveBeenCalled();
    view.rerender(<Composer send={send} />);
    await act(async () => undefined);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("later", expect.any(Function));
  });

  it("keeps the line in the draft, with the composer's own error, when it is refused", async () => {
    handToChiefOfStaff("nope");
    render(<Composer send={async () => Promise.reject(new TurnNotDelivered("refused", "no thanks"))} />);
    await act(async () => undefined);
    expect((screen.getByTestId("c-input") as HTMLInputElement).value).toBe("nope");
    expect(screen.getByTestId("c-error").textContent).toContain("no thanks");
  });
});

/** The held line, read outside React. */
function useHandedLineNow(): string | null {
  let line: string | null = null;
  const Probe = () => ((line = useHandedLine()), null);
  const { unmount } = render(<Probe />);
  unmount();
  return line;
}
