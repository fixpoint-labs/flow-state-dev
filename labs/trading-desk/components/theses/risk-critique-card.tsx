/**
 * RiskCritiqueCard — dedicated doc renderer for the four Phase 4 risk memos:
 * three persona critiques and the consolidated assessment. One component, two
 * variants, because the two shapes overlap on most of their sections.
 *
 * PURELY PRESENTATIONAL. No transport, no schema, no commit, no stored field.
 *
 * Three rules, each in an exported pure helper because a rule inside JSX has no
 * reachable test in this node-env suite: the metrics filter is a DENYLIST and
 * never an allowlist (`metrics` is unconstrained, so an allowlist swallows what
 * a later schema adds); the verdict renders once from the structured fields,
 * with the free-form `rating` suppressed and absent from `RiskMemoData` so
 * reading it again is a compile error; and attribution renders independently of
 * the rationale beside it, since neither string is `.min(1)`.
 *
 * Absence stays absent: a null field contributes no row, and an empty list
 * renders neither heading nor chrome. Severity glyphs, calibration colours, and
 * axis labels are imported from `components/risk-vocabulary.ts`, shared with
 * the Summary's `RiskPanel`, so the two surfaces cannot drift.
 *
 * The class-level why, for every memo renderer: `CLAUDE.md` → "Theses view".
 */
import type { ReactElement } from "react";
import { ThesisHeader } from "./thesis-header";
import { ThesisBody } from "./thesis-body";
import {
  ADJUSTMENT_AXES,
  CALIBRATION_CLASS,
  SEVERITY,
  type RiskCalibration,
  type RiskSeverity,
} from "@/components/risk-vocabulary";
import {
  PHASE_4_MEMO_KEYS,
  type AgentName,
} from "@/flows/analysis/registry";
import type { MemoCitation, ThesisSection } from "@/flows/analysis/resources";
import { cn } from "@/lib/utils";

/** Which of the two shapes a risk memo carries. Derived from the agent, never
 *  passed in: the consolidated assessment is one registry entry. */
export type RiskCardVariant = "persona" | "assessment";

/** One risk a memo raised, in either shape. `raisedBy` is present only on the
 *  consolidated assessment, which attributes each critical risk to the persona
 *  that argued it. */
export type RiskEntry = {
  description: string;
  severity: RiskSeverity;
  raisedBy?: string;
};

/** One risk a memo deliberately dismissed, with the reason it gave. */
export type DismissedRiskEntry = {
  description: string;
  reason: string;
  dismissalCategory: string;
};

/**
 * The risk memo fields this card reads — a structural subset of the client data
 * the dispatcher already holds (the `LensMemoData` precedent). Persona and
 * assessment fields are both optional: a memo carries one set or the other.
 *
 * `rating` is deliberately ABSENT, which is what makes drawing it a compile
 * error rather than a review catch.
 */
export type RiskMemoData = {
  label: string | null;
  headline: string | null;
  metrics: Record<string, string> | null;
  body: ReadonlyArray<ThesisSection> | null;
  citations: ReadonlyArray<MemoCitation> | null;
  /** Persona only: which of the three postures argued this critique. */
  posture: "aggressive" | "conservative" | "neutral" | null;
  /** Persona only. */
  raisedRisks: ReadonlyArray<RiskEntry> | null;
  /** Persona only: a bare direction per axis. */
  proposedAdjustments: {
    sizing: string | null;
    holdingPeriod: string | null;
    invalidation: string | null;
  } | null;
  /** Both shapes. */
  dismissedRisks: ReadonlyArray<DismissedRiskEntry> | null;
  /** Assessment only. */
  criticalRisks: ReadonlyArray<RiskEntry> | null;
  /** Assessment only: a direction plus the reasoning and its attribution. */
  recommendedAdjustments: {
    sizing: AdjustmentDetail | null;
    holdingPeriod: AdjustmentDetail | null;
    invalidation: AdjustmentDetail | null;
  } | null;
  /** Assessment only. */
  confidenceCalibration: RiskCalibration | null;
  calibrationRationale: string | null;
};

/** The consolidated assessment's per-axis recommendation. */
export type AdjustmentDetail = {
  direction: string;
  rationale: string;
  attributedTo: string;
};

/**
 * The value a persona writes into a metrics key its posture does not use
 * (`prompts/_partials/phase4-metrics-note.md`). Matched on the VALUE, so an
 * unrecognized new key is never swallowed — only a non-measurement is.
 */
const NON_MEASUREMENT = "—";

/**
 * The assessment metrics keys its structured sections already draw: the
 * calibration verdict and the three adjustment axes.
 *
 * A DENYLIST. Never invert it into an allowlist of today's keys — that silently
 * swallows a metric a later schema adds, the exact defect this card fixes.
 */
const ASSESSMENT_STRUCTURED_METRIC_KEYS: ReadonlySet<string> = new Set([
  "calibration",
  ...ADJUSTMENT_AXES.map((axis) => axis.key),
]);

/**
 * The metrics chips a risk card shows, per variant: the assessment drops what
 * its structured sections draw, a persona drops the non-measurements. Null when
 * nothing survives, so no empty grid renders.
 */
export function riskDisplayMetrics(
  variant: RiskCardVariant,
  metrics: Record<string, string> | null | undefined,
): Record<string, string> | null {
  const kept: Record<string, string> = {};
  for (const [key, value] of Object.entries(metrics ?? {})) {
    if (variant === "assessment") {
      if (ASSESSMENT_STRUCTURED_METRIC_KEYS.has(key)) continue;
    } else {
      const trimmed = value.trim();
      if (trimmed === "" || trimmed === NON_MEASUREMENT) continue;
    }
    kept[key] = value;
  }
  return Object.keys(kept).length > 0 ? kept : null;
}

/** What the shared header is given on a risk card. Both fields override the
 *  memo's stored values. */
export type RiskHeaderModel = {
  /** Always null — the structured sections own the verdict. Typed as the
   *  literal so reintroducing a stored `rating` is a compile error
   *  (`TraderHeaderModel` precedent). */
  rating: null;
  /** The stored bag filtered per variant. Null when nothing survives, so no
   *  empty grid renders. */
  metrics: Record<string, string> | null;
};

/** The header model for one risk memo: no rating, and the variant's metrics. */
export function riskHeaderModel(
  variant: RiskCardVariant,
  data: RiskMemoData | null,
): RiskHeaderModel {
  return {
    rating: null,
    metrics: riskDisplayMetrics(variant, data?.metrics),
  };
}

/** One rendered adjustment: the axis name and the direction it was moved,
 *  plus the assessment's reasoning where it has one. */
export type AdjustmentRow = {
  label: string;
  direction: string;
  rationale: string | null;
  attributedTo: string | null;
};

/**
 * Whether an adjustment row has a trailing note to draw beside its direction.
 *
 * Exported and named on purpose: it is the named form of the rule that
 * attribution renders independently of its rationale, so a test can reference
 * the rule rather than re-derive it. Inlining the condition is what hid a
 * populated attribution behind an empty rationale.
 */
export function adjustmentHasNote(row: AdjustmentRow): boolean {
  return row.rationale !== null || row.attributedTo !== null;
}

/**
 * The adjustment rows a risk memo publishes, in the axes' declared order — one
 * walk over `ADJUSTMENT_AXES` for both shapes.
 *
 * An axis the memo left null contributes no row, never an "unchanged" the desk
 * did not say. (`"unchanged"` IS in each direction enum, so a memo that
 * deliberately recommends no change still renders one.)
 */
export function riskAdjustmentRows(data: RiskMemoData | null): AdjustmentRow[] {
  if (data === null) return [];
  return ADJUSTMENT_AXES.flatMap(({ key, label }) => {
    const detailed = data.recommendedAdjustments?.[key] ?? null;
    if (detailed !== null) {
      return [
        {
          label,
          direction: detailed.direction,
          rationale: detailed.rationale === "" ? null : detailed.rationale,
          attributedTo:
            detailed.attributedTo === "" ? null : detailed.attributedTo,
        },
      ];
    }
    const bare = data.proposedAdjustments?.[key] ?? null;
    if (bare === null || bare === "") return [];
    return [{ label, direction: bare, rationale: null, attributedTo: null }];
  });
}

/**
 * The risks this memo raised, whichever field carries them: a persona's
 * `raisedRisks` or the assessment's attributed `criticalRisks`. An empty list
 * is missing signal, not a finding, so it collapses to no section rather than
 * rendering "raised: none".
 */
export function riskRaisedEntries(
  data: RiskMemoData | null,
): ReadonlyArray<RiskEntry> {
  return data?.criticalRisks ?? data?.raisedRisks ?? [];
}

/** Which shape this agent's memo carries. */
export function riskCardVariant(agent: AgentName): RiskCardVariant {
  return agent === PHASE_4_MEMO_KEYS.riskAssessment.agentName
    ? "assessment"
    : "persona";
}

export type RiskCritiqueCardProps = {
  agent: AgentName;
  data: RiskMemoData | null;
  /** Forwarded to the shared header. Re-routing these memos into their own card
   *  would otherwise delete the only navigation affordance they have. */
  onJumpToTranscript?: (() => void) | null;
};

/**
 * Render one risk memo as a critique: the shared header, the posture or
 * calibration verdict, the risks raised with severities, the adjustments
 * wanted, the risks dismissed with reasons, and the written memo.
 */
export function RiskCritiqueCard({
  agent,
  data,
  onJumpToTranscript,
}: RiskCritiqueCardProps): ReactElement {
  const variant = riskCardVariant(agent);
  const header = riskHeaderModel(variant, data);
  const raised = riskRaisedEntries(data);
  const adjustments = riskAdjustmentRows(data);
  const dismissed = data?.dismissedRisks ?? [];
  const rationale =
    data?.calibrationRationale === "" ? null : data?.calibrationRationale ?? null;
  const body = data?.body ?? null;

  return (
    <article className="flex flex-col gap-5" aria-label="Risk critique">
      <ThesisHeader
        agent={agent}
        label={data?.label ?? null}
        headline={data?.headline ?? null}
        rating={header.rating}
        metrics={header.metrics}
        onJumpToTranscript={onJumpToTranscript}
      />

      {data?.posture !== null && data?.posture !== undefined ? (
        <p className="font-mono text-[10.5px] uppercase tracking-wider text-[color:var(--c-fg-muted)]">
          posture · {data.posture}
        </p>
      ) : null}

      {data?.confidenceCalibration !== null &&
      data?.confidenceCalibration !== undefined ? (
        <div className="flex flex-col gap-1">
          <h3 className="font-mono text-[10.5px] uppercase tracking-wider text-[color:var(--c-fg-faint)]">
            Confidence calibration
          </h3>
          <span
            className={cn(
              "font-mono text-[12px] uppercase tracking-wider",
              CALIBRATION_CLASS[data.confidenceCalibration],
            )}
          >
            {data.confidenceCalibration}
          </span>
          {rationale !== null ? (
            <p className="text-[12px] leading-relaxed text-[color:var(--c-fg)]">
              {rationale}
            </p>
          ) : null}
        </div>
      ) : null}

      {raised.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <h3 className="font-mono text-[10.5px] uppercase tracking-wider text-[color:var(--c-fg-faint)]">
            Raised
          </h3>
          <ul className="flex flex-col gap-1.5">
            {raised.map((risk, i) => {
              const sev = SEVERITY[risk.severity];
              return (
                <li
                  key={i}
                  className="flex items-baseline gap-2 text-[12px] text-[color:var(--c-fg)]"
                >
                  <span
                    className={cn(
                      "shrink-0 font-mono text-[10px] uppercase tracking-wider",
                      sev.cls,
                    )}
                  >
                    {sev.glyph} {sev.label}
                  </span>
                  <span>
                    {risk.description}
                    {risk.raisedBy !== undefined && risk.raisedBy !== "" ? (
                      <span className="text-[color:var(--c-fg-faint)]">
                        {" "}
                        ({risk.raisedBy})
                      </span>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {adjustments.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <h3 className="font-mono text-[10.5px] uppercase tracking-wider text-[color:var(--c-fg-faint)]">
            Wants
          </h3>
          <ul className="flex flex-col gap-1.5">
            {adjustments.map((adj) => (
              <li
                key={adj.label}
                className="flex items-baseline gap-2 text-[12px] text-[color:var(--c-fg)]"
              >
                <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-[color:var(--c-fg-muted)]">
                  {adj.label} {adj.direction}
                </span>
                {adjustmentHasNote(adj) ? (
                  <span>
                    {adj.rationale}
                    {adj.attributedTo !== null ? (
                      <span className="text-[color:var(--c-fg-faint)]">
                        {adj.rationale !== null ? " " : ""}({adj.attributedTo})
                      </span>
                    ) : null}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {dismissed.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <h3 className="font-mono text-[10.5px] uppercase tracking-wider text-[color:var(--c-fg-faint)]">
            Dismissed
          </h3>
          <ul className="flex flex-col gap-1.5">
            {dismissed.map((risk, i) => (
              <li
                key={i}
                className="flex flex-col gap-0.5 text-[12px] text-[color:var(--c-fg)]"
              >
                <span>{risk.description}</span>
                <span className="text-[color:var(--c-fg-muted)]">
                  {risk.reason}{" "}
                  <span className="font-mono text-[10px] uppercase tracking-wider text-[color:var(--c-fg-faint)]">
                    {risk.dismissalCategory}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {body !== null && body.length > 0 ? (
        <ThesisBody body={body} citations={data?.citations ?? null} />
      ) : null}
    </article>
  );
}
