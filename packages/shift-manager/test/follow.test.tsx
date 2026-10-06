// @vitest-environment happy-dom
/**
 * A conversation keeps its latest turn in view while the person is at its
 * end, and leaves them where they are once they scroll up to read (FIX-1773).
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useFollowLatest } from "../src/lib/follow";

afterEach(() => cleanup());

const VIEW = 100;
const LINE = 40;

/** A feed of `lines` lines, sized as a browser would: each line 40px in a 100px view. */
function Feed({
  lines,
  startAtEnd,
  onFollow,
  onStay,
}: {
  lines: number;
  startAtEnd?: boolean;
  onFollow?: (follow: () => void) => void;
  onStay?: (stay: () => void) => void;
}) {
  const feed = useFollowLatest({ startAtEnd });
  onFollow?.(feed.follow);
  onStay?.(feed.stay);
  return (
    <div
      data-testid="feed"
      ref={(node) => {
        if (node !== null && !Object.getOwnPropertyDescriptor(node, "scrollHeight")) {
          let top = 0;
          Object.defineProperties(node, {
            clientHeight: { get: () => VIEW },
            scrollHeight: { get: () => node.querySelectorAll("p").length * LINE },
            scrollTop: { get: () => top, set: (v: number) => (top = Math.max(0, Math.min(v, node.scrollHeight - VIEW))) },
          });
        }
        feed.ref(node);
      }}
    >
      {Array.from({ length: lines }, (_, i) => (
        <p key={i}>line {i}</p>
      ))}
    </div>
  );
}

/** Let the MutationObserver's callback run. */
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

/** Scroll the feed to `top` as the person would. */
function scrollTo(top: number) {
  const feed = screen.getByTestId("feed");
  feed.scrollTop = top;
  feed.dispatchEvent(new Event("scroll"));
}

describe("following a conversation's latest turn", () => {
  it("opens at the end and follows each new line", async () => {
    const { rerender } = render(<Feed lines={5} />);
    await settle();
    const feed = screen.getByTestId("feed");
    expect(feed.scrollTop).toBe(5 * LINE - VIEW);
    rerender(<Feed lines={8} />);
    await settle();
    expect(feed.scrollTop).toBe(8 * LINE - VIEW);
  });

  it("stays where the person scrolled up to, and follows again once they are back at the end", async () => {
    const { rerender } = render(<Feed lines={5} />);
    await settle();
    const feed = screen.getByTestId("feed");
    scrollTo(0);
    rerender(<Feed lines={8} />);
    await settle();
    expect(feed.scrollTop).toBe(0);
    scrollTo(8 * LINE - VIEW);
    rerender(<Feed lines={10} />);
    await settle();
    expect(feed.scrollTop).toBe(10 * LINE - VIEW);
  });

  it("opened at the start, follows from the person's next line on", async () => {
    let follow!: () => void;
    const { rerender } = render(<Feed lines={5} startAtEnd={false} onFollow={(f) => (follow = f)} />);
    await settle();
    const feed = screen.getByTestId("feed");
    rerender(<Feed lines={6} startAtEnd={false} onFollow={(f) => (follow = f)} />);
    await settle();
    expect(feed.scrollTop).toBe(0);
    act(() => follow());
    rerender(<Feed lines={9} startAtEnd={false} onFollow={(f) => (follow = f)} />);
    await settle();
    expect(feed.scrollTop).toBe(9 * LINE - VIEW);
  });

  it("stays put when history is loaded above a feed that fit, rather than jumping past it", async () => {
    let stay!: () => void;
    const { rerender } = render(<Feed lines={2} onStay={(f) => (stay = f)} />);
    await settle();
    const feed = screen.getByTestId("feed");
    expect(feed.scrollTop).toBe(0);
    act(() => stay());
    rerender(<Feed lines={6} onStay={(f) => (stay = f)} />);
    await settle();
    expect(feed.scrollTop).toBe(0);
  });
});
