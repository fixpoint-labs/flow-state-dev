/**
 * Unit tests for the pure evidence-sufficiency gate (FIX-781) —
 * `computeEvidenceGate`. Covers the sufficiency predicate (spine + reward-to-risk
 * + criticalDataThin, fail-closed on absent layers), the no-add clamp
 * (0/positive/null current weight), the initiate/add→hold downgrade, and the
 * withheld-target branch.
 */
import { describe, expect, it } from "vitest";
import {
  computeEvidenceGate,
  deriveCriticalDataThin,
  type EvidenceGateInput,
} from "../flows/analysis/lib/evidence-gate";

/** A sufficient, held-and-priced base case; override per test. */
function input(over: Partial<EvidenceGateInput> = {}): EvidenceGateInput {
  return {
    spineEvidenceBasis: "sufficient",
    spineLowConfidence: false,
    rewardToRiskEvidenceBasis: "sufficient",
    criticalDataThin: false,
    action: "add",
    targetWeightPct: 4,
    currentWeightPct: 2,
    ...over,
  };
}

describe("computeEvidenceGate — sufficiency predicate", () => {
  it("both layers sufficient + data present → sufficient pass-through", () => {
    const r = computeEvidenceGate(input());
    expect(r.verdict).toBe("sufficient");
    expect(r.targetWeightPct).toBe(4);
    expect(r.action).toBe("add");
    expect(r.sizeClamped).toBe(false);
    expect(r.actionDowngraded).toBe(false);
  });

  it("thin spine → insufficient", () => {
    expect(computeEvidenceGate(input({ spineEvidenceBasis: "thin" })).verdict).toBe(
      "insufficient-evidence",
    );
  });

  it("spine lowConfidence alone (basis sufficient) → insufficient", () => {
    expect(computeEvidenceGate(input({ spineLowConfidence: true })).verdict).toBe(
      "insufficient-evidence",
    );
  });

  it("thin reward-to-risk → insufficient", () => {
    expect(
      computeEvidenceGate(input({ rewardToRiskEvidenceBasis: "thin" })).verdict,
    ).toBe("insufficient-evidence");
  });

  it("absent (null) spine → fail-closed insufficient", () => {
    expect(computeEvidenceGate(input({ spineEvidenceBasis: null })).verdict).toBe(
      "insufficient-evidence",
    );
  });

  it("absent (null) reward-to-risk → fail-closed insufficient", () => {
    expect(
      computeEvidenceGate(input({ rewardToRiskEvidenceBasis: null })).verdict,
    ).toBe("insufficient-evidence");
  });

  it("criticalDataThin alone (both layers sufficient) → insufficient", () => {
    const r = computeEvidenceGate(input({ criticalDataThin: true }));
    expect(r.verdict).toBe("insufficient-evidence");
    expect(r.spineSufficient).toBe(true);
    expect(r.rewardToRiskSufficient).toBe(true);
  });
});

describe("computeEvidenceGate — no-add clamp + action downgrade", () => {
  it("portfolio-blind (current 0) initiate 1.5% → hold @ 0%", () => {
    const r = computeEvidenceGate(
      input({
        spineEvidenceBasis: "thin",
        action: "initiate",
        targetWeightPct: 1.5,
        currentWeightPct: 0,
      }),
    );
    expect(r.targetWeightPct).toBe(0);
    expect(r.action).toBe("hold");
    expect(r.actionDowngraded).toBe(true);
    expect(r.sizeClamped).toBe(true);
  });

  it("held+priced 2%, thin, proposed add to 4% → min(4,2)=2%, add→hold", () => {
    const r = computeEvidenceGate(
      input({ spineEvidenceBasis: "thin", action: "add", targetWeightPct: 4, currentWeightPct: 2 }),
    );
    expect(r.targetWeightPct).toBe(2);
    expect(r.action).toBe("hold");
    expect(r.sizeClamped).toBe(true);
  });

  it("held+priced 2%, thin, proposed trim to 1% → 1%, trim preserved", () => {
    const r = computeEvidenceGate(
      input({ spineEvidenceBasis: "thin", action: "trim", targetWeightPct: 1, currentWeightPct: 2 }),
    );
    expect(r.targetWeightPct).toBe(1);
    expect(r.action).toBe("trim");
    expect(r.actionDowngraded).toBe(false);
    expect(r.sizeClamped).toBe(false);
  });

  it("exit and existing hold are preserved on the insufficient branch", () => {
    expect(
      computeEvidenceGate(input({ spineEvidenceBasis: "thin", action: "exit", targetWeightPct: 0, currentWeightPct: 2 })).action,
    ).toBe("exit");
    expect(
      computeEvidenceGate(input({ spineEvidenceBasis: "thin", action: "hold", targetWeightPct: 2, currentWeightPct: 2 })).action,
    ).toBe("hold");
  });
});

describe("computeEvidenceGate — unknown current weight (held-but-unpriced)", () => {
  it("insufficient + null current + add → skip clamp (target preserved), action→hold", () => {
    // Mirrors computePolicyGate's householdWeightKnown:false branch: the numeric
    // clamp is skipped (no fabricated size), the no-add is enforced by the action.
    const r = computeEvidenceGate(
      input({
        spineEvidenceBasis: "thin",
        action: "add",
        targetWeightPct: 4,
        currentWeightPct: null,
      }),
    );
    expect(r.targetWeightPct).toBe(4); // preserved — not withheld, not fabricated
    expect(r.sizeClamped).toBe(false);
    expect(r.currentWeightKnown).toBe(false);
    expect(r.action).toBe("hold");
    expect(r.actionDowngraded).toBe(true);
  });

  it("insufficient + null current + exit → reducing target and action preserved", () => {
    const r = computeEvidenceGate(
      input({ spineEvidenceBasis: "thin", action: "exit", targetWeightPct: 0, currentWeightPct: null }),
    );
    expect(r.action).toBe("exit");
    expect(r.targetWeightPct).toBe(0);
    expect(r.currentWeightKnown).toBe(false);
  });

  it("sufficient run with unknown current → pass-through, currentWeightKnown false", () => {
    const r = computeEvidenceGate(input({ currentWeightPct: null }));
    expect(r.verdict).toBe("sufficient");
    expect(r.targetWeightPct).toBe(4);
    expect(r.currentWeightKnown).toBe(false);
  });
});

describe("computeEvidenceGate — downward-only", () => {
  it("never inflates: insufficient with target below current leaves target unchanged", () => {
    const r = computeEvidenceGate(
      input({ spineEvidenceBasis: "thin", action: "hold", targetWeightPct: 1, currentWeightPct: 5 }),
    );
    expect(r.targetWeightPct).toBe(1);
    expect(r.sizeClamped).toBe(false);
  });
});

/**
 * `deriveCriticalDataThin` — the deterministic missing-substrate signal.
 *
 * FIX-1063 decision 3 widened it: a fundamentals read with no market cap is
 * thin evidence EVEN UNDER A LIVE SOURCE TAG. That is the sparse-but-successful
 * path, where the provider answered and nothing in the payload marks the gap,
 * so the `source` check alone cannot see it. Without a market cap the entire
 * valuation set is unmeasurable, which is the definition of too thin to add
 * real money against.
 */
describe("deriveCriticalDataThin — the market-cap check (FIX-1063)", () => {
  const present = (over: Record<string, unknown> = {}) => ({
    fundamentals: { source: "finnhub", marketCap: 2950, ...over },
    incomeStatement: { source: "edgar" },
    balanceSheet: { source: "edgar" },
    cashflow: { source: "edgar" },
  });

  it("is false when all four payloads are available and the market cap is measured", () => {
    expect(deriveCriticalDataThin(present())).toBe(false);
  });

  it("is TRUE when a live-tagged fundamentals payload carries no market cap", () => {
    // The gate the epic asked for. Tagged `finnhub`, fetch succeeded, market
    // cap absent — this is the shape that used to sail through as sufficient
    // evidence and authorize adding to a position.
    expect(deriveCriticalDataThin(present({ marketCap: null }))).toBe(true);
  });

  it("is TRUE when the field is missing from the payload entirely (legacy shape)", () => {
    const fin = present();
    delete (fin.fundamentals as Record<string, unknown>).marketCap;
    expect(deriveCriticalDataThin(fin)).toBe(true);
  });

  it("keeps a MEASURED zero market cap out of the gate's absence branch", () => {
    // A literal 0 is a value, not a gap — the gate keys on `== null`, not on
    // falsiness, matching the rule everywhere else in this change.
    expect(deriveCriticalDataThin(present({ marketCap: 0 }))).toBe(false);
  });

  it("still fires on the original source-tag conditions", () => {
    // The pre-existing behaviour is unchanged — this is an added condition,
    // not a replacement.
    expect(deriveCriticalDataThin(present({ source: "unavailable" }))).toBe(true);
    expect(
      deriveCriticalDataThin({ ...present(), cashflow: { source: "unavailable" } }),
    ).toBe(true);
    expect(deriveCriticalDataThin({ ...present(), balanceSheet: null })).toBe(true);
    expect(deriveCriticalDataThin(null)).toBe(true);
  });
});
