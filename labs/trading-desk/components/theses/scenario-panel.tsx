/**
 * scenario-panel — Phase 5 scenario-forecast memo renderer.
 *
 * Renders the ScenarioForecaster memo: agent identity header, headline,
 * a probability-bar grid for each scenario, a header area with distribution
 * tag / horizon / evidence-basis, a metrics row, and structured body
 * sections via ThesisBody.
 *
 * Follows the same layout conventions as PmHero (pm-hero.tsx). The scenario
 * bars are horizontal segments sized proportionally to each scenario's
 * probability, with trigger / outcome / trade-behavior detail below.
 */
import type { ReactElement } from "react";
import { AgentBadge } from "@/components/agent-badge";
import { AGENTS, type AgentName } from "@/src/flows/trading-desk/agents";
import { ThesisBody } from "./thesis-body";
import type { ThesisSection } from "@/src/flows/trading-desk/resources";
import { cn } from "@/lib/utils";

const TRIGGER_SOURCE_LABELS: Record<string, string> = {
  investmentThesis: "thesis",
  tradeProposal: "trade",
  riskAssessment: "risk",
  phase1: "P1",
};

const METRIC_ORDER = ["horizon", "distribution", "buckets", "evidence"] as const;

export type ScenarioPanelProps = {
  agent: AgentName;
  label: string | null;
  headline: string | null;
  rating: string | null;
  body: ReadonlyArray<ThesisSection> | null;
  metrics: Record<string, string> | null;
  scenarios: ReadonlyArray<{
    name: string;
    probability: number;
    trigger: string;
    triggerSource: string;
    expectedOutcome: string;
    tradeBehavior: string;
  }> | null;
  distribution: "concentrated" | "balanced" | "barbell" | "long-tail" | null;
  evidenceBasis: "sufficient" | "thin" | null;
  horizon: string | null;
};

export function ScenarioPanel({
  agent,
  label,
  headline,
  rating,
  body,
  metrics,
  scenarios,
  distribution,
  evidenceBasis,
  horizon,
}: ScenarioPanelProps): ReactElement {
  const meta = AGENTS[agent];

  return (
    <div className="flex flex-col gap-5">
      {/* Agent identity header */}
      <div className="flex items-center gap-3">
        <AgentBadge agent={agent} treatment="loud" />
        <div className="flex flex-col">
          <span className="text-[15px] font-semibold text-[color:var(--c-fg)]">
            {label ?? "Scenario Forecaster — Probability Map"}
          </span>
          <span className="font-mono text-[10.5px] uppercase tracking-wider text-[color:var(--c-fg-faint)]">
            {meta?.role ?? agent}
            {rating !== null && rating !== "" ? (
              <span className="ml-2 text-[color:var(--c-fg-muted)]">· {rating}</span>
            ) : null}
          </span>
        </div>
      </div>

      {/* Headline */}
      {headline !== null && headline !== "" ? (
        <p className="text-[16px] leading-snug text-[color:var(--c-fg)]">{headline}</p>
      ) : null}

      {/* Distribution / horizon / evidence-basis summary bar */}
      {(distribution !== null || horizon !== null || evidenceBasis !== null) ? (
        <div
          className={cn(
            "flex flex-wrap items-center gap-3 rounded-md border p-2.5",
            "border-[color:var(--c-border)] bg-[color:var(--c-surface)]",
          )}
          aria-label="Forecast summary"
        >
          {distribution !== null ? (
            <span
              className={cn(
                "font-mono text-[9.5px] uppercase tracking-wider",
                "rounded px-1.5 py-0.5",
                "border border-[color:var(--c-border)] bg-[color:var(--c-surface-2)]",
                "text-[color:var(--c-fg-muted)]",
              )}
            >
              {distribution}
            </span>
          ) : null}
          {horizon !== null ? (
            <span className="font-mono text-[10.5px] text-[color:var(--c-fg-muted)]">
              <span className="uppercase tracking-wider text-[color:var(--c-fg-faint)]">
                horizon
              </span>{" "}
              {horizon}
            </span>
          ) : null}
          {evidenceBasis !== null ? (
            <span
              className={cn(
                "font-mono text-[9.5px] uppercase tracking-wider",
                "rounded px-1.5 py-0.5",
                evidenceBasis === "thin"
                  ? "border border-[color:var(--c-warn)]/50 bg-[color:var(--c-warn)]/10 text-[color:var(--c-warn)]"
                  : "border border-[color:var(--c-border)] bg-[color:var(--c-surface-2)] text-[color:var(--c-fg-muted)]",
              )}
            >
              {evidenceBasis === "thin" ? "thin evidence" : "evidence ok"}
            </span>
          ) : null}
        </div>
      ) : null}

      {/* Scenario probability bars */}
      {scenarios !== null && scenarios.length > 0 ? (
        <section className="flex flex-col gap-1" aria-label="Scenarios">
          <h3 className="font-mono text-[10.5px] uppercase tracking-wider text-[color:var(--c-fg-faint)]">
            Scenarios
          </h3>
          <div
            className={cn(
              "flex flex-col gap-px overflow-hidden rounded-md border",
              "border-[color:var(--c-border)] bg-[color:var(--c-surface)]",
            )}
          >
            {scenarios.map((scenario, i) => (
              <ScenarioRow key={`${scenario.name}-${i}`} scenario={scenario} />
            ))}
          </div>
        </section>
      ) : null}

      {/* Metrics row */}
      {metrics !== null ? (
        <dl
          className={cn(
            "grid grid-cols-2 gap-3 rounded-md border p-3 sm:grid-cols-4",
            "border-[color:var(--c-border)] bg-[color:var(--c-surface)]",
          )}
          aria-label="Forecast metrics"
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

      {/* Body sections */}
      {body !== null && body.length > 0 ? <ThesisBody body={body} /> : null}
    </div>
  );
}

type ScenarioRowProps = {
  scenario: {
    name: string;
    probability: number;
    trigger: string;
    triggerSource: string;
    expectedOutcome: string;
    tradeBehavior: string;
  };
};

function ScenarioRow({ scenario }: ScenarioRowProps): ReactElement {
  const pct = Math.min(1, Math.max(0, scenario.probability));
  const pctLabel = `${Math.round(pct * 100)}%`;
  const sourceLabel =
    TRIGGER_SOURCE_LABELS[scenario.triggerSource] ?? scenario.triggerSource;

  return (
    <div
      className={cn(
        "flex flex-col gap-2 p-3",
        "bg-[color:var(--c-surface)] hover:bg-[color:var(--c-surface-2)]",
        "transition-colors",
      )}
    >
      {/* Bar row: name + probability + bar segment */}
      <div className="flex flex-col gap-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[12.5px] font-medium text-[color:var(--c-fg)]">
            {scenario.name}
          </span>
          <span className="font-mono text-[11px] tabular-nums text-[color:var(--c-fg-muted)]">
            {pctLabel}
          </span>
        </div>
        {/* Probability bar */}
        <div
          className="h-1 w-full overflow-hidden rounded-full bg-[color:var(--c-surface-2)]"
          role="meter"
          aria-valuenow={Math.round(pct * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${scenario.name} probability`}
        >
          <div
            className="h-full rounded-full bg-[color:var(--c-accent)]"
            style={{ width: `${pct * 100}%` }}
          />
        </div>
      </div>

      {/* Trigger line */}
      <div className="flex flex-wrap items-baseline gap-1.5 text-[11px]">
        <span className="font-mono text-[9.5px] uppercase tracking-wider text-[color:var(--c-fg-faint)]">
          trigger
        </span>
        <span className="text-[color:var(--c-fg-muted)]">{scenario.trigger}</span>
        <span
          className={cn(
            "font-mono text-[9px] uppercase tracking-wider",
            "rounded px-1 py-px",
            "border border-[color:var(--c-border)] bg-[color:var(--c-surface-2)]",
            "text-[color:var(--c-fg-faint)]",
          )}
        >
          {sourceLabel}
        </span>
      </div>

      {/* Outcome + trade behavior */}
      <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-[9.5px] uppercase tracking-wider text-[color:var(--c-fg-faint)]">
            outcome
          </span>
          <span className="text-[11px] leading-snug text-[color:var(--c-fg-muted)]">
            {scenario.expectedOutcome}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-[9.5px] uppercase tracking-wider text-[color:var(--c-fg-faint)]">
            trade behavior
          </span>
          <span className="text-[11px] leading-snug text-[color:var(--c-fg-muted)]">
            {scenario.tradeBehavior}
          </span>
        </div>
      </div>
    </div>
  );
}
