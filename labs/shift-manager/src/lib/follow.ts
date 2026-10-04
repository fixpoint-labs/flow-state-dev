/**
 * Keep a conversation's latest turn in view (FIX-1773).
 *
 * A scrolling feed follows what is added to it while the person is at its
 * end: a line sent, a reply read back, a streamed item growing. Once they
 * scroll up to read history it stays where they put it, and it follows again
 * when they scroll back to the end, or when they send a line ({@link follow}).
 */
import { useCallback, useEffect, useRef, useState } from "react";

/** How close to the end, in pixels, still counts as at the end. */
const AT_END_SLACK = 32;

/**
 * Follow the latest content of the scrolling element `ref` is attached to.
 *
 * @param options.startAtEnd open at the end, following (the default); `false`
 * opens where the element starts, and follows once the person reaches the end
 * or {@link follow} is called.
 * @returns `ref`, to attach to the scrolling element, and `follow`, which
 * jumps to the end and follows from there.
 */
export function useFollowLatest(options: { startAtEnd?: boolean } = {}) {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const following = useRef(options.startAtEnd ?? true);

  useEffect(() => {
    if (node === null) return;
    const toEnd = () => {
      node.scrollTop = node.scrollHeight;
    };
    const onScroll = () => {
      following.current = node.scrollHeight - node.scrollTop - node.clientHeight <= AT_END_SLACK;
    };
    const onChange = () => {
      if (following.current) toEnd();
    };
    // Content that grows without changing the tree, such as an image loading:
    // each of the feed's children, watched again as they are replaced.
    const sizes = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(onChange);
    const watchSizes = () => {
      sizes?.disconnect();
      for (const child of Array.from(node.children)) sizes?.observe(child);
    };
    watchSizes();
    onChange();
    node.addEventListener("scroll", onScroll, { passive: true });
    const mutations = new MutationObserver((records) => {
      if (records.some((record) => record.target === node)) watchSizes();
      onChange();
    });
    mutations.observe(node, { childList: true, subtree: true, characterData: true });
    return () => {
      node.removeEventListener("scroll", onScroll);
      mutations.disconnect();
      sizes?.disconnect();
    };
  }, [node]);

  const follow = useCallback(() => {
    following.current = true;
    if (node !== null) node.scrollTop = node.scrollHeight;
  }, [node]);

  return { ref: setNode, follow };
}
