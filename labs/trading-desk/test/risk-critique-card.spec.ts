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
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  adjustmentHasNote,
  riskAdjustmentRows,
  riskCardVariant,
  riskDisplayMetrics,
  riskHeaderModel,
  riskRaisedEntries,
  type RiskMemoData,
} from "../components/theses/risk-critique-card";
import { RiskCritiqueCard } from "../components/theses/risk-critique-card";
import { RiskPanel } from "../components/summary/risk-panel";
import type { RiskCalibration } from "../components/risk-vocabulary";
import { PHASE_4_MEMO_KEYS, type AgentName } from "../flows/analysis/registry";

function riskMemo(overrides: Partial<RiskMemoData> = {}): RiskMemoData {
  return {
    label: "Conservative Risk",
    headline: "Size is too large for the invalidation distance",
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

describe("the header never states a verdict the structured sections contradict", () => {
  // The defect this closes, in the desk's own words. `conservative.prompt.md`
  // line 11 pins the officer's `rating` to the literal string "size correct",
  // UNCONDITIONALLY. Line 35 of the same prompt names `smaller` as the TYPICAL
  // answer for `proposedAdjustments.sizing`. `rating` is `z.string()` in
  // `personaCritiqueOutputSchema` with nothing tying it to the typed field.
  //
  // So the ordinary conservative memo carries a header verdict and a structured
  // verdict that say opposite things, and the reader cannot tell which is true.
  // Every fixture below is built on that DISAGREEMENT on purpose: a fixture
  // whose two copies agree cannot fail on this defect, so it would certify the
  // bug rather than catch it.

  it("suppresses a conservative officer's pinned rating while it wants the position smaller", () => {
    const memo = riskMemo({
      label: "Conservative Risk",
      posture: "conservative",
      proposedAdjustments: {
        sizing: "smaller",
        holdingPeriod: "shorter",
        invalidation: "tighter",
      },
    });
    // The stored rating the prompt pins, reintroduced the only way it still
    // can be — from outside the card's own data type.
    const stored = { ...memo, rating: "size correct" } as RiskMemoData;

    const header = riskHeaderModel("persona", stored);
    expect(header.rating).toBeNull();

    // ...and the verdict the reader is left with is the structured one, which
    // is the opposite of what the suppressed header claimed.
    expect(
      riskAdjustmentRows(stored).map((r) => `${r.label} ${r.direction}`),
    ).toContain("sizing smaller");
  });

  it("suppresses an aggressive officer's pinned rating when it moved nothing", () => {
    // `aggressive.prompt.md` line 11 pins `rating` to "upsize"; line 28 allows
    // `unchanged`. The header would announce an upsize the memo never asked for.
    const stored = {
      ...riskMemo({
        posture: "aggressive",
        proposedAdjustments: {
          sizing: "unchanged",
          holdingPeriod: "unchanged",
          invalidation: "unchanged",
        },
      }),
      rating: "upsize",
    } as RiskMemoData;

    expect(riskHeaderModel("persona", stored).rating).toBeNull();
    expect(
      riskAdjustmentRows(stored).map((r) => `${r.label} ${r.direction}`),
    ).toContain("sizing unchanged");
  });

  it("suppresses the assessment's free-form rating against its typed calibration", () => {
    // The consolidated assessment has the same shape: `rating` is free-form and
    // independent of the typed `confidenceCalibration` enum beside it.
    const stored = {
      ...riskMemo({
        confidenceCalibration: "overconfident",
        calibrationRationale: "The base rate for this setup is well below the memo's",
      }),
      rating: "calibrated as proposed",
    } as RiskMemoData;

    const header = riskHeaderModel("assessment", stored);
    expect(header.rating).toBeNull();
    expect(stored.confidenceCalibration).toBe("overconfident");
  });

  it("still hands the header its filtered metrics — suppression is of the rating only", () => {
    // The rating rule must not become a reason the chip grid goes missing.
    const stored = {
      ...riskMemo({
        posture: "conservative",
        metrics: {
          stance: "Wants the position smaller until the disclosure lands",
          structuralChange: "—",
          scopeChange: "—",
          exitDiscipline: "Stop sits inside one day's range",
          stopMechanics: "—",
          followOn: "—",
        },
      }),
      rating: "size correct",
    } as RiskMemoData;

    const header = riskHeaderModel("persona", stored);
    expect(header.rating).toBeNull();
    expect(header.metrics).toEqual({
      stance: "Wants the position smaller until the disclosure lands",
      exitDiscipline: "Stop sits inside one day's range",
    });
  });
});

describe("attribution survives an empty rationale", () => {
  // `recommendedAdjustments.*.rationale` and `.attributedTo` are two separate
  // required `z.string()`s — neither is `.min(1)`, so a schema-valid memo can
  // persist an empty rationale beside a populated attribution. The Summary
  // tab's RiskPanel draws `(attributedTo)` unconditionally, so when the card
  // hid attribution alongside the missing rationale the same stored record
  // read two different ways on two surfaces.

  it("keeps the attribution on a row whose rationale is empty", () => {
    const rows = riskAdjustmentRows(
      riskMemo({
        recommendedAdjustments: {
          sizing: {
            direction: "smaller",
            rationale: "",
            attributedTo: "conservative",
          },
          holdingPeriod: null,
          invalidation: null,
        },
      }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.rationale).toBeNull();
    expect(rows[0]?.attributedTo).toBe("conservative");
    // The row must still draw its trailing note, or the attribution the row
    // carries never reaches the screen — which is the defect.
    expect(adjustmentHasNote(rows[0]!)).toBe(true);
  });

  it("draws a note when either half is present, and none when neither is", () => {
    const base = { label: "sizing", direction: "smaller" };
    expect(
      adjustmentHasNote({
        ...base,
        rationale: "Range is too tight",
        attributedTo: "conservative",
      }),
    ).toBe(true);
    expect(
      adjustmentHasNote({ ...base, rationale: "Range is too tight", attributedTo: null }),
    ).toBe(true);
    expect(
      adjustmentHasNote({ ...base, rationale: null, attributedTo: "conservative" }),
    ).toBe(true);
    // A persona's bare direction carries neither half — no note, no empty parens.
    expect(adjustmentHasNote({ ...base, rationale: null, attributedTo: null })).toBe(false);
  });

  it("leaves a persona's bare direction without a note", () => {
    const rows = riskAdjustmentRows(
      riskMemo({
        proposedAdjustments: { sizing: "smaller", holdingPeriod: null, invalidation: null },
      }),
    );
    expect(rows[0]?.attributedTo).toBeNull();
    expect(adjustmentHasNote(rows[0]!)).toBe(false);
  });
});

/**
 * The calibration verdict is one of the few rules whose whole content is the
 * rendered output: the COLOUR is the signal, so a helper test cannot see it.
 * Both surfaces are rendered with `renderToStaticMarkup` (no DOM needed) and the
 * class on the verdict span is read straight off the markup.
 */
const ASSESSMENT_AGENT = PHASE_4_MEMO_KEYS.riskAssessment.agentName as AgentName;

/** The class attribute of the span whose only text is `verdict`. */
function verdictClass(html: string, verdict: string): string {
  const match = html.match(
    new RegExp(`<span class="([^"]*)"[^>]*>${verdict}</span>`),
  );
  if (match === null) throw new Error(`no verdict span for "${verdict}"`);
  return match[1];
}

function cardMarkup(verdict: RiskCalibration): string {
  return renderToStaticMarkup(
    createElement(RiskCritiqueCard, {
      agent: ASSESSMENT_AGENT,
      data: riskMemo({ confidenceCalibration: verdict }),
    }),
  );
}

function panelMarkup(verdict: RiskCalibration): string {
  return renderToStaticMarkup(
    createElement(RiskPanel, {
      criticalRisks: [],
      keyDependencies: [],
      verdict: {
        confidenceCalibration: verdict,
        calibrationRationale: null,
        recommendedAdjustments: null,
      },
    }),
  );
}

const VERDICTS: RiskCalibration[] = [
  "overconfident",
  "calibrated",
  "underconfident",
];

describe("the calibration verdict signals its severity on both surfaces", () => {
  for (const verdict of VERDICTS) {
    it(`draws "${verdict}" identically on the Theses card and the Summary panel`, () => {
      // The two surfaces read the SAME stored field. If only one colours it,
      // the Theses tab under-signals on data the Summary tab flags.
      const card = verdictClass(cardMarkup(verdict), verdict);
      const panel = verdictClass(panelMarkup(verdict), verdict);
      expect(card).toBe(panel);
    });
  }

  it("colours a miscalibrated desk as a warning and a calibrated one as live", () => {
    // The rule the colour encodes, not merely that some class is present: a
    // map that returned one class for all three verdicts would pass the
    // agreement test above and still delete the signal.
    expect(verdictClass(cardMarkup("overconfident"), "overconfident")).toContain(
      "--c-warn",
    );
    expect(
      verdictClass(cardMarkup("underconfident"), "underconfident"),
    ).toContain("--c-warn");
    expect(verdictClass(cardMarkup("calibrated"), "calibrated")).toContain(
      "--c-live",
    );
  });
});
