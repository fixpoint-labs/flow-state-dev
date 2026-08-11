/**
 * thesis-header — top-of-doc header for an analyst, researcher, trader, or
 * risk memo (anything except the PM hero).
 *
 * Renders agent identity + role + jump-to-transcript button + headline +
 * metrics grid. The "jump to transcript →" control scrolls the transcript
 * pane to this memo's originating event (FIX-1062). It is rendered ONLY when
 * `onJumpToTranscript` is supplied — i.e. when the run actually has a
 * transcript event for this agent — so the header never carries a clickable
 * control that does nothing.
 */
import type { ReactElement } from "react";
import { ArrowRightToLine } from "lucide-react";
import { AgentBadge } from "@/components/agent-badge";
import {
  AGENTS,
  type AgentName,
} from "@/flows/analysis/registry";
import { ThesisMetrics } from "./thesis-metrics";
import { cn } from "@/lib/utils";

export type ThesisHeaderProps = {
  agent: AgentName;
  label: string | null;
  headline: string | null;
  rating: string | null;
  metrics: Record<string, string> | null;
  /** Scrolls the transcript pane to this memo's first transcript event.
   *  Omitted / null when the run has no such event — a re-opened historical
   *  report whose items were never persisted, or a memo that published before
   *  its row landed. The control is then not rendered at all. */
  onJumpToTranscript?: (() => void) | null;
};

export function ThesisHeader({
  agent,
  label,
  headline,
  rating,
  metrics,
  onJumpToTranscript,
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
        {onJumpToTranscript !== null && onJumpToTranscript !== undefined ? (
          <button
            type="button"
            onClick={onJumpToTranscript}
            title="Scroll the transcript to this memo's first event"
            aria-label="Jump to transcript"
            className={cn(
              "inline-flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-md px-2",
              "border border-[color:var(--c-border)] text-[10.5px] uppercase tracking-wider",
              "text-[color:var(--c-fg-faint)] hover:text-[color:var(--c-fg)]",
            )}
          >
            jump to transcript
            <ArrowRightToLine className="h-3 w-3" aria-hidden />
          </button>
        ) : null}
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
  const r = rating.toLowerCase();
  if (
    r === "constructive" ||
    r === "buy" ||
    r === "long" ||
    r === "upsize" ||
    r.includes("increase")
  ) {
    return "text-[color:var(--c-live)]";
  }
  if (
    r === "cautious" ||
    r === "underweight" ||
    r === "short" ||
    r === "reject" ||
    r.includes("reduce") ||
    r.includes("smaller")
  ) {
    return "text-[color:var(--c-warn)]";
  }
  return "text-[color:var(--c-fg-muted)]";
}
