/**
 * pm-hero — featured Portfolio Manager memo doc with a 5-tier rating bar,
 * design-mandated metrics row, structured "accepted adjustments" panel,
 * key dependencies list, and static citation list referencing each
 * upstream stage.
 *
 * Wired up in Phase 5 (FIX-564). The `(agentName, status)` dispatcher in
 * the doc area still picks this component when `agentName ===
 * "portfolioManager"`; the difference is the memo now actually publishes.
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

const TIERS = ["Sell", "Underweight", "Hold", "Overweight", "Buy"] as const;

type Tier = (typeof TIERS)[number];

function tierIndex(rating: Tier | null): number {
  if (rating === null) return -1;
  return TIERS.indexOf(rating);
}

type AcceptedAdjustment = { applied: boolean; reasoning: string };

export type PmHeroProps = {
  agent: AgentName;
  label: string | null;
  headline: string | null;
  rating: string | null;
  body: ReadonlyArray<ThesisSection> | null;
  metrics: Record<string, string> | null;
  decisionSummary: string | null;
  finalRating: Tier | null;
  decisionConfidence: number | null;
  acceptedAdjustments:
    | {
        sizing: AcceptedAdjustment;
        holdingPeriod: AcceptedAdjustment;
        invalidation: AcceptedAdjustment;
      }
    | null;
  keyDependencies: ReadonlyArray<string> | null;
  upstreamReferences:
    | {
        analystMemos: ReadonlyArray<string>;
        thesis: string;
        tradeProposal: string;
        riskAssessment: string;
      }
    | null;
  agreesWithTrader: boolean | null;
};

const METRIC_ORDER = ["rating", "ticker", "window", "size", "stop", "target"] as const;

export function PmHero({
  agent,
  label,
  headline,
  rating,
  body,
  metrics,
  decisionSummary,
  finalRating,
  decisionConfidence,
  acceptedAdjustments,
  keyDependencies,
  upstreamReferences,
  agreesWithTrader,
}: PmHeroProps): ReactElement {
  const meta = AGENTS[agent];
  const idx = tierIndex(finalRating);
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

      {decisionSummary !== null && decisionSummary !== "" ? (
        <p className="text-[16px] leading-snug text-[color:var(--c-fg)]">
          {decisionSummary}
        </p>
      ) : headline !== null && headline !== "" ? (
        <p className="text-[16px] leading-snug text-[color:var(--c-fg)]">
          {headline}
        </p>
      ) : null}

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

      {metrics !== null ? (
        <dl
          className={cn(
            "grid grid-cols-3 gap-3 rounded-md border p-3 sm:grid-cols-6",
            "border-[color:var(--c-border)] bg-[color:var(--c-surface)]",
          )}
          aria-label="Decision metrics"
        >
          {METRIC_ORDER.map((key) => (
            <div key={key} className="flex flex-col gap-0.5">
              <dt className="font-mono text-[9.5px] uppercase tracking-wider text-[color:var(--c-fg-faint)]">
                {key}
              </dt>
              <dd className="text-[12.5px] text-[color:var(--c-fg)]">
                {metrics[key] ?? "—"}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      {decisionConfidence !== null || agreesWithTrader !== null ? (
        <div className="flex flex-wrap items-center gap-4 text-[11px] text-[color:var(--c-fg-muted)]">
          {decisionConfidence !== null ? (
            <span>
              <span className="font-mono uppercase tracking-wider text-[color:var(--c-fg-faint)]">
                confidence
              </span>{" "}
              {decisionConfidence.toFixed(2)}
            </span>
          ) : null}
          {agreesWithTrader === false ? (
            <span className="text-[color:var(--c-warn)]">
              Differs from trader proposal
            </span>
          ) : null}
        </div>
      ) : null}

      {body !== null && body.length > 0 ? <ThesisBody body={body} /> : null}

      {acceptedAdjustments !== null ? (
        <section className="flex flex-col gap-2">
          <h3 className="font-mono text-[10.5px] uppercase tracking-wider text-[color:var(--c-fg-faint)]">
            Risk-team adjustments
          </h3>
          <ul className="flex flex-col gap-1.5 text-[12.5px] text-[color:var(--c-fg)]">
            {(["sizing", "holdingPeriod", "invalidation"] as const).map((axis) => {
              const entry = acceptedAdjustments[axis];
              return (
                <li key={axis} className="flex flex-col gap-0.5">
                  <span>
                    <span className="font-mono text-[10.5px] uppercase tracking-wider text-[color:var(--c-fg-faint)]">
                      {axis}
                    </span>{" "}
                    <span
                      className={cn(
                        "font-mono text-[10.5px] uppercase tracking-wider",
                        entry.applied
                          ? "text-[color:var(--c-live)]"
                          : "text-[color:var(--c-warn)]",
                      )}
                    >
                      {entry.applied ? "applied" : "overridden"}
                    </span>
                  </span>
                  <span className="text-[color:var(--c-fg-muted)]">
                    {entry.reasoning}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {keyDependencies !== null && keyDependencies.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h3 className="font-mono text-[10.5px] uppercase tracking-wider text-[color:var(--c-fg-faint)]">
            Key dependencies
          </h3>
          <ul className="ml-3 list-disc text-[12.5px] leading-relaxed text-[color:var(--c-fg)]">
            {keyDependencies.map((dep, i) => (
              <li key={i}>{dep}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {upstreamReferences !== null ? (
        <section className="flex flex-col gap-2">
          <h3 className="font-mono text-[10.5px] uppercase tracking-wider text-[color:var(--c-fg-faint)]">
            Upstream references
          </h3>
          <ul className="ml-3 list-disc text-[12.5px] leading-relaxed text-[color:var(--c-fg-muted)]">
            {upstreamReferences.analystMemos.map((memo) => (
              <li key={memo}>
                <span className="font-mono">{memo}</span>
              </li>
            ))}
            <li>
              <span className="font-mono">{upstreamReferences.thesis}</span>
            </li>
            <li>
              <span className="font-mono">{upstreamReferences.tradeProposal}</span>
            </li>
            <li>
              <span className="font-mono">{upstreamReferences.riskAssessment}</span>
            </li>
          </ul>
        </section>
      ) : null}
    </div>
  );
}
