/**
 * Unit tests for the LensCard view-model builder (Slice 7, spec 07 §10a).
 *
 * `buildLensCardModel` is the pure mapping the dedicated lens-memo card draws
 * from. The test env is node + `.spec.ts` (no JSX rendering), so — matching
 * `aggregate.ts`'s `stanceToAxis` precedent — the load-bearing logic is
 * extracted into a pure helper and tested directly. These are INTENT-ENCODING
 * tests (BP-005): each assertion locks a real-money honesty rule, not just a
 * code path.
 *
 *   - the card reads the lens's own stance + self-reported conviction back from
 *     the committed memo (the convergence signal is per-lens, so a wrong read
 *     would mis-attribute a verdict);
 *   - the `missingData` / `dataGap` honesty line is recovered from the
 *     synthesized "Data gaps (honesty)" body section — a missing metric MUST
 *     surface, never be hidden (BP-020 / spec 07 §13);
 *   - attribution is the pack's "applying X's documented methodology" string,
 *     not a claim about what the investor thinks today;
 *   - the structural-bear flag is set for forensic-skeptic ONLY (spec 07 §15.5)
 *     so a lone forensic dissent reads as expected, never alarming divergence —
 *     and this is UI labelling derived inline from the lensId, NOT a schema
 *     change to the convergence handler.
 */
import { describe, expect, it } from "vitest";
import {
  buildLensCardModel,
  type LensMemoData,
} from "../components/theses/lens-card";
import { LENS_PACK } from "../flows/analysis/agents/lenses/lenses";
import type { ThesisSection } from "../flows/analysis/resources";

/** Build a lens memo's client-data subset the way the Slice-5 writer's
 *  `lensBody` synthesizes it: a Verdict + Key driver section, plus an optional
 *  "Data gaps (honesty)" section carrying `dataGap` (as `p`) and `missingData`
 *  (as `items`). */
function lensMemo(opts: {
  label?: string | null;
  verdict?: string;
  stance?: "bullish" | "neutral" | "bearish" | null;
  conviction?: number | null;
  keyDriver?: string;
  dataGap?: string;
  missingData?: string[];
}): LensMemoData {
  const body: ThesisSection[] = [
    { h: "Verdict", p: opts.verdict ?? "Verdict sentence.", items: null },
    { h: "Key driver", p: opts.keyDriver ?? "The single driver.", items: null },
  ];
  const dataGap = opts.dataGap ?? "";
  const missingData = opts.missingData ?? [];
  if (dataGap !== "" || missingData.length > 0) {
    body.push({
      h: "Data gaps (honesty)",
      p: dataGap !== "" ? dataGap : null,
      items: missingData.length > 0 ? missingData : null,
    });
  }
  return {
    label: opts.label ?? null,
    headline: opts.verdict ?? "Verdict sentence.",
    rating: opts.stance ? opts.stance[0].toUpperCase() + opts.stance.slice(1) : null,
    stance: opts.stance ?? null,
    conviction: opts.conviction ?? null,
    body,
  };
}

describe("buildLensCardModel", () => {
  it("reads the lens's stance + conviction and verdict back from the memo", () => {
    const model = buildLensCardModel(
      "qualityValueLens",
      lensMemo({ stance: "bullish", conviction: 0.62, verdict: "Moat holds." }),
    );
    expect(model.lensId).toBe("quality-value");
    expect(model.stance).toBe("bullish");
    expect(model.conviction).toBe(0.62);
    expect(model.verdict).toBe("Moat holds.");
    expect(model.keyDriver).toBe("The single driver.");
  });

  it("frames attribution as the pack's documented methodology, not a live opinion", () => {
    const model = buildLensCardModel("qualityValueLens", lensMemo({ stance: "neutral" }));
    const pack = LENS_PACK.find((l) => l.id === "quality-value");
    expect(model.attribution).toBe(pack?.attribution);
    // The framing string in the card is "applying {attribution}"; the attribution
    // itself must read as a methodology, never "what X thinks today".
    expect(model.attribution).toContain("documented methodology");
  });

  it("surfaces the missing-data honesty line, never hiding a data gap (BP-020)", () => {
    const model = buildLensCardModel(
      "qualityValueLens",
      lensMemo({
        stance: "neutral",
        dataGap: "Could not get EV/EBIT.",
        missingData: ["EV/EBIT", "ROIC"],
      }),
    );
    expect(model.dataGap).toBe("Could not get EV/EBIT.");
    expect(model.missingData).toEqual(["EV/EBIT", "ROIC"]);
  });

  it("reports no data gap when the bundle was sufficient", () => {
    const model = buildLensCardModel("cycleRiskLens", lensMemo({ stance: "bearish" }));
    expect(model.dataGap).toBe("");
    expect(model.missingData).toEqual([]);
  });

  it("flags ONLY the forensic-skeptic lens as the structural bear", () => {
    const forensic = buildLensCardModel(
      "forensicSkepticLens",
      lensMemo({ stance: "bearish", conviction: 0.7 }),
    );
    expect(forensic.lensId).toBe("forensic-skeptic");
    expect(forensic.isStructuralBear).toBe(true);

    for (const agent of [
      "qualityValueLens",
      "cycleRiskLens",
      "macroReflexiveLens",
    ] as const) {
      const model = buildLensCardModel(agent, lensMemo({ stance: "bullish" }));
      expect(model.isStructuralBear).toBe(false);
    }
  });

  it("falls back to the pack label when the memo carries none, and degrades on null data", () => {
    const labelled = buildLensCardModel("macroReflexiveLens", lensMemo({ label: null }));
    const pack = LENS_PACK.find((l) => l.id === "macro-reflexive");
    expect(labelled.label).toBe(pack?.label);

    const empty = buildLensCardModel("forensicSkepticLens", null);
    expect(empty.lensId).toBe("forensic-skeptic");
    expect(empty.isStructuralBear).toBe(true);
    expect(empty.stance).toBeNull();
    expect(empty.conviction).toBeNull();
    expect(empty.verdict).toBe("");
    expect(empty.missingData).toEqual([]);
  });
});
