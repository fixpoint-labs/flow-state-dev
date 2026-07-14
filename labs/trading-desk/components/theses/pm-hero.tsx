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
} from "@/src/flows/analysis/registry";
import { ThesisBody } from "./thesis-body";
import { MandatePanel } from "./mandate-panel";
import { PolicyPanel } from "./policy-panel";
import type {
  MemoState,
  ThesisSection,
} from "@/src/flows/analysis/resources";
import { cn } from "@/lib/utils";

const TIERS = ["Sell", "Underweight", "Hold", "Overweight", "Buy"] as const;

type Tier = (typeof TIERS)[number];

function tierIndex(rating: Tier | null): number {
  if (rating === null) return -1;
  return TIERS.indexOf(rating);
}

// Derive the per-axis adjustment shape from the canonical `memoStateSchema`
// so the renderer can't drift from the resource contract.
type AcceptedAdjustment = NonNullable<
  MemoState["acceptedAdjustments"]
>["sizing"];

// Portfolio-fit + lens-convergence + mandate shapes derived from the canonical
// `memoStateSchema` so the renderer can't drift from the resource contract.
type PortfolioFit = NonNullable<MemoState["portfolioFit"]>;
type LensConvergence = NonNullable<MemoState["lensConvergence"]>;
type MandateDecision = NonNullable<MemoState["mandateDecision"]>;
type PolicyDecision = NonNullable<MemoState["policyDecision"]>;

type ScenarioSummary = {
  name: string;
  probability: number;
};

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
  scenarioStrip: {
    scenarios: ReadonlyArray<ScenarioSummary>;
    distribution: string;
    primaryScenario: string | null;
  } | null;
  // Slice 5 — portfolio-fit verdict + the lens-convergence read. Null when the
  // run was portfolio-blind / cost-gated off.
  portfolioFit: PortfolioFit | null;
  lensConvergence: LensConvergence | null;
  // The portfolio snapshot's as-of (RISK-P3 staleness label), null when none.
  snapshotAsOf: string | null;
  // FIX-752 — risk-appetite mandate verdict. Null on a mandate-blind run (the
  // panel is omitted entirely, like portfolioFit / lensConvergence above).
  mandateDecision: MandateDecision | null;
  // FIX-761 — durable portfolio-mandate policy fit. Null on a mandate-blind run.
  policyDecision: PolicyDecision | null;
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
  scenarioStrip,
  portfolioFit,
  lensConvergence,
  snapshotAsOf,
  mandateDecision,
  policyDecision,
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

      {scenarioStrip !== null && scenarioStrip.scenarios.length > 0 ? (
        <div
          className={cn(
            "flex flex-col gap-1.5 rounded-md border p-2",
            "border-[color:var(--c-border)] bg-[color:var(--c-surface)]",
          )}
          aria-label="Scenario distribution"
        >
          <div className="flex items-center gap-2">
            <span className="font-mono text-[9.5px] uppercase tracking-wider text-[color:var(--c-fg-faint)]">
              scenarios
            </span>
            <span className="text-[10.5px] text-[color:var(--c-fg-muted)]">
              {scenarioStrip.distribution}
            </span>
          </div>
          <div className="flex gap-0.5">
            {scenarioStrip.scenarios.map((sc) => (
              <div
                key={sc.name}
                className="flex flex-col items-center gap-0.5"
                style={{ flex: sc.probability }}
              >
                <div
                  className={cn(
                    "h-1.5 w-full rounded-sm",
                    scenarioStrip.primaryScenario === sc.name
                      ? "bg-[color:var(--c-accent)]"
                      : "bg-[color:var(--c-surface-2)]",
                  )}
                />
                <span
                  className={cn(
                    "max-w-full truncate text-center font-mono text-[8px] leading-tight",
                    scenarioStrip.primaryScenario === sc.name
                      ? "text-[color:var(--c-fg)]"
                      : "text-[color:var(--c-fg-faint)]",
                  )}
                  title={sc.name}
                >
                  {(sc.probability * 100).toFixed(0)}%
                </span>
              </div>
            ))}
          </div>
        </div>
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

      {portfolioFit !== null ? (
        <PortfolioFitPanel fit={portfolioFit} snapshotAsOf={snapshotAsOf} />
      ) : null}

      {lensConvergence !== null ? (
        <LensConvergenceStrip convergence={lensConvergence} />
      ) : null}

      {mandateDecision !== null ? (
        <MandatePanel decision={mandateDecision} />
      ) : null}

      {policyDecision !== null ? <PolicyPanel decision={policyDecision} /> : null}

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

/** Action-chip color by verb. `initiate`/`add` build a position (accent/live);
 *  `trim`/`exit` reduce it (warn); `hold` is neutral (muted). */
function actionColor(action: PortfolioFit["action"]): string {
  if (action === "initiate" || action === "add") return "var(--c-live)";
  if (action === "trim" || action === "exit") return "var(--c-warn)";
  return "var(--c-fg-muted)";
}

/** Stance → bar color for the per-lens convergence cell. */
function stanceColor(stance: "bullish" | "neutral" | "bearish"): string {
  if (stance === "bullish") return "var(--c-live)";
  if (stance === "bearish") return "var(--c-warn)";
  return "var(--c-surface-2)";
}

/** Convergence classification → header pill color. */
function classificationColor(c: LensConvergence["classification"]): string {
  if (c === "convergent") return "var(--c-live)";
  if (c === "divergent") return "var(--c-warn)";
  return "var(--c-fg-muted)";
}

/**
 * Portfolio-fit panel. Renders the PM's sized verdict against the live
 * portfolio. Real-money discipline: every number traces to a stored field; when
 * no portfolio was supplied (`hasPortfolioContext === false`) it shows a muted
 * "no portfolio" line instead of weights and NEVER a fake account.
 */
function PortfolioFitPanel({
  fit,
  snapshotAsOf,
}: {
  fit: PortfolioFit;
  snapshotAsOf: string | null;
}): ReactElement {
  const delta = fit.weightDeltaPct;
  const deltaText = `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}%`;
  return (
    <section
      className={cn(
        "flex flex-col gap-2 rounded-md border p-3",
        "border-[color:var(--c-border)] bg-[color:var(--c-surface)]",
      )}
      aria-label="Portfolio fit"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-wider text-[color:var(--c-fg-faint)]">
          portfolio fit
        </span>
        <span
          className="rounded-sm px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider"
          style={{ color: actionColor(fit.action), border: `1px solid ${actionColor(fit.action)}` }}
        >
          {fit.action}
        </span>
      </div>

      {fit.hasPortfolioContext ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-[color:var(--c-fg)]">
          <span>
            current{" "}
            <span className="font-mono">{fit.currentWeightPct.toFixed(1)}%</span> → target{" "}
            <span className="font-mono">{fit.targetWeightPct.toFixed(1)}%</span>{" "}
            <span className="text-[color:var(--c-fg-muted)]">(Δ {deltaText})</span>
          </span>
          {fit.suggestedAccount !== "" ? (
            <span className="text-[color:var(--c-fg-muted)]">
              suggested account:{" "}
              <span className="text-[color:var(--c-fg)]">{fit.suggestedAccount}</span>
            </span>
          ) : null}
        </div>
      ) : (
        <p className="text-[12px] text-[color:var(--c-fg-muted)]">
          No portfolio supplied — sizing is relative to a notional NAV (target{" "}
          <span className="font-mono">{fit.targetWeightPct.toFixed(1)}%</span>).
        </p>
      )}

      {fit.concentrationRisk !== "" ? (
        <p className="text-[12px] text-[color:var(--c-fg-muted)]">
          <span className="font-mono uppercase tracking-wider text-[color:var(--c-fg-faint)]">
            concentration
          </span>{" "}
          {fit.concentrationRisk}
        </p>
      ) : null}

      {fit.sizingRationale !== "" ? (
        <p className="text-[12px] text-[color:var(--c-fg)]">
          <span className="font-mono uppercase tracking-wider text-[color:var(--c-fg-faint)]">
            sizing
          </span>{" "}
          {fit.sizingRationale}
        </p>
      ) : null}

      {fit.convictionBasis !== "" ? (
        <p className="text-[12px] text-[color:var(--c-fg)]">
          <span className="font-mono uppercase tracking-wider text-[color:var(--c-fg-faint)]">
            conviction
          </span>{" "}
          {fit.convictionBasis}
        </p>
      ) : null}

      <p className="text-[10px] leading-snug text-[color:var(--c-fg-faint)]">
        {snapshotAsOf !== null && snapshotAsOf !== ""
          ? `Portfolio snapshot as of ${snapshotAsOf} (frozen at run start, not live). `
          : ""}
        Documented portfolio-management methodology — not financial advice.
      </p>
    </section>
  );
}

/**
 * Lens-convergence strip. One cell per lens (stance-colored bar + label +
 * conviction); dissenters get an outline so "this is philosophy-dependent" is
 * visible. The header pill carries the classification. Real-money discipline
 * (§1.6): copy frames this as ROBUSTNESS across philosophies, never "high
 * probability of being right"; a data gap is shown, not hidden.
 */
function LensConvergenceStrip({
  convergence,
}: {
  convergence: LensConvergence;
}): ReactElement {
  const dissenters = new Set(convergence.dissenters);
  return (
    <section
      className={cn(
        "flex flex-col gap-2 rounded-md border p-3",
        "border-[color:var(--c-border)] bg-[color:var(--c-surface)]",
      )}
      aria-label="Lens convergence"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-wider text-[color:var(--c-fg-faint)]">
          lens pack · independent verdicts (not a debate)
        </span>
        <span
          className="rounded-sm px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider"
          style={{
            color: classificationColor(convergence.classification),
            border: `1px solid ${classificationColor(convergence.classification)}`,
          }}
        >
          {convergence.classification} · {convergence.majorityStance} · netLean{" "}
          {convergence.netLean >= 0 ? "+" : ""}
          {convergence.netLean.toFixed(2)}
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        {convergence.verdicts.map((v) => (
          <div
            key={v.lensId}
            className={cn(
              "flex min-w-[110px] flex-1 flex-col gap-1 rounded-sm p-1.5",
              dissenters.has(v.lensId)
                ? "border border-dashed border-[color:var(--c-fg-faint)]"
                : "border border-transparent",
            )}
            title={`${v.attribution} — ${v.verdict}`}
          >
            <div
              className="h-1.5 w-full rounded-sm"
              style={{ backgroundColor: stanceColor(v.stance) }}
            />
            <span className="truncate text-[11px] text-[color:var(--c-fg)]">{v.label}</span>
            <span className="font-mono text-[9.5px] text-[color:var(--c-fg-faint)]">
              {v.stance} · {v.conviction.toFixed(2)}
            </span>
            {v.dataGap !== "" ? (
              <span className="text-[9px] leading-tight text-[color:var(--c-warn)]">
                gap: {v.dataGap}
              </span>
            ) : null}
          </div>
        ))}
      </div>

      <p className="text-[10px] leading-snug text-[color:var(--c-fg-faint)]">
        Applying each investor's documented methodology to the same evidence.
        Convergence means the call is robust across philosophies — not that it is
        likely correct. Divergence is information, not failure.
      </p>
    </section>
  );
}

