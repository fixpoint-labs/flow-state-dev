// @vitest-environment happy-dom
/**
 * The composers keep what the person typed after they pressed Send. A send
 * that finishes clears the draft only if it is still the line that was sent.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TurnComposer } from "../src/components/TurnComposer";
import { Composer } from "../src/surfaces/Stream";

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
