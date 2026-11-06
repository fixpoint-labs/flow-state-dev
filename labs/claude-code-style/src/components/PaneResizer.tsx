import type { KeyboardEvent, PointerEvent } from "react";
import { PANE_MAX, PANE_MIN, SIDEBAR_MAX, SIDEBAR_MIN } from "../lib/pane-width";

/** How far one arrow key moves the edge, in px. */
const STEP = 16;

/**
 * A column's inner edge, as a handle: drag it to make the column wider or
 * narrower, or focus it and use the arrow keys. The right pane's handle is on
 * its left edge, so dragging left widens it; the sessions list's is on its
 * right edge (`side="right"`), so dragging right widens it.
 */
export function PaneResizer({ width, onResize, side = "left" }: { width: number; onResize: (width: number) => void; side?: "left" | "right" }) {
  // Which way is wider: toward the screen's middle.
  const wider = side === "left" ? -1 : 1;
  const [min, max] = side === "left" ? [PANE_MIN, PANE_MAX] : [SIDEBAR_MIN, SIDEBAR_MAX];
  // A narrow window draws the pane narrower than its remembered width; moving the edge starts from what you see.
  const shown = (handle: HTMLElement) => handle.parentElement?.getBoundingClientRect().width || width;
  const start = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const handle = event.currentTarget;
    const fromX = event.clientX;
    const fromWidth = shown(handle);
    handle.setPointerCapture(event.pointerId);
    const move = (moved: globalThis.PointerEvent) => onResize(fromWidth + wider * (moved.clientX - fromX));
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
    const widerKey = side === "left" ? "ArrowLeft" : "ArrowRight";
    const narrowerKey = side === "left" ? "ArrowRight" : "ArrowLeft";
    if (event.key === widerKey) onResize(shown(event.currentTarget) + STEP);
    else if (event.key === narrowerKey) onResize(shown(event.currentTarget) - STEP);
    else return;
    event.preventDefault();
  };
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={side === "left" ? "Resize the side panel" : "Resize the sessions list"}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={start}
      onKeyDown={key}
      className={`absolute inset-y-0 ${side === "left" ? "-left-1" : "-right-1"} z-20 w-2 cursor-col-resize touch-none outline-none after:absolute after:inset-y-0 after:left-[3px] after:w-0.5 hover:after:bg-ring focus-visible:after:bg-ring`}
    />
  );
}
