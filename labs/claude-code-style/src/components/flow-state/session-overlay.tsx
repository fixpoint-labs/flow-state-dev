"use client";

/**
 * A session over the thread, live: a frame with a header, the scrolling feed
 * with its jump-to-latest arrow, and optional rows under the header and at the
 * foot. What it shows is the opener's to keep live; the overlay only frames it.
 *
 * Two variants, which differ only in how much they cover:
 *
 *  - `sheet` draws in the `SessionOverlayArea` under a `SessionOverlayProvider`,
 *    over that area alone, so a side pane beside it stays usable (pick another
 *    task there and the same sheet shows it). Tab may leave it.
 *  - `modal` draws over the page and holds Tab inside it.
 *
 * Both close the same way, with the close button, Esc, or a click on the
 * backdrop, and both give focus back to where it was before it went into the
 * overlay, when focus would otherwise be lost.
 */
import { useJumpToLatest, type JumpToLatest } from "@flow-state-dev/react";
import { XIcon } from "lucide-react";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ConversationScrollButton } from "./conversation";

/** Where a sheet draws, and how `SessionOverlayArea` names that place. */
const OverlayHost = createContext<{ host: HTMLElement | null; setHost: (host: HTMLElement | null) => void }>({
  host: null,
  setHost: () => undefined,
});

/** Lets anything inside it, a side pane included, open a sheet over the `SessionOverlayArea` within it. */
export function SessionOverlayProvider({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  return <OverlayHost.Provider value={{ host, setHost }}>{children}</OverlayHost.Provider>;
}

/**
 * The area a sheet covers, such as the main thread. A sheet draws here
 * wherever it is opened from, so a side pane can open a wide view without the
 * thread losing its place under it.
 */
export function SessionOverlayArea({ children }: { children: ReactNode }) {
  const { setHost } = useContext(OverlayHost);
  return (
    <div className="relative min-h-0 min-w-0">
      {children}
      <div ref={setHost} className="pointer-events-none absolute inset-0 z-10 [&>*]:pointer-events-auto" />
    </div>
  );
}

export interface SessionOverlayProps {
  /** `sheet`: over the `SessionOverlayArea`, the page beside it live. `modal`: over the page, Tab held inside. */
  variant: "sheet" | "modal";
  /** The overlay's accessible name. */
  label: string;
  title: ReactNode;
  /** How the work stands, at the header's end: working, replied, done, failed. */
  status?: ReactNode;
  /** What goes under the title, such as what it ran on and what it spent. */
  meta?: ReactNode;
  /** Actions that stay put under the header while the feed scrolls. */
  toolbar?: ReactNode;
  onClose: () => void;
  /**
   * The opener's `useJumpToLatest`, when the opener also scrolls the feed after
   * its own sends (`sent()`). Absent, the overlay keeps its own, which opens on
   * the latest of what it shows.
   */
  feed?: JumpToLatest;
  children: ReactNode;
  /** What stays below the feed, such as a reply box or what waits on you. Past 60% of the height it scrolls on its own. */
  footer?: ReactNode;
}

/** One session over the thread, as a sheet or a modal. */
export function SessionOverlay({ variant, label, title, status, meta, toolbar, onClose, feed: shared, children, footer }: SessionOverlayProps) {
  const { host } = useContext(OverlayHost);
  const own = useJumpToLatest();
  const feed = shared ?? own;
  const section = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  // Held in a ref so the listeners subscribe once, not on every render of an opener that passes a fresh `onClose`.
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  const modal = variant === "modal";
  const target = modal ? (typeof document === "undefined" ? null : document.body) : host;

  useEffect(() => {
    const node = section.current;
    // Where focus goes back to: what had it at open, then wherever it last went outside any dialog,
    // such as another task picked in the pane beside a sheet.
    let opener = document.activeElement as HTMLElement | null;
    const onFocusIn = (event: FocusEvent) => {
      const at = event.target as HTMLElement;
      if (at.closest('[role="dialog"]') === null) opener = at;
    };
    // Capture phase, and the Esc is spent: it closed the overlay, so nothing under it also acts on it.
    // Esc closes it from any focus, its text boxes included. The one exception is a dialog opened
    // over it: focus sits in that dialog, so its Esc is its own. An IME's Esc ends a composition.
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (event.isComposing) return;
        const focused = document.activeElement?.closest('[role="dialog"]');
        if (focused && focused !== section.current) return;
        event.preventDefault();
        close.current();
      } else if (event.key === "Tab" && modal) {
        keepFocusIn(section.current, event);
      }
    };
    if (modal) closeButton.current?.focus();
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("keydown", onKey, true);
      // Only when focus is lost (on the page body, or in the closing overlay): a close caused by a
      // pick elsewhere may already have put focus where the person goes next.
      const at = document.activeElement;
      const lost = at === null || at === document.body || (node !== null && node.contains(at));
      if (lost) opener?.focus?.();
    };
  }, [modal]);

  if (target === null) return null;
  return createPortal(
    <div
      data-overlay-backdrop
      className={`${modal ? "fixed z-20" : "absolute"} inset-0 flex justify-center bg-background/60 p-6 backdrop-blur-[1px]`}
      onClick={onClose}
    >
      <section
        ref={section}
        role="dialog"
        aria-modal={modal ? "true" : undefined}
        aria-label={label}
        className={`flex h-full w-full ${modal ? "max-w-[var(--thread-width,46rem)]" : "max-w-3xl"} min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-lg`}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex min-h-14 shrink-0 items-start gap-3 border-b border-border px-5 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-[15px] leading-6 font-semibold">{title}</div>
            {meta ? <div className="mt-0.5 min-w-0">{meta}</div> : null}
          </div>
          {status ? (
            <span data-overlay-status className="shrink-0 pt-1 font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
              {status}
            </span>
          ) : null}
          <button
            ref={closeButton}
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="-mr-1.5 flex size-8 shrink-0 rounded-md items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            <XIcon aria-hidden className="size-4" />
          </button>
        </header>
        {toolbar ? <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-5 py-2">{toolbar}</div> : null}
        <div ref={feed.ref} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-4 [&>*]:shrink-0">
          {children}
          <ConversationScrollButton feed={feed} />
        </div>
        {footer ? <footer className="max-h-[60%] shrink-0 overflow-y-auto border-t border-border px-5 py-3">{footer}</footer> : null}
      </section>
    </div>,
    target,
  );
}

/** Tab and Shift+Tab wrap around the overlay's own controls, so the page under it can't take focus. */
function keepFocusIn(container: HTMLElement | null, event: KeyboardEvent) {
  if (container === null) return;
  const focusable = [...container.querySelectorAll<HTMLElement>("button, [href], input, select, textarea, summary, [tabindex]:not([tabindex='-1'])")].filter(
    (el) => !el.hasAttribute("disabled"),
  );
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const inside = container.contains(document.activeElement);
  if (event.shiftKey && (!inside || document.activeElement === first)) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && (!inside || document.activeElement === last)) {
    event.preventDefault();
    first?.focus();
  }
}
