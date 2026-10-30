import { useFollowLatest } from "@flow-state-dev/react";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

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
 * A read-only sheet over the main thread. It closes with its close button,
 * Esc, or a click on the main thread around it. What it shows is the opener's
 * to keep live; the sheet only frames it.
 */
export function Sheet({ label, title, subtitle, onClose, children, footer }: {
  /** The sheet's accessible name. */
  label: string;
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const { host } = useContext(SheetHost);
  // Opens on the latest of the work it shows, and follows it while the reader stays there.
  const feed = useFollowLatest();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (host === null) return null;
  return createPortal(
    <div className="absolute inset-0 flex justify-center bg-background/60 p-6 backdrop-blur-[1px]" onClick={onClose}>
      <section
        role="dialog"
        aria-label={label}
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
        </div>
        {footer ? <footer className="border-t border-border px-5 py-3 text-xs text-muted-foreground">{footer}</footer> : null}
      </section>
    </div>,
    host,
  );
}
