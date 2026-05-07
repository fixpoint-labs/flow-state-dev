/**
 * StatusBar — 28px chrome at the bottom of the page.
 *
 * Renders: pulse dot, run state, event count, cost preset, and the
 * load-bearing disclaimer (with `Research / demo only.` bolded in
 * --c-warn). The disclaimer is non-dismissable per phase requirements.
 */
import type { ReactElement } from "react";
import { cn } from "@/lib/utils";

type StatusBarProps = {
  state: "idle" | "streaming" | "complete" | "error";
  eventCount: number;
  expectedEvents?: number;
  preset: "fast" | "full";
};

const stateLabels: Record<StatusBarProps["state"], string> = {
  idle: "idle",
  streaming: "streaming",
  complete: "complete",
  error: "error",
};

export function StatusBar({
  state,
  eventCount,
  expectedEvents,
  preset,
}: StatusBarProps): ReactElement {
  const isStreaming = state === "streaming";
  const isError = state === "error";

  return (
    <footer
      className={cn(
        "flex h-7 items-center gap-3 px-4",
        "border-t border-[color:var(--c-border)] bg-[color:var(--c-surface)]",
        "text-[10.5px] text-[color:var(--c-fg-muted)]",
      )}
    >
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
      <span className="font-mono">{stateLabels[state]}</span>
      <span className="text-[color:var(--c-fg-faint)]">·</span>
      <span className="font-mono">
        {eventCount}
        {expectedEvents !== undefined ? `/${expectedEvents}` : ""} events
      </span>
      <span className="text-[color:var(--c-fg-faint)]">·</span>
      <span className="font-mono">preset: {preset}</span>

      <span className="ml-auto truncate text-right">
        <strong style={{ color: "var(--c-warn)" }}>Research / demo only.</strong>{" "}
        Not financial advice. No execution. No P&amp;L. Mirrors upstream{" "}
        <span className="font-mono">TauricResearch/TradingAgents</span> positioning.
      </span>
    </footer>
  );
}
