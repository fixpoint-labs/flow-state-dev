/**
 * The one scroll rule every app's conversation shares, as ChatGPT and Claude
 * scroll: a line you send rises to near the top of the view and its reply
 * streams in below it; after that, nothing you didn't do moves the view.
 *
 * - **Your line rises.** Call {@link JumpToLatest.sent} when the person sends,
 *   and mark each of their lines with {@link JumpToLatest.mine}. When the line
 *   lands (or if it is already drawn, for an app that learns of the send after
 *   it), the feed scrolls it to near its top, once, smoothly, wherever the
 *   reader was. A scroll by the person before it lands cancels the move.
 * - **Room below it.** So that line can reach the top under a short reply, the
 *   feed keeps space at its end, as bottom padding on the scrolling element.
 *   The space shrinks as the reply grows and is gone once the reply fills the
 *   view. It stays until the next send, open or switch: taking it away sooner
 *   would move the view.
 * - **New content stays below.** A reply growing past the bottom edge, a card
 *   landing, a line from someone else: none of it scrolls the feed, even while
 *   the reader is at the end. `atEnd` turns `false` instead, so the app can
 *   show a jump-to-latest button that calls {@link JumpToLatest.jump}. Both
 *   look at content only: the kept room is not "more below".
 * - **Any scroll by the person is theirs**, in any direction: wheel, touch,
 *   scroll keys, or a press on the scrollbar. A move the hook makes itself is
 *   not.
 * - **Opening is not an animation.** A feed that opens, whether mounted, shown
 *   for a different conversation (`resetKey`), or filled by its first read, is
 *   already at its end on the first frame anyone sees.
 */
import { useCallback, useLayoutEffect, useRef, useState } from "react";

/** How close to the end, in pixels, still counts as at the end. */
const AT_END_SLACK = 32;

/** The gap, in pixels, a risen line keeps between its top and the feed's top edge. */
const GAP_ABOVE_LINE = 16;

/** The attribute {@link JumpToLatest.mine} puts on the person's lines. */
const MINE = "data-sent-line";

/** Keys a feed's scroll by: what a person does to scroll it themselves. */
const SCROLL_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "]);

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

/** What {@link JumpToLatest.mine} returns: spread it on the element that is the person's line. */
export type SentLineMark = { [MINE]: string };

export type JumpToLatest = {
  /** Attach to the scrolling element. */
  ref: (node: HTMLElement | null) => void;
  /** Whether the reader is at the end of the content. `false` when there is more below: show the jump-to-latest button. */
  atEnd: boolean;
  /** To the end of the content, smoothly. What the jump-to-latest button calls. */
  jump: () => void;
  /**
   * The person sent a line: when their line lands, it rises to near the top of
   * the feed, with room kept below it for the reply. Call it as the line goes
   * out, or after it is drawn (an effect on a send counter): either way the
   * line marked with {@link JumpToLatest.mine} that the feed had not shown yet
   * is the one that rises.
   */
  sent: () => void;
  /**
   * Mark an element as one of the person's own lines. `key` names the line and
   * stays the same while it is redrawn, such as its entry id:
   * `<div {...feed.mine(line.id)}>`.
   */
  mine: (key: string) => SentLineMark;
};

/** Move `el` to `top`. `scrollTo` where there is one, so `behavior` holds over a CSS `scroll-behavior`. */
function scrollToTop(el: HTMLElement, top: number, behavior: "instant" | "smooth") {
  if (typeof el.scrollTo === "function") el.scrollTo({ top, behavior });
  else el.scrollTop = top;
}

const mine = (key: string): SentLineMark => ({ [MINE]: key });

/** What the scrolling element's hook does, for the calls that come from outside its effect. */
type Feed = { sent: () => void; jump: () => void; reset: () => void };

/**
 * Keep the scrolling element `ref` is attached to where the reader put it,
 * bring the person's own line near its top, and offer the way to its end. See
 * the module header for the rule.
 */
export function useJumpToLatest(options: JumpToLatestOptions = {}): JumpToLatest {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const startAtEnd = options.startAtEnd ?? true;
  const [atEnd, setAtEnd] = useState(true);
  // Until the feed first has something to scroll, and for the frame after, it is still opening:
  // what it reads lands at the end instantly. Only a feed that opens at the end opens.
  const opening = useRef(startAtEnd);
  const frame = useRef<number | undefined>(undefined);
  const feed = useRef<Feed | undefined>(undefined);

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
    // Armed by `sent`: the next of the person's lines the feed shows rises, once.
    let waiting = false;
    // The person's lines the feed has shown already, by key: none of them is the one a send waits for.
    const shown = new Set<string>();
    let settling: number | undefined;
    // The line the room is kept for, the room in pixels, and the padding the element had before it.
    let anchor: string | undefined;
    let room = 0;
    let padding: { inline: string; px: number } | undefined;
    // Where a move the hook is making is headed: scrolls on the way are its own, not the reader's.
    let gliding: number | undefined;
    // Where the view last was, and whether the person has scrolled since their line rose.
    let lastTop = node.scrollTop;
    let held = false;

    const marked = () => Array.from(node.querySelectorAll<HTMLElement>(`[${MINE}]`));
    const showAll = () => {
      for (const el of marked()) shown.add(el.getAttribute(MINE)!);
    };
    /** The newest of the person's lines not shown before. */
    const unshown = () => marked().reverse().find((el) => !shown.has(el.getAttribute(MINE)!));
    const contentHeight = () => node.scrollHeight - room;
    const near = () => contentHeight() - node.scrollTop - node.clientHeight <= AT_END_SLACK;
    const topOf = (el: HTMLElement) => el.getBoundingClientRect().top - node.getBoundingClientRect().top - node.clientTop + node.scrollTop;

    /** A line of the person's drawn while nothing waits for one counts as shown two frames on: long enough for a send learned of in an effect to claim it. */
    const settleLater = () => {
      if (settling !== undefined) return;
      settling = requestAnimationFrame(() => {
        settling = requestAnimationFrame(() => {
          settling = undefined;
          if (!waiting) showAll();
        });
      });
    };

    /** Size the room so the anchored line can sit near the top, whatever is below it. */
    const fitRoom = () => {
      if (anchor === undefined) return;
      const line = marked().find((el) => el.getAttribute(MINE) === anchor);
      if (line === undefined) return;
      const needed = Math.max(0, topOf(line) - GAP_ABOVE_LINE + node.clientHeight - contentHeight());
      if (Math.abs(needed - room) < 0.5) return;
      if (padding === undefined) {
        padding = { inline: node.style.paddingBottom, px: Number.parseFloat(getComputedStyle(node).paddingBottom) || 0 };
      }
      room = needed;
      node.style.paddingBottom = `${padding.px + room}px`;
    };
    const dropRoom = () => {
      anchor = undefined;
      if (padding !== undefined) node.style.paddingBottom = padding.inline;
      padding = undefined;
      room = 0;
    };

    /** Move to `top`, as the hook's own move. */
    const glide = (top: number, behavior: "instant" | "smooth") => {
      const target = Math.max(0, Math.min(top, node.scrollHeight - node.clientHeight));
      if (Math.abs(target - node.scrollTop) <= 1) return;
      gliding = target;
      scrollToTop(node, target, behavior);
      if (Math.abs(node.scrollTop - target) <= 1) gliding = undefined;
      lastTop = node.scrollTop;
    };

    /** The person's line landed: room below it, and up it goes. */
    const bring = (line: HTMLElement) => {
      waiting = false;
      held = false;
      anchor = line.getAttribute(MINE)!;
      showAll();
      fitRoom();
      glide(topOf(line) - GAP_ABOVE_LINE, "smooth");
      setAtEnd(near());
    };

    /** `added`: the change put new elements in the feed, such as the line just sent. */
    const onChange = (added = false) => {
      if (opening.current) {
        dropRoom();
        showAll();
        scrollToTop(node, node.scrollHeight, "instant");
        lastTop = node.scrollTop;
        closeOpening(node);
        setAtEnd(true);
        return;
      }
      const line = unshown();
      if (line !== undefined) {
        if (waiting) return bring(line);
        if (added) settleLater();
      }
      // Content under the line that shrinks, such as a working line going away, pulls the end up past
      // where the view is, and the browser moves the view to it before the room grows back. Until the
      // person scrolls, the view goes back where it was, before anyone sees a frame of it.
      const was = lastTop;
      fitRoom();
      if (anchor !== undefined && !held && gliding === undefined && node.scrollTop < was - 0.5) scrollToTop(node, was, "instant");
      lastTop = node.scrollTop;
      if (gliding === undefined) setAtEnd(near());
    };
    onChange();

    const onScroll = () => {
      lastTop = node.scrollTop;
      if (gliding !== undefined) {
        if (Math.abs(node.scrollTop - gliding) > 1) return;
        gliding = undefined;
      }
      setAtEnd(near());
    };
    const onScrollEnd = () => {
      gliding = undefined;
      setAtEnd(near());
    };
    // The person scrolls: what the hook was about to do, or doing, stops for this response.
    const theirs = () => {
      waiting = false;
      gliding = undefined;
      held = true;
    };
    const onKey = (event: KeyboardEvent) => {
      if (SCROLL_KEYS.has(event.key)) theirs();
    };
    // Only a press on the element itself, not on what it holds: its scrollbar.
    const onPointer = (event: PointerEvent) => {
      if (event.target === node) theirs();
    };
    node.addEventListener("scroll", onScroll, { passive: true });
    node.addEventListener("scrollend", onScrollEnd, { passive: true });
    node.addEventListener("wheel", theirs, { passive: true });
    node.addEventListener("touchstart", theirs, { passive: true });
    node.addEventListener("keydown", onKey);
    node.addEventListener("pointerdown", onPointer);

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

    feed.current = {
      sent: () => {
        // A feed short enough never to have overflowed is still opening; the person writing in it ends that.
        opening.current = false;
        const line = unshown();
        if (line !== undefined) bring(line);
        else waiting = true;
      },
      jump: () => {
        waiting = false;
        held = true;
        setAtEnd(true);
        glide(contentHeight() - node.clientHeight, "smooth");
      },
      reset: () => {
        waiting = false;
        gliding = undefined;
        dropRoom();
        scrollToTop(node, node.scrollHeight, "instant");
      },
    };
    return () => {
      feed.current = undefined;
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
      frame.current = undefined;
      if (settling !== undefined) cancelAnimationFrame(settling);
      dropRoom();
      node.removeEventListener("scroll", onScroll);
      node.removeEventListener("scrollend", onScrollEnd);
      node.removeEventListener("wheel", theirs);
      node.removeEventListener("touchstart", theirs);
      node.removeEventListener("keydown", onKey);
      node.removeEventListener("pointerdown", onPointer);
      mutations.disconnect();
      sizes?.disconnect();
    };
  }, [node, closeOpening]);

  // A different thing shown opens at the end again; the same thing in a new element leaves the reader be.
  const shownKey = useRef(options.resetKey);
  useLayoutEffect(() => {
    if (shownKey.current === options.resetKey) return;
    shownKey.current = options.resetKey;
    if (!startAtEnd) return;
    opening.current = true;
    setAtEnd(true);
    // Not closed here: what the element holds may still be the last conversation. The new one's content closes it.
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    frame.current = undefined;
    feed.current?.reset();
  }, [options.resetKey, startAtEnd, node]);

  const jump = useCallback(() => {
    setAtEnd(true);
    feed.current?.jump();
  }, []);

  const sent = useCallback(() => {
    // No scrolling element yet, such as a view drawing an empty state until the first request:
    // it opens at its end when it mounts, which shows the line.
    if (feed.current === undefined) {
      opening.current = true;
      return;
    }
    feed.current.sent();
  }, []);

  return { ref: setNode, atEnd, jump, sent, mine };
}
