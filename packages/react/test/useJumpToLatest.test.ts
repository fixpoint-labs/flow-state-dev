// @vitest-environment happy-dom
/**
 * New content never moves a conversation: the reader may be reading, at the
 * end or further up, and a reply streaming in used to drag them along. What
 * arrives below turns `atEnd` off so the app can offer a jump to it. Opening a
 * conversation still lands at its end, with nothing animating, and a line the
 * person sends takes them to the end with it.
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { useJumpToLatest, type JumpToLatest } from "../src/hooks/useJumpToLatest";

afterEach(() => {
  cleanup();
  moves.length = 0;
});

/** Every scroll the hook asked for, in order: how it moved, and where to. */
const moves: { behavior: ScrollBehavior | undefined; top: number }[] = [];

const VIEW = 100;
const LINE = 40;

/** What the hook last returned. */
let feed!: JumpToLatest;

/** A feed of `lines` lines, sized as a browser would: each line 40px in a 100px view. */
function Feed({
  lines,
  startAtEnd,
  resetKey,
  elementKey,
}: {
  lines: number;
  startAtEnd?: boolean;
  /** What the feed shows; a change is a different thing to open at the end of. */
  resetKey?: string;
  /** A new value replaces the scrolling element itself, with the same content. */
  elementKey?: string;
}) {
  feed = useJumpToLatest({ startAtEnd, resetKey });
  const ref = feed.ref;
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
            scrollHeight: { get: () => Math.max(VIEW, node.querySelectorAll("p").length * LINE) },
            scrollTop: { get: () => top, set: (v: number) => (top = Math.max(0, Math.min(v, node.scrollHeight - VIEW))) },
          });
          // A smooth scroll lands at once here: what the tests read is how it was asked for.
          node.scrollTo = ((options: ScrollToOptions) => {
            moves.push({ behavior: options.behavior, top: options.top ?? 0 });
            node.scrollTop = options.top ?? 0;
          }) as typeof node.scrollTo;
        }
        ref(node);
      },
    },
    Array.from({ length: lines }, (_, i) => createElement("p", { key: i }, `line ${i}`)),
  );
}

const feedElement = (props: Parameters<typeof Feed>[0]) => createElement(Feed, props);

/** Let the MutationObserver's callback run. */
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

/** Let a frame pass, as a browser paints one after the feed opened. */
const nextFrame = () => act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));

/** Scroll the feed to `top` as the user would. */
function scrollTo(top: number) {
  const el = screen.getByTestId("feed");
  act(() => {
    el.scrollTop = top;
    el.dispatchEvent(new Event("scroll"));
  });
}

/** Open a feed of `lines` lines and let it finish opening. */
async function opened(lines: number, props: Omit<Parameters<typeof Feed>[0], "lines"> = {}) {
  const rendered = render(feedElement({ lines, ...props }));
  await settle();
  await nextFrame();
  moves.length = 0;
  return rendered;
}

describe("new content in a conversation", () => {
  it("does not move a reader at the end when a line arrives, and offers the jump to it", async () => {
    const { rerender } = await opened(20);
    const el = screen.getByTestId("feed");
    expect(el.scrollTop).toBe(20 * LINE - VIEW);
    expect(feed.atEnd).toBe(true);
    rerender(feedElement({ lines: 21 }));
    await settle();
    expect(moves).toEqual([]);
    expect(el.scrollTop).toBe(20 * LINE - VIEW);
    expect(feed.atEnd).toBe(false);
  });

  it("does not move a reader who scrolled up when lines arrive", async () => {
    const { rerender } = await opened(20);
    scrollTo(100);
    expect(feed.atEnd).toBe(false);
    rerender(feedElement({ lines: 25 }));
    await settle();
    expect(moves).toEqual([]);
    expect(screen.getByTestId("feed").scrollTop).toBe(100);
  });

  it("jumps to the end smoothly when asked, and hides the jump there", async () => {
    const { rerender } = await opened(20);
    rerender(feedElement({ lines: 23 }));
    await settle();
    expect(feed.atEnd).toBe(false);
    act(() => feed.jump());
    expect(moves.at(-1)).toEqual({ behavior: "smooth", top: 23 * LINE });
    expect(screen.getByTestId("feed").scrollTop).toBe(23 * LINE - VIEW);
    expect(feed.atEnd).toBe(true);
    // Back at the end is no promise to follow: the next line still stays below.
    moves.length = 0;
    rerender(feedElement({ lines: 24 }));
    await settle();
    expect(moves).toEqual([]);
    expect(feed.atEnd).toBe(false);
  });

  it("counts the reader at the end again once they scroll back down to it", async () => {
    const { rerender } = await opened(20);
    rerender(feedElement({ lines: 22 }));
    await settle();
    expect(feed.atEnd).toBe(false);
    scrollTo(22 * LINE - VIEW);
    expect(feed.atEnd).toBe(true);
  });

  it("takes the person to the end when they send a line, and brings the line they sent into view", async () => {
    const { rerender } = await opened(20);
    scrollTo(0);
    act(() => feed.sent());
    expect(moves.at(-1)?.behavior).toBe("smooth");
    expect(screen.getByTestId("feed").scrollTop).toBe(20 * LINE - VIEW);
    // The sent line lands below the end it jumped to: brought in.
    rerender(feedElement({ lines: 21 }));
    await settle();
    expect(screen.getByTestId("feed").scrollTop).toBe(21 * LINE - VIEW);
    expect(feed.atEnd).toBe(true);
    // Then the reply: it stays below.
    moves.length = 0;
    rerender(feedElement({ lines: 23 }));
    await settle();
    expect(moves).toEqual([]);
    expect(feed.atEnd).toBe(false);
  });

  it("counts a sent line that lands already in view as brought in: the reply after it stays below", async () => {
    const { rerender } = await opened(1);
    act(() => feed.sent());
    rerender(feedElement({ lines: 2 }));
    await settle();
    moves.length = 0;
    rerender(feedElement({ lines: 5 }));
    await settle();
    expect(moves).toEqual([]);
    expect(screen.getByTestId("feed").scrollTop).toBe(0);
    expect(feed.atEnd).toBe(false);
  });

  it("forgets the line it was to bring in once the reader scrolls up to read", async () => {
    const { rerender } = await opened(20);
    act(() => feed.sent());
    scrollTo(100);
    moves.length = 0;
    rerender(feedElement({ lines: 21 }));
    await settle();
    expect(moves).toEqual([]);
    expect(screen.getByTestId("feed").scrollTop).toBe(100);
  });
});

describe("opening a conversation", () => {
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
    const { rerender } = await opened(20, { resetKey: "a" });
    scrollTo(0);
    rerender(feedElement({ lines: 30, resetKey: "b" }));
    await settle();
    expect(screen.getByTestId("feed").scrollTop).toBe(30 * LINE - VIEW);
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.every((m) => m.behavior === "instant")).toBe(true);
    expect(feed.atEnd).toBe(true);
    // Opened, the new conversation keeps the rule: what arrives stays below.
    await nextFrame();
    moves.length = 0;
    rerender(feedElement({ lines: 31, resetKey: "b" }));
    await settle();
    expect(moves).toEqual([]);
  });

  it("opens at the end of a conversation switched to that loads after the switch, even a frame or more later", async () => {
    const { rerender } = await opened(20, { resetKey: "a" });
    // The key moves while the old lines are still shown; then the feed empties while the new one is read.
    rerender(feedElement({ lines: 20, resetKey: "b" }));
    await settle();
    rerender(feedElement({ lines: 0, resetKey: "b" }));
    await settle();
    await nextFrame();
    await nextFrame();
    rerender(feedElement({ lines: 30, resetKey: "b" }));
    await settle();
    expect(screen.getByTestId("feed").scrollTop).toBe(30 * LINE - VIEW);
    expect(moves.every((m) => m.behavior === "instant")).toBe(true);
  });

  it("leaves a user who scrolled up where they are when only the scrolling element is replaced", async () => {
    const { rerender } = await opened(5, { resetKey: "a", elementKey: "one" });
    scrollTo(0);
    rerender(feedElement({ lines: 5, resetKey: "a", elementKey: "two" }));
    await settle();
    expect(screen.getByTestId("feed").scrollTop).toBe(0);
  });

  it("opened at the start, stays there as lines arrive, and goes to the end with the person's own line", async () => {
    const { rerender } = await opened(5, { startAtEnd: false });
    const el = screen.getByTestId("feed");
    expect(el.scrollTop).toBe(0);
    rerender(feedElement({ lines: 6, startAtEnd: false }));
    await settle();
    expect(el.scrollTop).toBe(0);
    act(() => feed.sent());
    rerender(feedElement({ lines: 7, startAtEnd: false }));
    await settle();
    expect(el.scrollTop).toBe(7 * LINE - VIEW);
  });

  it("does not open at the end for a changed key when it opens at the start", async () => {
    const { rerender } = await opened(5, { startAtEnd: false, resetKey: "a" });
    rerender(feedElement({ lines: 7, startAtEnd: false, resetKey: "b" }));
    await settle();
    expect(screen.getByTestId("feed").scrollTop).toBe(0);
  });
});
