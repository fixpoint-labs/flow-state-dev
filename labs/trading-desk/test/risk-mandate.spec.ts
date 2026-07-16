/**
 * Unit tests for the risk-appetite mandate pack (FIX-752).
 *
 * Covers the config invariants, id resolution, and the "most conservative wins"
 * resolution rule used when selected accounts carry different defaults.
 */
import { describe, expect, it } from "vitest";
import {
  MANDATE_IDS,
  MANDATE_PACK,
  mostConservativeMandate,
  resolveMandate,
  riskMandateIdSchema,
} from "../flows/analysis/lib/risk-mandate";

describe("MANDATE_PACK", () => {
  it("ships exactly the three ids in ascending risk order", () => {
    expect(MANDATE_PACK.map((m) => m.id)).toEqual([...MANDATE_IDS]);
    const ranks = MANDATE_PACK.map((m) => m.riskRank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(new Set(ranks).size).toBe(ranks.length); // distinct ranks
  });

  it("orders the dials monotonically by appetite", () => {
    const [conservative, balanced, aggressive] = MANDATE_PACK;
    // More cautious mandates weigh losses more, demand more asymmetry / return /
    // confidence, tolerate less drawdown, and size smaller.
    expect(conservative.lossAversion).toBeGreaterThan(aggressive.lossAversion);
    expect(conservative.rewardToRiskFloor).toBeGreaterThan(aggressive.rewardToRiskFloor);
    expect(conservative.confidenceFloor).toBeGreaterThan(aggressive.confidenceFloor);
    expect(conservative.maxTolerableLossPct).toBeLessThan(aggressive.maxTolerableLossPct);
    expect(conservative.kellyFraction).toBeLessThan(aggressive.kellyFraction);
    expect(balanced.riskRank).toBe(2);
  });

  it("maintains the capacityVetoCapPct ≤ unclearedCapPct invariant for every preset", () => {
    // The PM commit applies the hard capacity veto BEFORE the soft worth-it cap
    // and relies on capacityVetoCapPct being the tighter bound, so the soft cap
    // never has to fire after a capacity clamp (see the MANDATE_PACK doc
    // comment). A violation would still be safe — both caps only reduce size —
    // but would silently muddy the gate's reasoning, so the pack self-polices.
    for (const m of MANDATE_PACK) {
      expect(m.capacityVetoCapPct).toBeLessThanOrEqual(m.unclearedCapPct);
    }
  });
});

describe("resolveMandate", () => {
  it("resolves a known id to its dial bundle", () => {
    expect(resolveMandate("balanced")?.id).toBe("balanced");
    expect(resolveMandate("conservative-income")?.label).toBe("Conservative income");
  });

  it("returns null for null, empty, or unknown ids (mandate-blind)", () => {
    expect(resolveMandate(null)).toBeNull();
    expect(resolveMandate(undefined)).toBeNull();
    expect(resolveMandate("")).toBeNull();
    expect(resolveMandate("nonexistent")).toBeNull();
  });
});

describe("mostConservativeMandate", () => {
  it("picks the lowest-rank mandate among the selected account defaults", () => {
    expect(
      mostConservativeMandate(["aggressive-growth", "conservative-income", "balanced"])?.id,
    ).toBe("conservative-income");
    expect(mostConservativeMandate(["balanced", "aggressive-growth"])?.id).toBe("balanced");
  });

  it("ignores null/unknown defaults and falls back to null when none resolve", () => {
    expect(mostConservativeMandate(["aggressive-growth", null, "bogus"])?.id).toBe(
      "aggressive-growth",
    );
    expect(mostConservativeMandate([null, undefined, ""])).toBeNull();
    expect(mostConservativeMandate([])).toBeNull();
  });
});

describe("riskMandateIdSchema", () => {
  it("accepts the pack ids and rejects others", () => {
    expect(riskMandateIdSchema.safeParse("balanced").success).toBe(true);
    expect(riskMandateIdSchema.safeParse("bogus").success).toBe(false);
  });
});
