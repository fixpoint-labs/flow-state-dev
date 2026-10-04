// @vitest-environment happy-dom
/**
 * The composers keep what the person typed after they pressed Send. A send
 * that finishes clears the draft only if it is still the line that was sent.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TurnComposer } from "../src/components/TurnComposer";
import { TurnNotDelivered } from "../src/lib/send";
import { Composer } from "../src/surfaces/Stream";
import type { BoardRow } from "../src/lib/reads";

afterEach(() => cleanup());

/** A promise and the function that settles it. */
function gate() {
  let open!: () => void;
  const done = new Promise<void>((resolve) => (open = resolve));
  return { done, open };
}

describe("a slow send keeps the next line typed while it ran", () => {
  it("the post composer: typing during a slow read-back is kept; an untouched draft is cleared", async () => {
    const readBack = gate();
    render(<Composer send={async () => undefined} onKept={() => readBack.done} />);
    const input = screen.getByTestId("composer-input") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "first line" } });
    act(() => fireEvent.click(screen.getByTestId("composer-send")));
    fireEvent.change(input, { target: { value: "the next line" } });
    await act(async () => {
      readBack.open();
      await readBack.done;
    });
    expect(input.value).toBe("the next line");

    const second = gate();
    cleanup();
    render(<Composer send={async () => undefined} onKept={() => second.done} />);
    const again = screen.getByTestId("composer-input") as HTMLTextAreaElement;
    fireEvent.change(again, { target: { value: "only line" } });
    act(() => fireEvent.click(screen.getByTestId("composer-send")));
    await act(async () => {
      second.open();
      await second.done;
    });
    expect(again.value).toBe("");
  });

  it("the turn composer: typing during a slow delivery is kept", async () => {
    const delivered = gate();
    render(<TurnComposer testId="turn" label="Message" placeholder="" blocked={null} send={() => delivered.done} />);
    const input = screen.getByTestId("turn-input") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "first message" } });
    act(() => fireEvent.click(screen.getByTestId("turn-send")));
    fireEvent.change(input, { target: { value: "the next message" } });
    await act(async () => {
      delivered.open();
      await delivered.done;
    });
    expect(input.value).toBe("the next message");
  });
});

describe("a line leaves the draft once the worker's session holds it (FIX-1773)", () => {
  it("clears before the send resolves, and puts the line back if it then fails", async () => {
    const reply = gate();
    const started = gate();
    let held!: () => void;
    render(
      <TurnComposer
        testId="t"
        label="Message worker"
        placeholder=""
        blocked={null}
        send={async (_message, onHeld) => {
          held = onHeld;
          started.open();
          await reply.done;
          throw new TurnNotDelivered("refused", "no thanks");
        }}
      />,
    );
    const input = screen.getByTestId("t-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "a line" } });
    act(() => fireEvent.click(screen.getByTestId("t-send")));
    await act(() => started.done);
    // Sent, not yet held: the draft stays.
    expect(input.value).toBe("a line");
    act(() => held());
    expect(input.value).toBe("");
    expect(screen.getByTestId("t-status").getAttribute("data-state")).toBe("held");
    await act(async () => {
      reply.open();
      await reply.done;
    });
    // The worker refused after the line left: it comes back, with the reason.
    expect(input.value).toBe("a line");
    expect(screen.getByTestId("t-error").textContent).toBe("no thanks");
  });
});

describe("a delivered line that stopped the worker says on what", () => {
  const sendAs = async (stopped: "ask" | "wait" | null) => {
    cleanup();
    render(<TurnComposer testId="turn" label="Message" placeholder="" blocked={null} send={async () => ({ stopped })} />);
    fireEvent.change(screen.getByTestId("turn-input"), { target: { value: "fire eng.coder" } });
    await act(async () => fireEvent.click(screen.getByTestId("turn-send")));
    const status = screen.getByTestId("turn-status");
    expect(status.getAttribute("data-state")).toBe("delivered");
    expect(screen.queryByTestId("turn-retry")).toBeNull();
    return status.textContent;
  };

  it("points at Inbox only for a person's ask; any other stop reads as waiting, and no stop as plain delivered", async () => {
    expect(await sendAs("ask")).toMatch(/Delivered\..*in Inbox/);
    const wait = await sendAs("wait");
    expect(wait).toMatch(/Delivered\..*waiting/);
    expect(wait).not.toMatch(/Inbox/);
    expect(await sendAs(null)).toBe("Delivered.");
  });

  it("the workstream composer's @worker line carries the same hint", async () => {
    const row = { id: "only-task", title: "the coder's one task" } as BoardRow;
    render(
      <Composer
        send={async () => undefined}
        onKept={async () => {}}
        mentions={["coder"]}
        addressing={() => ({ blocked: null, rows: [row], send: async () => ({ suspended: true, stopped: "ask" as const }) })}
      />,
    );
    fireEvent.change(screen.getByTestId("composer-input"), { target: { value: "@coder fire eng.helper" } });
    await act(async () => fireEvent.click(screen.getByTestId("composer-send")));
    expect(screen.getByTestId("composer-status").textContent).toMatch(/Delivered\..*in Inbox/);
  });
});
