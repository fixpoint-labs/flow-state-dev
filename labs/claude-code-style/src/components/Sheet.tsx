import { useJumpToLatest, type JumpToLatest } from "@flow-state-dev/react";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { JumpToLatestButton } from "./JumpToLatest";

/** Where a sheet draws, and how `SheetArea` names that place. */
const SheetHost = createContext<{ host: HTMLElement | null; setHost: (host: HTMLElement | null) => void }>({
  host: null,
  setHost: () => undefined,
});

/** Lets anything inside it, a side pane included, open a sheet over the `SheetArea` within it. */
export function SheetProvider({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  return <SheetHost.Provider value={{ host, setHost }}>{children}</SheetHost.Provider>;
}

/**
 * The main thread's area, with room for one sheet over it. A sheet draws here
 * wherever it is opened from, so a side pane can open a wide view without the
 * main thread losing its place under it.
 */
export function SheetArea({ children }: { children: ReactNode }) {
  const { setHost } = useContext(SheetHost);
  return (
    <div className="relative min-h-0 min-w-0">
      {children}
      <div ref={setHost} className="pointer-events-none absolute inset-0 z-10 [&>*]:pointer-events-auto" />
    </div>
  );
}

/**
 * A sheet over the main thread. It closes with its close button, Esc, or a
 * click on the main thread around it. What it shows is the opener's to keep
 * live; the sheet only frames it.
 */
export function Sheet({ label, title, subtitle, onClose, feed: shared, children, footer }: {
  /** The sheet's accessible name. */
  label: string;
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  /**
   * The opener's `useJumpToLatest`, when the opener also scrolls the body after
   * its own sends (`sent()`). Absent, the sheet keeps its own, which opens on
   * the latest of what it shows.
   */
  feed?: JumpToLatest;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const { host } = useContext(SheetHost);
  const own = useJumpToLatest();
  const feed = shared ?? own;
  const section = useRef<HTMLElement>(null);
  // Held in a ref so the listener subscribes once, not on every render of an opener that passes a fresh `onClose`.
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  useEffect(() => {
    // Capture phase, and the Esc is spent: it closed the sheet, so it never also counts toward stopping the turn.
    // Esc closes it from any focus, its text boxes included; a draft is kept per task, so a close loses no words.
    // The one exception is a dialog opened over it (the keys sheet): focus sits in that dialog, so its Esc is its own.
    // An IME's Esc ends a composition, not the sheet.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing) return;
      const focused = document.activeElement?.closest('[role="dialog"]');
      if (focused && focused !== section.current) return;
      event.preventDefault();
      close.current();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, []);
  if (host === null) return null;
  return createPortal(
    <div className="absolute inset-0 flex justify-center bg-background/60 p-6 backdrop-blur-[1px]" onClick={onClose}>
      <section
        role="dialog"
        aria-label={label}
        ref={section}
        className="flex h-full w-full max-w-3xl min-h-0 flex-col border border-border bg-card shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-start gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="text-base font-semibold">{title}</div>
            {subtitle ? <div className="mt-1 text-sm whitespace-pre-wrap text-muted-foreground">{subtitle}</div> : null}
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="px-2 text-lg leading-none text-muted-foreground hover:text-foreground">
            ×
          </button>
        </header>
        <div ref={feed.ref} className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-5 py-4">
          {children}
          <JumpToLatestButton feed={feed} />
        </div>
        {footer ? <footer className="border-t border-border px-5 py-3">{footer}</footer> : null}
      </section>
    </div>,
    host,
  );
}
