/**
 * The one scroll rule every app's conversation shares: new content never moves
 * the view, and the reader goes to the end when they ask to.
 *
 * - **New content stays below.** A reply streaming in, a card landing, a line
 *   from someone else: none of it scrolls the feed, even while the reader is at
 *   the end, because they may be reading. `atEnd` turns `false` instead, so the
 *   app can show a jump-to-latest button that calls {@link JumpToLatest.jump}.
 * - **Opening is not an animation.** A feed that opens, whether mounted, shown
 *   for a different conversation (`resetKey`), or filled by its first read, is
 *   already at its end on the first frame anyone sees.
 * - **Your own line goes to the end.** {@link JumpToLatest.sent} jumps there and
 *   brings the next content that lands below into view: the line just sent.
 */
import { useCallback, useLayoutEffect, useRef, useState } from "react";

/** How close to the end, in pixels, still counts as at the end. */
const AT_END_SLACK = 32;

export type JumpToLatestOptions = {
  /**
   * Open at the end (the default). `false` opens where the element starts, such
   * as a feed with a lead above its turns.
   */
  startAtEnd?: boolean;
  /**
   * What the feed shows, such as a session id. When it changes, a feed that
   * starts at the end opens at the end again, instantly, whatever the reader
   * had scrolled to in the last one. Replacing the scrolling element with the
   * same key leaves the reader where they were.
   */
  resetKey?: string | null;
};

export type JumpToLatest = {
  /** Attach to the scrolling element. */
  ref: (node: HTMLElement | null) => void;
  /** Whether the reader is at the end. `false` when there is more below: show the jump-to-latest button. */
  atEnd: boolean;
  /** To the end, smoothly. What the jump-to-latest button calls. */
  jump: () => void;
  /** The person sent a line: to the end, and the next content that lands below is brought into view too. */
  sent: () => void;
};

const distanceFromEnd = (el: HTMLElement) => el.scrollHeight - el.scrollTop - el.clientHeight;

/** Move `el` to its end. `scrollTo` where there is one, so `behavior` holds over a CSS `scroll-behavior`. */
function toEnd(el: HTMLElement, behavior: "instant" | "smooth") {
  if (typeof el.scrollTo === "function") el.scrollTo({ top: el.scrollHeight, behavior });
  else el.scrollTop = el.scrollHeight;
}

/**
 * Keep the scrolling element `ref` is attached to where the reader put it, and
 * offer the way to its end. See the module header for the rule.
 */
export function useJumpToLatest(options: JumpToLatestOptions = {}): JumpToLatest {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const startAtEnd = options.startAtEnd ?? true;
  const [atEnd, setAtEnd] = useState(true);
  // Until the feed first has something to scroll, and for the frame after, it is still opening:
  // what it reads lands at the end instantly. Only a feed that opens at the end opens.
  const opening = useRef(startAtEnd);
  const frame = useRef<number | undefined>(undefined);
  // Armed by `sent`: the next element that lands in the feed is brought into view, once.
  const bringNext = useRef(false);

  /** End the opening a frame after the feed overflows; a feed emptied before then, such as one switching conversations, keeps opening. */
  const closeOpening = useCallback((el: HTMLElement) => {
    if (el.scrollHeight <= el.clientHeight) {
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
      frame.current = undefined;
      return;
    }
    if (frame.current !== undefined) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = undefined;
      opening.current = false;
    });
  }, []);

  // Before paint, so the first frame of a feed that opens at the end is already there.
  useLayoutEffect(() => {
    if (node === null) return;
    /** `added`: the change put new elements in the feed, such as the line just sent. */
    const onChange = (added = false) => {
      const near = distanceFromEnd(node) <= AT_END_SLACK;
      if (opening.current) {
        toEnd(node, "instant");
        closeOpening(node);
        setAtEnd(true);
      } else if (bringNext.current) {
        // Waiting on the line just sent: the first change that adds an element to the feed is it.
        // Other changes, such as text or the feed's own arrow going away, leave the wait on.
        if (added) {
          bringNext.current = false;
          if (!near) toEnd(node, "smooth");
        }
        setAtEnd(true);
      } else {
        setAtEnd(near);
      }
    };
    onChange();

    let lastTop = node.scrollTop;
    const onScroll = () => {
      const near = distanceFromEnd(node) <= AT_END_SLACK;
      // Only scrolling up leaves the end: a smooth jump passes points far from the end on its way down.
      const up = node.scrollTop < lastTop;
      lastTop = node.scrollTop;
      if (near) setAtEnd(true);
      else if (up) {
        bringNext.current = false;
        setAtEnd(false);
      }
    };
    node.addEventListener("scroll", onScroll, { passive: true });

    // Content that grows without changing the tree, such as an image loading, and the view itself
    // resizing: the feed and each of its children, watched again as they are replaced.
    const sizes = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(() => onChange());
    const watchSizes = () => {
      sizes?.disconnect();
      sizes?.observe(node);
      for (const child of Array.from(node.children)) sizes?.observe(child);
    };
    watchSizes();
    const mutations = new MutationObserver((records) => {
      if (records.some((record) => record.target === node)) watchSizes();
      onChange(records.some((record) => Array.from(record.addedNodes).some((added) => added.nodeType === Node.ELEMENT_NODE)));
    });
    mutations.observe(node, { childList: true, subtree: true, characterData: true });
    return () => {
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
      frame.current = undefined;
      node.removeEventListener("scroll", onScroll);
      mutations.disconnect();
      sizes?.disconnect();
    };
  }, [node, closeOpening]);

  // A different thing shown opens at the end again; the same thing in a new element leaves the reader be.
  const shown = useRef(options.resetKey);
  useLayoutEffect(() => {
    if (shown.current === options.resetKey) return;
    shown.current = options.resetKey;
    if (!startAtEnd) return;
    opening.current = true;
    bringNext.current = false;
    setAtEnd(true);
    // Not closed here: what the element holds may still be the last conversation. The new one's content closes it.
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    frame.current = undefined;
    if (node !== null) toEnd(node, "instant");
  }, [options.resetKey, startAtEnd, node]);

  const jump = useCallback(() => {
    setAtEnd(true);
    if (node !== null) toEnd(node, "smooth");
  }, [node]);

  const sent = useCallback(() => {
    // No scrolling element yet, such as a view drawing an empty state until the first request:
    // it opens at its end when it mounts, which shows the line.
    if (node === null) {
      opening.current = true;
      return;
    }
    // A feed short enough never to have overflowed is still opening; the person writing in it ends that.
    opening.current = false;
    bringNext.current = true;
    jump();
  }, [node, jump]);

  return { ref: setNode, atEnd, jump, sent };
}
