/**
 * thesis-header — top-of-doc header for an analyst, researcher, trader, or
 * risk memo (anything except the PM hero).
 *
 * Renders agent identity + role + jump-to-transcript button + headline +
 * metrics grid. The "jump to transcript →" button ships as a no-op tooltip
 * for FIX-575; scroll-to-event lands in a follow-on.
 */
import type { ReactElement } from "react";
import { ArrowRightToLine } from "lucide-react";
import { AgentBadge } from "@/components/agent-badge";
import {
  AGENTS,
  type AgentName,
} from "@/src/flows/trading-desk/agents";
import { ThesisMetrics } from "./thesis-metrics";
import { cn } from "@/lib/utils";

export type ThesisHeaderProps = {
  agent: AgentName;
  label: string | null;
  headline: string | null;
  rating: string | null;
  metrics: Record<string, string> | null;
};

export function ThesisHeader({
  agent,
  label,
  headline,
  rating,
  metrics,
}: ThesisHeaderProps): ReactElement {
  const meta = AGENTS[agent];
  return (
    <header className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <AgentBadge agent={agent} treatment="medium" />
          <div className="flex flex-col">
            <span className="text-[13px] font-semibold text-[color:var(--c-fg)]">
              {label ?? `${meta?.role ?? agent} memo`}
            </span>
            <span className="font-mono text-[10.5px] uppercase tracking-wider text-[color:var(--c-fg-faint)]">
              {meta?.role ?? agent}
              {rating !== null && rating !== "" ? (
                <span className={cn("ml-2", ratingClass(rating))}>· {rating}</span>
              ) : null}
            </span>
          </div>
        </div>
        <button
          type="button"
          title="scroll-to-event lands in a follow-on"
          aria-label="Jump to transcript"
          className={cn(
            "inline-flex h-7 items-center gap-1 rounded-md px-2",
            "border border-[color:var(--c-border)] text-[10.5px] uppercase tracking-wider",
            "text-[color:var(--c-fg-faint)] hover:text-[color:var(--c-fg)]",
          )}
        >
          jump to transcript
          <ArrowRightToLine className="h-3 w-3" aria-hidden />
        </button>
      </div>
      {headline !== null && headline !== "" && (
        <p className="text-[14px] leading-snug text-[color:var(--c-fg)]">{headline}</p>
      )}
      {metrics !== null && Object.keys(metrics).length > 0 && (
        <ThesisMetrics metrics={metrics} />
      )}
    </header>
  );
}

function ratingClass(rating: string): string {
  switch (rating) {
    case "constructive":
    case "buy":
    case "long":
      return "text-[color:var(--c-live)]";
    case "cautious":
    case "underweight":
    case "short":
      return "text-[color:var(--c-warn)]";
    case "neutral":
    case "flat":
    default:
      return "text-[color:var(--c-fg-muted)]";
  }
}
