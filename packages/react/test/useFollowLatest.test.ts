// @vitest-environment happy-dom
/**
 * A conversation keeps its latest turn in view while the user is at its
 * end, and leaves them where they are once they scroll up to read. Opening
 * one never animates: every app's session switch used to scroll visibly from
 * the top down to the end. Only what arrives live, at the end, glides.
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { useFollowLatest } from "../src/hooks/useFollowLatest";

afterEach(() => {
  cleanup();
  moves.length = 0;
});

/** Every scroll the hook asked for, in order: how it moved, and where to. */
const moves: { behavior: ScrollBehavior | undefined; top: number }[] = [];

const VIEW = 100;
const LINE = 40;

/** A feed of `lines` lines, sized as a browser would: each line 40px in a 100px view. */
function Feed({
  lines,
  startAtEnd,
  resetKey,
  elementKey,
  onFollow,
  onStay,
  onAtEnd,
}: {
  lines: number;
  startAtEnd?: boolean;
  /** What the feed shows; a change is a different thing to open at the end of. */
  resetKey?: string;
  /** A new value replaces the scrolling element itself, with the same content. */
  elementKey?: string;
  onFollow?: (follow: () => void) => void;
  onStay?: (stay: () => void) => void;
  onAtEnd?: (atEnd: boolean) => void;
}) {
  const feed = useFollowLatest({ startAtEnd, resetKey });
  onFollow?.(feed.follow);
  onAtEnd?.(feed.atEnd);
  onStay?.(feed.stay);
  return createElement(
    "div",
    {
      key: elementKey,
      "data-testid": "feed",
      ref: (node: HTMLDivElement | null) => {
        if (node !== null && !Object.getOwnPropertyDescriptor(node, "scrollHeight")) {
          let top = 0;
          Object.defineProperties(node, {
            clientHeight: { get: () => VIEW },
            scrollHeight: { get: () => node.querySelectorAll("p").length * LINE },
            scrollTop: { get: () => top, set: (v: number) => (top = Math.max(0, Math.min(v, node.scrollHeight - VIEW))) },
          });
          // A smooth scroll lands at once here: what the tests read is how it was asked for.
          node.scrollTo = ((options: ScrollToOptions) => {
            moves.push({ behavior: options.behavior, top: options.top ?? 0 });
            node.scrollTop = options.top ?? 0;
          }) as typeof node.scrollTo;
        }
        feed.ref(node);
      },
    },
    Array.from({ length: lines }, (_, i) => createElement("p", { key: i }, `line ${i}`)),
  );
}

type FeedProps = Parameters<typeof Feed>[0];
const feedElement = (props: FeedProps) => createElement(Feed, props);

/** Let the MutationObserver's callback run. */
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

/** Let a frame pass, as a browser paints one after the feed opened. */
const nextFrame = () => act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));

/** Scroll the feed to `top` as the user would. */
function scrollTo(top: number) {
  const feed = screen.getByTestId("feed");
  feed.scrollTop = top;
  feed.dispatchEvent(new Event("scroll"));
}

describe("following a conversation's latest turn", () => {
  it("opens at the end and follows each new line", async () => {
    const { rerender } = render(feedElement({ lines: 5 }));
    await settle();
    const feed = screen.getByTestId("feed");
    expect(feed.scrollTop).toBe(5 * LINE - VIEW);
    rerender(feedElement({ lines: 8 }));
    await settle();
    expect(feed.scrollTop).toBe(8 * LINE - VIEW);
  });

  it("stays where the user scrolled up to, and follows again once they are back at the end", async () => {
    const { rerender } = render(feedElement({ lines: 5 }));
    await settle();
    const feed = screen.getByTestId("feed");
    scrollTo(0);
    rerender(feedElement({ lines: 8 }));
    await settle();
    expect(feed.scrollTop).toBe(0);
    scrollTo(8 * LINE - VIEW);
    rerender(feedElement({ lines: 10 }));
    await settle();
    expect(feed.scrollTop).toBe(10 * LINE - VIEW);
  });

  it("opened at the start, follows from the user's next line on", async () => {
    let follow!: () => void;
    const { rerender } = render(feedElement({ lines: 5, startAtEnd: false, onFollow: (f) => (follow = f) }));
    await settle();
    const feed = screen.getByTestId("feed");
    rerender(feedElement({ lines: 6, startAtEnd: false, onFollow: (f) => (follow = f) }));
    await settle();
    expect(feed.scrollTop).toBe(0);
    act(() => follow());
    rerender(feedElement({ lines: 9, startAtEnd: false, onFollow: (f) => (follow = f) }));
    await settle();
    expect(feed.scrollTop).toBe(9 * LINE - VIEW);
  });

  it("opens at the end again when what it shows changes, even from where the user had scrolled up to", async () => {
    const { rerender } = render(feedElement({ lines: 5, resetKey: "a" }));
    await settle();
    scrollTo(0);
    rerender(feedElement({ lines: 5, resetKey: "a" }));
    await settle();
    expect(screen.getByTestId("feed").scrollTop).toBe(0);
    rerender(feedElement({ lines: 7, resetKey: "b" }));
    await settle();
    expect(screen.getByTestId("feed").scrollTop).toBe(7 * LINE - VIEW);
  });

  it("leaves a user who scrolled up where they are when only the scrolling element is replaced", async () => {
    const { rerender } = render(feedElement({ lines: 5, resetKey: "a", elementKey: "one" }));
    await settle();
    scrollTo(0);
    rerender(feedElement({ lines: 5, resetKey: "a", elementKey: "two" }));
    await settle();
    expect(screen.getByTestId("feed").scrollTop).toBe(0);
  });

  it("does not follow a changed key when it opens at the start", async () => {
    const { rerender } = render(feedElement({ lines: 5, startAtEnd: false, resetKey: "a" }));
    await settle();
    rerender(feedElement({ lines: 7, startAtEnd: false, resetKey: "b" }));
    await settle();
    expect(screen.getByTestId("feed").scrollTop).toBe(0);
  });

  it("stays put when history is loaded above a feed that fit, rather than jumping past it", async () => {
    let stay!: () => void;
    const { rerender } = render(feedElement({ lines: 2, onStay: (f) => (stay = f) }));
    await settle();
    const feed = screen.getByTestId("feed");
    expect(feed.scrollTop).toBe(0);
    act(() => stay());
    rerender(feedElement({ lines: 6, onStay: (f) => (stay = f) }));
    await settle();
    expect(feed.scrollTop).toBe(0);
  });
});

describe("opening a conversation, and what arrives in it after", () => {
  it("opens already at the end: nothing animates on mount", async () => {
    render(feedElement({ lines: 20 }));
    await settle();
    expect(screen.getByTestId("feed").scrollTop).toBe(20 * LINE - VIEW);
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.every((m) => m.behavior === "instant")).toBe(true);
  });

  it("lands a first read that fills an empty feed at the end at once, not gliding down from the top", async () => {
    const { rerender } = render(feedElement({ lines: 0 }));
    await settle();
    rerender(feedElement({ lines: 20 }));
    await settle();
    expect(screen.getByTestId("feed").scrollTop).toBe(20 * LINE - VIEW);
    expect(moves.every((m) => m.behavior === "instant")).toBe(true);
  });

  it("switches to another conversation already at its end, even from a reader scrolled up in the last one", async () => {
    const { rerender } = render(feedElement({ lines: 20, resetKey: "a" }));
    await settle();
    await nextFrame();
    scrollTo(0);
    moves.length = 0;
    rerender(feedElement({ lines: 30, resetKey: "b" }));
    await settle();
    expect(screen.getByTestId("feed").scrollTop).toBe(30 * LINE - VIEW);
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.every((m) => m.behavior === "instant")).toBe(true);
  });

  it("glides to a line that arrives live while the reader is at the end", async () => {
    const { rerender } = render(feedElement({ lines: 20 }));
    await settle();
    await nextFrame();
    moves.length = 0;
    rerender(feedElement({ lines: 21 }));
    await settle();
    expect(screen.getByTestId("feed").scrollTop).toBe(21 * LINE - VIEW);
    expect(moves.at(-1)).toEqual({ behavior: "smooth", top: 21 * LINE });
  });

  it("does not move a reader who scrolled up when a line arrives, and offers the way back", async () => {
    let follow!: () => void;
    const { rerender, result } = renderWithState(20, (f) => (follow = f));
    await settle();
    await nextFrame();
    scrollTo(100);
    moves.length = 0;
    rerender(probeElement({ lines: 21, onFollow: (f) => (follow = f) }));
    await settle();
    expect(moves).toEqual([]);
    expect(screen.getByTestId("feed").scrollTop).toBe(100);
    expect(result().atEnd).toBe(false);
    act(() => follow());
    expect(moves.at(-1)?.behavior).toBe("smooth");
    expect(result().atEnd).toBe(true);
  });
});

/** The feed, reporting what the hook says about it. */
let lastAtEnd: boolean | undefined;
function Probe({ lines, onFollow }: { lines: number; onFollow: (follow: () => void) => void }) {
  return feedElement({ lines, onFollow, onAtEnd: (atEnd) => (lastAtEnd = atEnd) });
}
const probeElement = (props: Parameters<typeof Probe>[0]) => createElement(Probe, props);
function renderWithState(lines: number, onFollow: (follow: () => void) => void) {
  const rendered = render(probeElement({ lines, onFollow }));
  return { ...rendered, result: () => ({ atEnd: lastAtEnd }) };
}
