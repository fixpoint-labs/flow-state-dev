/**
 * MobileStatusLine — the mobile shell's condensed run status + the
 * load-bearing not-advice disclaimer (FIX-757). Sits directly above the
 * bottom tab bar.
 *
 * The desktop StatusBar's content splits on mobile: run metrics condense
 * here, the instructions gear moves to `MobileHeader`, and the disclaimer —
 * a real-money gate that must stay visible (non-dismissable per phase
 * requirements) — renders as its own line because the 28px single-row desktop
 * layout can't fit a phone.
 */
"use client";

import type { ReactElement } from "react";
import { cn } from "@/lib/utils";

type MobileStatusLineProps = {
  state: "idle" | "streaming" | "complete" | "error";
  eventCount: number;
  preset: "fast" | "full";
};

export function MobileStatusLine({
  state,
  eventCount,
  preset,
}: MobileStatusLineProps): ReactElement {
  const isStreaming = state === "streaming";
  const isError = state === "error";
  return (
    <div
      className={cn(
        "flex flex-col gap-0.5 border-t px-3 py-1.5",
        "border-[color:var(--c-border)] bg-[color:var(--c-surface)]",
        "text-[10px] text-[color:var(--c-fg-muted)]",
      )}
    >
      <div className="flex items-center gap-2 font-mono">
        <span
          aria-hidden
          className={cn(
            "inline-block h-1.5 w-1.5 rounded-full",
            isStreaming && "td-pulse",
          )}
          style={{
            background: isError
              ? "var(--c-warn)"
              : isStreaming
                ? "var(--c-pulse)"
                : "var(--c-fg-faint)",
          }}
        />
        <span>{state}</span>
        <span className="text-[color:var(--c-fg-faint)]">·</span>
        <span>{eventCount} events</span>
        <span className="text-[color:var(--c-fg-faint)]">·</span>
        <span>preset: {preset}</span>
      </div>
      <p className="leading-snug">
        <strong style={{ color: "var(--c-warn)" }}>Research / demo only.</strong>{" "}
        Not financial advice. No execution.
      </p>
    </div>
  );
}
