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

describe("computeEvidenceGate — withheld target (unknown current weight)", () => {
  it("insufficient + null current → targetWithheld, target null, action→hold", () => {
    const r = computeEvidenceGate(
      input({
        spineEvidenceBasis: "thin",
        action: "add",
        targetWeightPct: 4,
        currentWeightPct: null,
      }),
    );
    expect(r.targetWithheld).toBe(true);
    expect(r.targetWeightPct).toBeNull();
    expect(r.currentWeightKnown).toBe(false);
    expect(r.action).toBe("hold");
    expect(r.sizeClamped).toBe(false);
  });

  it("sufficient run with unknown current → pass-through, currentWeightKnown false, not withheld", () => {
    const r = computeEvidenceGate(input({ currentWeightPct: null }));
    expect(r.verdict).toBe("sufficient");
    expect(r.targetWeightPct).toBe(4);
    expect(r.currentWeightKnown).toBe(false);
    expect(r.targetWithheld).toBe(false);
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
