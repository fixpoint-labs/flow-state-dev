// @vitest-environment happy-dom
/**
 * New content never moves a conversation: the reader may be reading, at the
 * end or further up, and a reply streaming in used to drag them along. What
 * arrives below turns `atEnd` off so the app can offer a jump to it. Opening a
 * conversation still lands at its end, with nothing animating. A line the
 * person sends rises to near the top, with room kept under it, so its reply
 * streams in where they can read it instead of below the fold.
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
  mine = [],
  status,
}: {
  lines: number;
  /** The lines, by index, that are the person's own: marked with {@link JumpToLatest.mine}. */
  mine?: number[];
  /** A line that isn't anyone's, drawn last, such as "… is answering". */
  status?: boolean;
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
      ref: (node: HTMLDivElement | null) => ref(node && layOut(node)),
    },
    ...Array.from({ length: lines }, (_, i) => createElement("p", { key: i, ...(mine.includes(i) ? feed.mine(`line ${i}`) : {}) }, `line ${i}`)),
    status ? createElement("p", { key: "status" }, "answering") : null,
  );
}

/** Size `node` as a browser would: each `p` 40px in a 100px view. Every scroll it is asked for is recorded. */
function layOut(node: HTMLElement): HTMLElement {
  if (Object.getOwnPropertyDescriptor(node, "scrollHeight")) return node;
  let top = 0;
  Object.defineProperties(node, {
    clientHeight: { get: () => VIEW },
    scrollHeight: { get: () => Math.max(VIEW, node.querySelectorAll("p").length * LINE + room(node)) },
    scrollTop: { get: () => top, set: (v: number) => (top = Math.max(0, Math.min(v, node.scrollHeight - VIEW))) },
  });
  // A smooth scroll lands at once here: what the tests read is how it was asked for.
  node.scrollTo = ((options: ScrollToOptions) => {
    moves.push({ behavior: options.behavior, top: options.top ?? 0 });
    node.scrollTop = options.top ?? 0;
  }) as typeof node.scrollTo;
  return node;
}

/** The space the hook keeps below the last line, as the bottom padding it set. */
const room = (node: HTMLElement) => Number.parseFloat(node.style.paddingBottom) || 0;

// Each line's box, as a browser lays it out: 40px tall, stacked, moved up by the feed's scroll. The feed's own top is 0.
HTMLParagraphElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
  const feedNode = this.parentElement!;
  const top = Array.from(feedNode.querySelectorAll("p")).indexOf(this as HTMLParagraphElement) * LINE - feedNode.scrollTop;
  return { top, bottom: top + LINE, left: 0, right: 100, width: 100, height: LINE, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
};

/** Where line `i`'s top sits below the feed's top edge, in pixels. */
const lineTop = (i: number) => screen.getByText(`line ${i}`).getBoundingClientRect().top;

/** The person turns the wheel over the feed, then the feed scrolls to `top`. */
function wheelTo(top: number) {
  const el = screen.getByTestId("feed");
  act(() => {
    el.dispatchEvent(new Event("wheel"));
    el.scrollTop = top;
    el.dispatchEvent(new Event("scroll"));
  });
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
    expect(moves.at(-1)).toEqual({ behavior: "smooth", top: 23 * LINE - VIEW });
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
});

/** The line's top is near the feed's top: below the edge, by no more than the goal check's 48px. */
const nearTop = (i: number) => {
  const top = lineTop(i);
  return top >= 0 && top <= 48;
};

describe("sending a line", () => {
  it("brings the line the person sent near the top, wherever they had scrolled to, and keeps room under a short reply", async () => {
    const { rerender } = await opened(20);
    scrollTo(0);
    act(() => feed.sent());
    rerender(feedElement({ lines: 21, mine: [20] }));
    await settle();
    expect(moves.at(-1)?.behavior).toBe("smooth");
    expect(nearTop(20)).toBe(true);
    // A reply shorter than the view: the line stays where it rose to, and the room under the reply is not "more below".
    moves.length = 0;
    rerender(feedElement({ lines: 22, mine: [20] }));
    await settle();
    expect(moves).toEqual([]);
    expect(nearTop(20)).toBe(true);
    expect(feed.atEnd).toBe(true);
  });

  it("does not move as the reply grows past the bottom edge, and offers the jump to it", async () => {
    const { rerender } = await opened(20);
    act(() => feed.sent());
    rerender(feedElement({ lines: 21, mine: [20] }));
    await settle();
    const top = screen.getByTestId("feed").scrollTop;
    moves.length = 0;
    rerender(feedElement({ lines: 30, mine: [20] }));
    await settle();
    expect(moves).toEqual([]);
    expect(screen.getByTestId("feed").scrollTop).toBe(top);
    expect(feed.atEnd).toBe(false);
  });

  it("jumps to the reply's end, not into the room kept under it", async () => {
    const { rerender } = await opened(20);
    act(() => feed.sent());
    rerender(feedElement({ lines: 21, mine: [20] }));
    await settle();
    // No reply yet: all that is under the line is the room.
    act(() => feed.jump());
    // The last line's bottom is the view's bottom.
    expect(lineTop(20) + LINE).toBe(VIEW);
    expect(feed.atEnd).toBe(true);
  });

  it("brings up the person's line, not a status row drawn before it", async () => {
    const { rerender } = await opened(20);
    act(() => feed.sent());
    rerender(feedElement({ lines: 20, status: true }));
    await settle();
    expect(moves).toEqual([]);
    rerender(feedElement({ lines: 21, mine: [20], status: true }));
    await settle();
    expect(nearTop(20)).toBe(true);
  });

  it("brings up a line already drawn when the send is learned of after it, as an effect does", async () => {
    const { rerender } = await opened(20);
    rerender(feedElement({ lines: 21, mine: [20] }));
    act(() => feed.sent());
    await settle();
    expect(nearTop(20)).toBe(true);
  });

  it("does not bring up an earlier line of the person's that was already on screen", async () => {
    const { rerender } = await opened(21, { mine: [10] });
    scrollTo(0);
    act(() => feed.sent());
    await settle();
    await nextFrame();
    expect(moves).toEqual([]);
    rerender(feedElement({ lines: 22, mine: [10, 21] }));
    await settle();
    expect(nearTop(21)).toBe(true);
  });

  it("does not move once the person scrolls, down as well as up, before the line lands", async () => {
    const { rerender } = await opened(20);
    scrollTo(0);
    act(() => feed.sent());
    wheelTo(200);
    moves.length = 0;
    rerender(feedElement({ lines: 21, mine: [20] }));
    await settle();
    expect(moves).toEqual([]);
    expect(screen.getByTestId("feed").scrollTop).toBe(200);
  });

  it("counts a scroll the person makes with the wheel as theirs: the view is no longer at the end", async () => {
    const { rerender } = await opened(20);
    act(() => feed.sent());
    rerender(feedElement({ lines: 21, mine: [20] }));
    await settle();
    wheelTo(0);
    expect(feed.atEnd).toBe(false);
  });

  it("shows the line sent before the feed existed, once the feed mounts with it", async () => {
    // An empty state in place of the feed until the first request: the hook runs, the element doesn't.
    function Late({ lines }: { lines: number }) {
      feed = useJumpToLatest();
      if (lines === 0) return createElement("span", null, "nothing yet");
      return createElement(
        "div",
        { "data-testid": "feed", ref: (node: HTMLDivElement | null) => feed.ref(node && layOut(node)) },
        Array.from({ length: lines }, (_, i) => createElement("p", { key: i }, `line ${i}`)),
      );
    }
    const { rerender } = render(createElement(Late, { lines: 0 }));
    act(() => feed.sent());
    rerender(createElement(Late, { lines: 30 }));
    await settle();
    expect(screen.getByTestId("feed").scrollTop).toBe(30 * LINE - VIEW);
  });

  it("drops the room on switching to another conversation, which opens at its end", async () => {
    const { rerender } = await opened(20, { resetKey: "a" });
    act(() => feed.sent());
    rerender(feedElement({ lines: 21, mine: [20], resetKey: "a" }));
    await settle();
    moves.length = 0;
    rerender(feedElement({ lines: 30, resetKey: "b" }));
    await settle();
    expect(screen.getByTestId("feed").style.paddingBottom).toBe("");
    expect(screen.getByTestId("feed").scrollTop).toBe(30 * LINE - VIEW);
    expect(moves.every((m) => m.behavior === "instant")).toBe(true);
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

  it("opened at the start, stays there as lines arrive, and brings the person's own line near the top", async () => {
    const { rerender } = await opened(5, { startAtEnd: false });
    const el = screen.getByTestId("feed");
    expect(el.scrollTop).toBe(0);
    rerender(feedElement({ lines: 6, startAtEnd: false }));
    await settle();
    expect(el.scrollTop).toBe(0);
    act(() => feed.sent());
    rerender(feedElement({ lines: 7, startAtEnd: false, mine: [6] }));
    await settle();
    expect(nearTop(6)).toBe(true);
  });

  it("does not open at the end for a changed key when it opens at the start", async () => {
    const { rerender } = await opened(5, { startAtEnd: false, resetKey: "a" });
    rerender(feedElement({ lines: 7, startAtEnd: false, resetKey: "b" }));
    await settle();
    expect(screen.getByTestId("feed").scrollTop).toBe(0);
  });
});
