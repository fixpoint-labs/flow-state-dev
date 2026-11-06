import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "../lib/utils";

/** The line counts `Clamp` holds to; each is a literal so Tailwind sees the class. */
const LINES = { 3: "line-clamp-3", 6: "line-clamp-6" } as const;

/**
 * Words held to a few lines, with *Show more* once there are more than that.
 * A task's goal can run to paragraphs, and left open it pushed the work a
 * screen down the thread.
 */
export function Clamp({ children, lines = 3, className }: { children: ReactNode; lines?: keyof typeof LINES; className?: string }) {
  const [open, setOpen] = useState(false);
  const [cut, setCut] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const measure = () => {
    const el = box.current;
    if (el && !open) setCut(el.scrollHeight > el.clientHeight + 1);
  };
  // After each render, and again when the box changes width: dragging an edge or collapsing a column rewraps the text without a render.
  useLayoutEffect(measure);
  useLayoutEffect(() => {
    const el = box.current;
    if (el === null || typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(() => measure());
    watch.observe(el);
    return () => watch.disconnect();
  }, [open]);
  return (
    <div className={className}>
      <div ref={box} className={cn("whitespace-pre-wrap [overflow-wrap:anywhere]", !open && LINES[lines])}>
        {children}
      </div>
      {cut || open ? (
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="mt-1 text-xs text-foreground underline-offset-2 hover:underline">
          {open ? "Show less" : "Show more"}
        </button>
      ) : null}
    </div>
  );
}
