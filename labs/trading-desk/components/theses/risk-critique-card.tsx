/**
 * RiskCritiqueCard — dedicated doc renderer for the four Phase 4 risk memos:
 * the three persona critiques and the consolidated risk assessment.
 *
 * Each risk memo commits an ARGUMENT: the risks it raised with severities, the
 * adjustments it wants on size / holding period / invalidation, the risks it
 * deliberately dismissed and why, and — on the consolidated assessment — a
 * confidence-calibration verdict. All of it reaches the browser on memo state
 * and the generic `ThesisHeader + ThesisBody` fall-through drew none of it.
 *
 * PURELY PRESENTATIONAL. No transport, no schema, no commit, no stored field.
 *
 * **One component, two variants, because there are two shapes.** The personas
 * share `personaCritiqueOutputSchema`; the consolidated assessment does not.
 * They overlap on raised risks, adjustments, and dismissed risks — enough that
 * two files would be two copies of three sections — so the differences live in
 * the variant branch, not in a second component.
 *
 * **The metrics bag needs a different answer per variant, and that is the
 * subtle part.** `ThesisMetrics` renders whatever keys it is handed, verbatim:
 *
 *  - A **persona's** bag has six required keys and the prompts fill the ones
 *    irrelevant to that posture with the literal `"—"` (a BP-016 consequence,
 *    not a mistake). Rendering those draws a grid of empty cells, and an empty
 *    cell asserts the desk had a slot for a measurement it never took. So the
 *    persona filter drops entries by VALUE — the non-measurements — and keeps
 *    every populated key, including `stance`, which is a free-form one-line
 *    summary and NOT a mirror of the typed `posture` enum.
 *  - The **assessment's** bag is four always-populated keys — `calibration`,
 *    `sizing`, `invalidation`, `holdingPeriod` — and every one of them mirrors
 *    a typed field this same card renders structurally. A value filter keeps
 *    all four, so the card would print each verdict twice from two sources
 *    nothing forces to agree. So the assessment filter is a DENYLIST of what
 *    the structured sections already draw, never an allowlist of today's keys:
 *    a metric a later schema adds must still reach the screen.
 *
 * **The verdict renders once, from the structured fields.** A risk memo's
 * `rating` is a free-form `z.string()` and nothing ties it to the typed fields
 * beside it, so a card that drew both could contradict itself — and on the
 * TYPICAL path it does: `conservative.prompt.md` pins `rating` to the literal
 * `"size correct"` unconditionally while naming `smaller` as the typical
 * `proposedAdjustments.sizing`, so the header announced "size correct" above a
 * verdict asking for the position to be cut. The aggressive persona has the
 * same shape pinned to `"upsize"`, the neutral one to `"size correct + hedge"`,
 * and the assessment's free-form `rating` is independent of both its typed
 * `confidenceCalibration` and its `recommendedAdjustments`. All four are one
 * defect, so the fix is one rule: the structured sections are canonical and the
 * header's rating chip is suppressed (`riskHeaderModel`). This mirrors the
 * trader card's rule 3, and `rating` is absent from `RiskMemoData` entirely so
 * reading it again is a compile error rather than something review must catch.
 *
 * **Attribution is independent of the rationale it sits beside.**
 * `recommendedAdjustments.*.rationale` and `.attributedTo` are two separate
 * required `z.string()`s and neither is `.min(1)`, so a schema-valid memo can
 * persist an empty rationale next to a populated attribution. Nesting the
 * attribution inside the rationale's condition hid WHO supported an adjustment
 * that still rendered — while the Summary tab's `RiskPanel` drew it anyway, so
 * one stored record read two ways on two surfaces. `adjustmentHasNote` gates
 * the pair; each half draws on its own presence.
 *
 * Absence stays absent and empty renders nothing: a null field contributes no
 * row, and a section whose list is empty renders neither heading nor chrome. An
 * empty dismissed-risks list is missing signal, never a desk that dismissed
 * nothing, and an axis a memo left null is never filled in as "unchanged".
 *
 * Severity glyphs and the adjustment-axis vocabulary are imported from
 * `components/risk-vocabulary.ts` — the same constants `RiskPanel` draws the
 * Summary tab's risk block from, so the two surfaces cannot drift.
 */
import type { ReactElement } from "react";
import { ThesisHeader } from "./thesis-header";
import { ThesisBody } from "./thesis-body";
import {
  ADJUSTMENT_AXES,
  SEVERITY,
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
 * the dispatcher already holds (the `LensMemoData` precedent). Persona fields
 * and assessment fields are both optional here because a memo carries one set
 * or the other; the variant decides which are read.
 *
 * `rating` is deliberately ABSENT. The stored field exists on every risk memo
 * and this card must never draw it (see the file header) — leaving it out of the
 * type is what makes reading it a compile error instead of a review catch.
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
  confidenceCalibration: string | null;
  calibrationRationale: string | null;
};

/** The consolidated assessment's per-axis recommendation. */
export type AdjustmentDetail = {
  direction: string;
  rationale: string;
  attributedTo: string;
};

/**
 * The value a persona writes into a metrics key its posture does not use.
 *
 * Spelled by the risk prompts (`prompts/_partials/phase4-metrics-note.md`: fill
 * the rest with "—"). Matched on the VALUE, so an unrecognized new key is never
 * swallowed — only a non-measurement is.
 */
const NON_MEASUREMENT = "—";

/**
 * The assessment metrics keys its structured sections already draw:
 * `calibration` is the confidence-calibration verdict, and the other three are
 * the recommended-adjustment axes.
 *
 * A DENYLIST, and never to be inverted into an allowlist of the keys known
 * today — `metrics` is an unconstrained `Record<string, string>`, so an
 * allowlist would silently swallow a metric a later schema adds, which is the
 * exact defect this card exists to fix.
 */
const ASSESSMENT_STRUCTURED_METRIC_KEYS: ReadonlySet<string> = new Set([
  "calibration",
  ...ADJUSTMENT_AXES.map((axis) => axis.key),
]);

/**
 * The metrics chips a risk card shows, per variant — the two rules in the file
 * header. Null when nothing survives, so no empty grid renders.
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

/** What the shared header is given on a risk card. Both fields are overrides of
 *  the memo's stored values — see the file header's two rules. */
export type RiskHeaderModel = {
  /** Always null: the verdict is the structured sections', so the header shows
   *  no second (and, on the typical conservative memo, contradicting) one.
   *  Typed as the literal so reintroducing a stored `rating` here is a compile
   *  error, not a review catch — the trader card's `TraderHeaderModel`
   *  precedent. */
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
 * The two halves are INDEPENDENT — see the file header. A persona's bare
 * direction carries neither, and renders no note rather than empty parentheses;
 * an assessment row carrying only an attribution still renders it, matching what
 * the Summary tab's `RiskPanel` shows for the same stored record.
 */
export function adjustmentHasNote(row: AdjustmentRow): boolean {
  return row.rationale !== null || row.attributedTo !== null;
}

/**
 * The adjustment rows a risk memo publishes, in the axes' declared order.
 *
 * One walk over `ADJUSTMENT_AXES` for both shapes: a persona stores a bare
 * direction per axis, the assessment a direction plus rationale and
 * attribution. An axis the memo left null contributes no row — never an
 * "unchanged" the desk did not say. (`"unchanged"` IS in each direction enum,
 * so a memo that deliberately recommends no change still renders one.)
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
 * is the prompt's instruction (aggressive and conservative emit `[]`), not a
 * finding — so it collapses to no section rather than "raised: none".
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
          <span className="font-mono text-[12px] uppercase tracking-wider text-[color:var(--c-fg)]">
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
                      sev?.cls,
                    )}
                  >
                    {sev?.glyph} {sev?.label}
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
