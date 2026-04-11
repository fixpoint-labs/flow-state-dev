"use client";

import { useCallback } from "react";
import { cn } from "@/lib/utils";

interface ResizeHandleProps {
  onResize: (delta: number) => void;
  className?: string;
}

/**
 * Vertical drag handle for resizing a sibling pane.
 *
 * Reports horizontal pixel deltas via `onResize` during drag.
 * Positive delta = pointer moved right, negative = pointer moved left.
 */
export function ResizeHandle({ onResize, className }: ResizeHandleProps) {
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      let lastX = e.clientX;

      const handlePointerMove = (moveEvent: PointerEvent) => {
        const delta = moveEvent.clientX - lastX;
        lastX = moveEvent.clientX;
        onResize(delta);
      };

      const handlePointerUp = () => {
        document.removeEventListener("pointermove", handlePointerMove);
        document.removeEventListener("pointerup", handlePointerUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.addEventListener("pointermove", handlePointerMove);
      document.addEventListener("pointerup", handlePointerUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [onResize],
  );

  return (
    <div
      className={cn(
        "group relative flex w-2 shrink-0 cursor-col-resize items-center justify-center transition-colors hover:bg-accent/50 active:bg-accent",
        className,
      )}
      onPointerDown={handlePointerDown}
    >
      <div className="h-8 w-0.5 rounded-full bg-border transition-colors group-hover:bg-foreground/30 group-active:bg-foreground/50" />
    </div>
  );
}
