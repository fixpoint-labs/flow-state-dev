/**
 * Keep a conversation's latest turn in view: the one scroll rule every app's
 * conversation shares.
 *
 * - **Opening is not an animation.** A feed that opens, whether mounted, shown
 *   for a different conversation (`resetKey`), or filled by its first read, is
 *   already at its end on the first frame anyone sees. Watching it scroll down
 *   from the top on every session switch is the thing this hook exists to stop.
 * - **Live content glides.** While the reader is at the end, what arrives after
 *   that (a line sent, a reply streaming in, a card landing) is followed with a
 *   smooth scroll.
 * - **A reader who scrolled up stays put.** Content arriving below never pulls
 *   them down. They follow again once they scroll back to the end, or when
 *   {@link FollowLatest.follow} is called.
 */
import { useCallback, useLayoutEffect, useRef, useState } from "react";

/** How close to the end, in pixels, still counts as at the end. */
const AT_END_SLACK = 32;

export type FollowLatestOptions = {
  /**
   * Open at the end, following (the default). `false` opens where the element
   * starts, and follows once the reader reaches the end or `follow` is called.
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

export type FollowLatest = {
  /** Attach to the scrolling element. */
  ref: (node: HTMLElement | null) => void;
  /** Whether the feed is following its end; `false` once the reader scrolled up. */
  atEnd: boolean;
  /** Back to the newest content, smoothly, and follow from there. */
  follow: () => void;
  /** Stop following, for a caller about to load earlier history above what is shown. */
  stay: () => void;
};

const distanceFromEnd = (el: HTMLElement) => el.scrollHeight - el.scrollTop - el.clientHeight;

/** Move `el` to its end. `scrollTo` where there is one, so `behavior` holds over a CSS `scroll-behavior`. */
function toEnd(el: HTMLElement, behavior: "instant" | "smooth") {
  if (typeof el.scrollTo === "function") el.scrollTo({ top: el.scrollHeight, behavior });
  else el.scrollTop = el.scrollHeight;
}

/**
 * Follow the latest content of the scrolling element `ref` is attached to.
 * See the module header for the rule.
 */
export function useFollowLatest(options: FollowLatestOptions = {}): FollowLatest {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const startAtEnd = options.startAtEnd ?? true;
  const following = useRef(startAtEnd);
  const [atEnd, setAtEnd] = useState(startAtEnd);
  // Until the feed first has something to scroll, and for the frame after, it is still opening:
  // its first read lands at the end instantly rather than gliding down from the top.
  const opening = useRef(true);

  const setFollowing = useCallback((value: boolean) => {
    following.current = value;
    setAtEnd(value);
  }, []);

  // Before paint, so the first frame of a feed that opens at the end is already there.
  useLayoutEffect(() => {
    if (node === null) return;
    opening.current = true;
    let frame: number | undefined;
    const onChange = () => {
      if (!following.current) return;
      const overflows = node.scrollHeight > node.clientHeight;
      // A jump longer than the view is a load, not an arrival: no point animating past it.
      const glide = !opening.current && distanceFromEnd(node) <= node.clientHeight;
      toEnd(node, glide ? "smooth" : "instant");
      if (opening.current && overflows && frame === undefined) {
        frame = requestAnimationFrame(() => {
          frame = undefined;
          opening.current = false;
        });
      }
    };
    onChange();

    let lastTop = node.scrollTop;
    const onScroll = () => {
      const near = distanceFromEnd(node) <= AT_END_SLACK;
      // Only scrolling up lets go: a smooth follow passes points far from the end on its way down.
      const up = node.scrollTop < lastTop;
      lastTop = node.scrollTop;
      if (near && !following.current) setFollowing(true);
      else if (!near && up && following.current) setFollowing(false);
    };
    node.addEventListener("scroll", onScroll, { passive: true });

    // Content that grows without changing the tree, such as an image loading:
    // each of the feed's children, watched again as they are replaced.
    const sizes = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(onChange);
    const watchSizes = () => {
      sizes?.disconnect();
      for (const child of Array.from(node.children)) sizes?.observe(child);
    };
    watchSizes();
    const mutations = new MutationObserver((records) => {
      if (records.some((record) => record.target === node)) watchSizes();
      onChange();
    });
    mutations.observe(node, { childList: true, subtree: true, characterData: true });
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      node.removeEventListener("scroll", onScroll);
      mutations.disconnect();
      sizes?.disconnect();
    };
  }, [node, setFollowing]);

  // A different thing shown opens at the end again; the same thing in a new element leaves the reader be.
  const shown = useRef(options.resetKey);
  useLayoutEffect(() => {
    if (shown.current === options.resetKey) return;
    shown.current = options.resetKey;
    if (!startAtEnd) return;
    setFollowing(true);
    opening.current = true;
    if (node !== null) toEnd(node, "instant");
  }, [options.resetKey, startAtEnd, node, setFollowing]);

  const follow = useCallback(() => {
    setFollowing(true);
    if (node !== null) toEnd(node, "smooth");
  }, [node, setFollowing]);

  const stay = useCallback(() => setFollowing(false), [setFollowing]);

  return { ref: setNode, atEnd, follow, stay };
}
