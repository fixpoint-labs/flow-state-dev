import type { KeyboardEvent, PointerEvent } from "react";
import { PANE_MAX, PANE_MIN } from "../lib/pane-width";

/** How far one arrow key moves the edge, in px. */
const STEP = 16;

/**
 * The right pane's left edge, as a handle: drag it to make the pane wider or
 * narrower, or focus it and use the arrow keys. The pane sits at the screen's
 * right, so dragging left widens it.
 */
export function PaneResizer({ width, onResize }: { width: number; onResize: (width: number) => void }) {
  const start = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const handle = event.currentTarget;
    const fromX = event.clientX;
    const fromWidth = width;
    handle.setPointerCapture(event.pointerId);
    const move = (moved: globalThis.PointerEvent) => onResize(fromWidth + (fromX - moved.clientX));
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  };
  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft") onResize(width + STEP);
    else if (event.key === "ArrowRight") onResize(width - STEP);
    else return;
    event.preventDefault();
  };
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the side panel"
      aria-valuenow={width}
      aria-valuemin={PANE_MIN}
      aria-valuemax={PANE_MAX}
      tabIndex={0}
      onPointerDown={start}
      onKeyDown={key}
      className="absolute inset-y-0 -left-1 z-20 w-2 cursor-col-resize touch-none outline-none after:absolute after:inset-y-0 after:left-[3px] after:w-0.5 hover:after:bg-ring focus-visible:after:bg-ring"
    />
  );
}
