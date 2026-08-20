/**
 * Unit tests for the RiskCritiqueCard's pure rules (FIX-1061).
 *
 * Node env, no JSX — the rules with an honesty consequence live in exported
 * helpers and are asserted directly (the `lens-card.spec.ts` precedent).
 *
 * The load-bearing point of this file: **there is one metrics bag name and two
 * rules**, because the three personas and the consolidated assessment do not
 * share a shape.
 *
 *  - A persona's six keys are required by schema and the prompts fill the ones
 *    its posture does not use with the literal `"—"`. Rendering those draws
 *    empty cells, and an empty cell asserts the desk had a slot for a
 *    measurement nobody took. So the persona filter drops by VALUE.
 *  - The assessment's four keys are always populated and every one mirrors a
 *    typed field the same card renders structurally. A value filter keeps all
 *    four and prints every verdict twice from two sources nothing forces to
 *    agree — so the assessment filter is a DENYLIST of what the structured
 *    sections draw, asserted here on a memo where the two copies DISAGREE.
 *
 * Both filters are asserted in both directions, because a filter that dropped
 * the whole bag would pass the "the bad keys vanished" half on its own.
 */
import { describe, expect, it } from "vitest";
import {
  riskAdjustmentRows,
  riskCardVariant,
  riskDisplayMetrics,
  riskRaisedEntries,
  type RiskMemoData,
} from "../components/theses/risk-critique-card";
import { PHASE_4_MEMO_KEYS, type AgentName } from "../flows/analysis/registry";

function riskMemo(overrides: Partial<RiskMemoData> = {}): RiskMemoData {
  return {
    label: "Conservative Risk",
    headline: "Size is too large for the invalidation distance",
    rating: "reduce size",
    metrics: null,
    body: null,
    citations: null,
    posture: null,
    raisedRisks: null,
    proposedAdjustments: null,
    dismissedRisks: null,
    criticalRisks: null,
    recommendedAdjustments: null,
    confidenceCalibration: null,
    calibrationRationale: null,
    ...overrides,
  };
}

describe("the variant is derived from the registry, not spelled by hand", () => {
  it("routes the consolidated assessment to the assessment variant", () => {
    expect(
      riskCardVariant(PHASE_4_MEMO_KEYS.riskAssessment.agentName as AgentName),
    ).toBe("assessment");
  });

  it("routes each persona to the persona variant", () => {
    for (const short of ["aggressive", "conservative", "neutral"] as const) {
      expect(riskCardVariant(PHASE_4_MEMO_KEYS[short].agentName as AgentName)).toBe(
        "persona",
      );
    }
  });
});

describe("a persona's metrics bag drops non-measurements, not unknown keys", () => {
  it("drops the sentinel-valued keys and keeps every populated one", () => {
    // The aggressive persona's real shape: two distinguishing metrics plus the
    // one-line stance summary, with the other three filled with the sentinel.
    const kept = riskDisplayMetrics("persona", {
      stance: "Size is defensible if the margin read holds",
      structuralChange: "None that changes the thesis",
      scopeChange: "Narrower than the bull case assumes",
      exitDiscipline: "—",
      stopMechanics: "—",
      followOn: "—",
    });
    expect(kept).toEqual({
      stance: "Size is defensible if the margin read holds",
      structuralChange: "None that changes the thesis",
      scopeChange: "Narrower than the bull case assumes",
    });
  });

  it("keeps a populated `stance` — it is a summary, not the typed posture", () => {
    // `stance` here is a free-form one-line summary all three prompts define.
    // It is NOT a mirror of the typed `posture` enum, so the mirror rule that
    // governs the assessment bag does not reach it. A filter that treated it as
    // a duplicate would delete the persona's own framing of its read.
    const kept = riskDisplayMetrics("persona", {
      stance: "Wants the position smaller until the supplier disclosure lands",
      structuralChange: "—",
      scopeChange: "—",
      exitDiscipline: "—",
      stopMechanics: "—",
      followOn: "—",
    });
    expect(kept).toEqual({
      stance: "Wants the position smaller until the supplier disclosure lands",
    });
  });

  it("renders no grid when every key is a sentinel", () => {
    expect(
      riskDisplayMetrics("persona", { stance: "—", structuralChange: " — " }),
    ).toBeNull();
  });

  it("lets a metric nobody anticipated through", () => {
    // The persona filter drops non-measurements, never unrecognized names.
    const kept = riskDisplayMetrics("persona", {
      stopMechanics: "—",
      liquidityWindow: "3 days to exit at size",
    });
    expect(kept).toEqual({ liquidityWindow: "3 days to exit at size" });
  });
});

describe("the assessment's metrics bag drops what the card draws structurally", () => {
  it("renders each verdict once, from the typed field", () => {
    // The disagreement is what makes this test able to fail: the free-form
    // `calibration` string says one thing and the typed `confidenceCalibration`
    // another, and nothing forces them to agree. Only the typed value renders.
    const memo = riskMemo({
      confidenceCalibration: "overconfident",
      metrics: {
        calibration: "calibrated",
        sizing: "smaller",
        invalidation: "tighter",
        holdingPeriod: "unchanged",
      },
    });
    const kept = riskDisplayMetrics("assessment", memo.metrics);
    expect(kept).toBeNull();
    expect(JSON.stringify(kept)).not.toContain("calibrated");
    expect(memo.confidenceCalibration).toBe("overconfident");
  });

  it("lets a metric nobody anticipated through — the denylist property", () => {
    // A sentinel-value filter would keep all four mirrors; an allowlist of
    // today's four keys would swallow this one. Only a denylist does both.
    const kept = riskDisplayMetrics("assessment", {
      calibration: "calibrated",
      sizing: "smaller",
      invalidation: "tighter",
      holdingPeriod: "unchanged",
      correlationRegime: "risk-off, so the hedge is less reliable",
    });
    expect(kept).toEqual({
      correlationRegime: "risk-off, so the hedge is less reliable",
    });
  });
});

describe("adjustments render in the axes' declared order, and only where published", () => {
  it("renders a persona's bare directions across all three axes", () => {
    const rows = riskAdjustmentRows(
      riskMemo({
        proposedAdjustments: {
          sizing: "smaller",
          holdingPeriod: "unchanged",
          invalidation: "tighter",
        },
      }),
    );
    expect(rows.map((r) => `${r.label} ${r.direction}`)).toEqual([
      "sizing smaller",
      "holding period unchanged",
      "invalidation tighter",
    ]);
    // A persona stores no reasoning, so nothing is invented for it.
    expect(rows.every((r) => r.rationale === null)).toBe(true);
  });

  it("renders the assessment's reasoning and attribution", () => {
    const rows = riskAdjustmentRows(
      riskMemo({
        recommendedAdjustments: {
          sizing: {
            direction: "smaller",
            rationale: "Invalidation sits inside one day's average range",
            attributedTo: "conservative",
          },
          holdingPeriod: null,
          invalidation: null,
        },
      }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      label: "sizing",
      direction: "smaller",
      attributedTo: "conservative",
    });
  });

  it("contributes no row for an axis the memo left null", () => {
    // Never a defaulted "unchanged" — that would assert a judgement the desk
    // did not make. A memo that DOES say "unchanged" still renders (the value
    // is in each direction enum precisely so a no-op can be attributed).
    const rows = riskAdjustmentRows(
      riskMemo({
        proposedAdjustments: {
          sizing: null,
          holdingPeriod: "longer",
          invalidation: null,
        },
      }),
    );
    expect(rows.map((r) => r.label)).toEqual(["holding period"]);
  });

  it("renders no adjustments section when the memo published none", () => {
    expect(riskAdjustmentRows(riskMemo())).toEqual([]);
    expect(riskAdjustmentRows(null)).toEqual([]);
  });
});

describe("an empty list is missing signal, never a finding", () => {
  it("collapses a persona that raised nothing to no section", () => {
    // Aggressive and conservative emit `[]` by prompt. That is the prompt's
    // instruction, not a desk that found no risks — so it renders nothing
    // rather than "raised: none".
    expect(riskRaisedEntries(riskMemo({ raisedRisks: [] }))).toEqual([]);
    expect(riskRaisedEntries(riskMemo())).toEqual([]);
  });

  it("prefers the assessment's attributed critical risks", () => {
    const entries = riskRaisedEntries(
      riskMemo({
        criticalRisks: [
          {
            description: "Invalidation sits inside one day's average range",
            severity: "high",
            raisedBy: "conservative",
          },
        ],
      }),
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]?.raisedBy).toBe("conservative");
  });

  it("carries a persona's severities through untouched", () => {
    const entries = riskRaisedEntries(
      riskMemo({
        raisedRisks: [
          { description: "The margin thesis rests on one disclosure", severity: "medium" },
        ],
      }),
    );
    expect(entries[0]?.severity).toBe("medium");
  });
});
