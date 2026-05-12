/**
 * pm-hero — featured Portfolio Manager memo doc with a 5-tier rating bar.
 *
 * Ships in FIX-575 because the `(agentName, status)` dispatcher in the doc
 * area renders it for `agentName === "portfolioManager"`. Phase 5 wires up
 * the actual emitting agent; until then this code path is unreachable.
 */
import type { ReactElement } from "react";
import { AgentBadge } from "@/components/agent-badge";
import {
  AGENTS,
  type AgentName,
} from "@/src/flows/trading-desk/agents";
import { ThesisBody } from "./thesis-body";
import type { ThesisSection } from "@/src/flows/trading-desk/resources";
import { cn } from "@/lib/utils";

export type PmHeroProps = {
  agent: AgentName;
  label: string | null;
  headline: string | null;
  rating: string | null;
  body: ReadonlyArray<ThesisSection> | null;
};

const TIERS = ["strong sell", "sell", "hold", "buy", "strong buy"] as const;

function tierIndex(rating: string | null): number {
  if (rating === null) return -1;
  const v = rating.toLowerCase();
  const idx = TIERS.findIndex((t) => t === v);
  return idx;
}

export function PmHero({
  agent,
  label,
  headline,
  rating,
  body,
}: PmHeroProps): ReactElement {
  const meta = AGENTS[agent];
  const idx = tierIndex(rating);
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <AgentBadge agent={agent} treatment="loud" />
        <div className="flex flex-col">
          <span className="text-[15px] font-semibold text-[color:var(--c-fg)]">
            {label ?? "Portfolio Manager — Final Decision"}
          </span>
          <span className="font-mono text-[10.5px] uppercase tracking-wider text-[color:var(--c-fg-faint)]">
            {meta?.role ?? agent}
          </span>
        </div>
      </div>
      {headline !== null && headline !== "" && (
        <p className="text-[16px] leading-snug text-[color:var(--c-fg)]">
          {headline}
        </p>
      )}
      <div
        className={cn(
          "flex items-center justify-between gap-1 rounded-md border p-2",
          "border-[color:var(--c-border)] bg-[color:var(--c-surface)]",
        )}
        aria-label="Rating"
      >
        {TIERS.map((tier, i) => (
          <div key={tier} className="flex flex-1 flex-col items-center gap-1">
            <span
              className={cn(
                "h-1.5 w-full rounded-sm",
                i === idx
                  ? "bg-[color:var(--c-accent)]"
                  : "bg-[color:var(--c-surface-2)]",
              )}
            />
            <span
              className={cn(
                "font-mono text-[9.5px] uppercase tracking-wider",
                i === idx
                  ? "text-[color:var(--c-fg)]"
                  : "text-[color:var(--c-fg-faint)]",
              )}
            >
              {tier}
            </span>
          </div>
        ))}
      </div>
      {body !== null && body.length > 0 && <ThesisBody body={body} />}
    </div>
  );
}
