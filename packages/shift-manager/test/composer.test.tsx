// @vitest-environment happy-dom
/**
 * The turn composer keeps what the user typed after they pressed Send. A send
 * that finishes clears the draft only if it is still the line that was sent.
 */
import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TurnComposer } from "../src/components/TurnComposer";
import { TurnNotDelivered } from "../src/lib/send";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

/** A promise and the function that settles it. */
function gate() {
  let open!: () => void;
  const done = new Promise<void>((resolve) => (open = resolve));
  return { done, open };
}

describe("a slow send keeps the next line typed while it ran", () => {
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

  it("points at Inbox only for a user's ask; any other stop reads as waiting, and no stop as plain delivered", async () => {
    expect(await sendAs("ask")).toMatch(/Delivered\..*in Inbox/);
    const wait = await sendAs("wait");
    expect(wait).toMatch(/Delivered\..*waiting/);
    expect(wait).not.toMatch(/Inbox/);
    expect(await sendAs(null)).toBe("Delivered.");
  });
});

describe("a send finishes under StrictMode (dev mounts every effect twice)", () => {
  it("clears the draft and says delivered", async () => {
    render(
      <StrictMode>
        <TurnComposer testId="turn" label="Message" placeholder="" blocked={null} send={async () => ({ stopped: null })} />
      </StrictMode>,
    );
    const input = screen.getByTestId("turn-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "a line" } });
    await act(async () => fireEvent.click(screen.getByTestId("turn-send")));
    expect(screen.getByTestId("turn-status").getAttribute("data-state")).toBe("delivered");
    expect(input.value).toBe("");
  });
});

describe("a reload keeps what was typed, and what may already have been sent (SM-ROB-8)", () => {
  const composer = (draftKey: string, send: () => Promise<void> = () => new Promise(() => {})) => (
    <TurnComposer testId="t" label="Message worker" placeholder="" blocked={null} draftKey={draftKey} send={send} />
  );

  it("brings a half-written line back to its own composer, and only there", () => {
    const first = render(composer("task:t-1"));
    fireEvent.change(screen.getByTestId("t-input"), { target: { value: "half an instruction" } });
    first.unmount();

    const again = render(composer("task:t-1"));
    expect((screen.getByTestId("t-input") as HTMLInputElement).value).toBe("half an instruction");
    again.unmount();
    render(composer("task:t-2"));
    expect((screen.getByTestId("t-input") as HTMLInputElement).value).toBe("");
  });

  it("brings an unconfirmed line back with its warning and no Retry, so a reload doesn't invite a second send", async () => {
    const first = render(composer("conversation:w-1", () => Promise.reject(new Error("the connection dropped"))));
    fireEvent.change(screen.getByTestId("t-input"), { target: { value: "ship it" } });
    await act(async () => fireEvent.click(screen.getByTestId("t-send")));
    expect(screen.getByTestId("t-status").getAttribute("data-state")).toBe("unconfirmed");
    first.unmount();

    render(composer("conversation:w-1"));
    expect((screen.getByTestId("t-input") as HTMLInputElement).value).toBe("ship it");
    expect(screen.getByTestId("t-status").getAttribute("data-state")).toBe("unconfirmed");
    expect(screen.getByTestId("t-error").textContent).toBe("the connection dropped");
    expect(screen.queryByTestId("t-retry")).toBeNull();
  });

  it("forgets the warning once a send lands", async () => {
    const first = render(composer("conversation:w-1", () => Promise.reject(new Error("the connection dropped"))));
    fireEvent.change(screen.getByTestId("t-input"), { target: { value: "ship it" } });
    await act(async () => fireEvent.click(screen.getByTestId("t-send")));
    first.unmount();

    const second = render(composer("conversation:w-1", () => Promise.resolve()));
    await act(async () => fireEvent.click(screen.getByTestId("t-send")));
    expect(screen.getByTestId("t-status").getAttribute("data-state")).toBe("delivered");
    second.unmount();
    render(composer("conversation:w-1"));
    expect((screen.getByTestId("t-input") as HTMLInputElement).value).toBe("");
    expect(screen.getByTestId("t-status").getAttribute("data-state")).not.toBe("unconfirmed");
  });
});
