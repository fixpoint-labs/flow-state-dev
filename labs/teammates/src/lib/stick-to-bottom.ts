/**
 * Follow a scrolling list's newest content only while the reader is at its
 * end. Scrolled up to read, the list stays put as content arrives below, and
 * `atEnd` is false so the screen can offer a way back. It scrolls the list
 * itself, smoothly, never an ancestor (`scrollIntoView` would move those too).
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

/** How close to the end, in px, still counts as at the end. */
const NEAR_END_PX = 80;

const distanceFromEnd = (el: HTMLElement) => el.scrollHeight - el.scrollTop - el.clientHeight;

/**
 * Stick `scroller` to its end while the reader is there. `content` is any value
 * that changes when what is drawn changes (a streamed answer growing included);
 * a resize of the list's content follows too.
 */
export function useStickToBottom(scroller: RefObject<HTMLElement | null>, content: unknown) {
  const [atEnd, setAtEnd] = useState(true);
  const following = useRef(true);

  const toEnd = useCallback(
    (behavior: ScrollBehavior) => {
      const el = scroller.current;
      if (el) el.scrollTo?.({ top: el.scrollHeight, behavior });
    },
    [scroller],
  );

  // The reader's own scrolling decides whether the list follows.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let lastTop = el.scrollTop;
    const onScroll = () => {
      const near = distanceFromEnd(el) <= NEAR_END_PX;
      // Only scrolling up lets go: a smooth follow passes through points far from the end on its way down.
      const up = el.scrollTop < lastTop;
      lastTop = el.scrollTop;
      if (near) following.current = true;
      else if (up) following.current = false;
      setAtEnd(following.current);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [scroller]);

  // New content: follow it, only while following.
  useLayoutEffect(() => {
    if (following.current) toEnd("smooth");
  }, [content, toEnd]);

  // Content that grows without a new render here (an image, a diagram drawn late) follows too.
  useEffect(() => {
    const el = scroller.current;
    const inner = el?.firstElementChild;
    if (!inner || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (following.current) toEnd("smooth");
    });
    observer.observe(inner);
    return () => observer.disconnect();
  }, [scroller, toEnd]);

  /** Back to the newest content, following again. */
  const jumpToLatest = useCallback(() => {
    following.current = true;
    setAtEnd(true);
    toEnd("smooth");
  }, [toEnd]);

  return { atEnd, jumpToLatest };
}
