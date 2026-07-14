/**
 * Unit tests for the pure portfolio-mandate size gate (FIX-761) —
 * `computePolicyGate`. The full clamp matrix: no-mandate, advisory-only,
 * max-position cap, already-over-cap hold, exclusion, exclusion+cap subsumption,
 * and the unpriced-held branch (`householdWeightKnown: false`, no clamp — never
 * fabricate a weight).
 */
import { describe, expect, it } from "vitest";
import { computePolicyGate } from "../src/flows/analysis/lib/policy-gate";
import {
  portfolioMandateSchema,
  type PortfolioMandate,
} from "../src/flows/portfolio/portfolio-mandate-schema";

function mandate(constraints: Record<string, unknown>): PortfolioMandate {
  return portfolioMandateSchema.parse({
    objectives: { riskTolerance: "moderate" },
    constraints,
    rebalancing: {},
    timeHorizon: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
}

describe("computePolicyGate", () => {
  it("no mandate → no clamp, verdict no-mandate", () => {
    const r = computePolicyGate({
      mandate: null,
      ticker: "NVDA",
      targetWeightPct: 8,
      householdWeightPct: 0,
    });
    expect(r).toMatchObject({
      targetWeightPct: 8,
      excluded: false,
      positionCapClamped: false,
      policyVerdict: "no-mandate",
    });
  });

  it("mandate with no cap and no exclusion → advisory-only, within-policy, no clamp", () => {
    const r = computePolicyGate({
      mandate: mandate({ minCashPct: 10 }),
      ticker: "NVDA",
      targetWeightPct: 8,
      householdWeightPct: 2,
    });
    expect(r.targetWeightPct).toBe(8);
    expect(r.positionCapClamped).toBe(false);
    expect(r.policyVerdict).toBe("within-policy");
  });

  it("target above the cap on a not-over-cap name → clamped to the cap, verdict capped", () => {
    const r = computePolicyGate({
      mandate: mandate({ maxPositionWeightPct: 5 }),
      ticker: "NVDA",
      targetWeightPct: 8,
      householdWeightPct: 2, // held at 2%, under cap
    });
    expect(r.targetWeightPct).toBe(5);
    expect(r.positionCapClamped).toBe(true);
    expect(r.policyVerdict).toBe("capped");
  });

  it("target below the cap → untouched, within-policy", () => {
    const r = computePolicyGate({
      mandate: mandate({ maxPositionWeightPct: 5 }),
      ticker: "NVDA",
      targetWeightPct: 3,
      householdWeightPct: 1,
    });
    expect(r.targetWeightPct).toBe(3);
    expect(r.positionCapClamped).toBe(false);
    expect(r.policyVerdict).toBe("within-policy");
  });

  it("an already-over-cap hold is not force-trimmed (cap floors at the household weight)", () => {
    // Held at 8% household, cap 5%. The at-purchase cap floors at 8% — a buy is
    // capped from adding beyond 8%, but the 8% hold is never trimmed to 5%.
    const r = computePolicyGate({
      mandate: mandate({ maxPositionWeightPct: 5 }),
      ticker: "NVDA",
      targetWeightPct: 10,
      householdWeightPct: 8,
    });
    expect(r.targetWeightPct).toBe(8); // floored at the household weight, not 5
    expect(r.positionCapClamped).toBe(true);
    expect(r.policyVerdict).toBe("capped");
  });

  it("an excluded name → hard no-add to the current household position", () => {
    const r = computePolicyGate({
      mandate: mandate({ exclusions: ["NVDA"] }),
      ticker: "NVDA",
      targetWeightPct: 8,
      householdWeightPct: 3, // held at 3%
    });
    expect(r.targetWeightPct).toBe(3); // no-add to current
    expect(r.excluded).toBe(true);
    expect(r.policyVerdict).toBe("excluded");
  });

  it("an excluded name not held → clamped to 0 (never initiate)", () => {
    const r = computePolicyGate({
      mandate: mandate({ exclusions: ["NVDA"] }),
      ticker: "NVDA",
      targetWeightPct: 8,
      householdWeightPct: 0, // not held
    });
    expect(r.targetWeightPct).toBe(0);
    expect(r.excluded).toBe(true);
    expect(r.policyVerdict).toBe("excluded");
  });

  it("matches the exclusion regardless of casing/whitespace", () => {
    const r = computePolicyGate({
      mandate: mandate({ exclusions: ["NVDA"] }),
      ticker: " nvda ",
      targetWeightPct: 8,
      householdWeightPct: 0,
    });
    expect(r.excluded).toBe(true);
  });

  it("exclusion subsumes the cap (verdict excluded, cap not double-reported)", () => {
    const r = computePolicyGate({
      mandate: mandate({ exclusions: ["NVDA"], maxPositionWeightPct: 5 }),
      ticker: "NVDA",
      targetWeightPct: 8,
      householdWeightPct: 2,
    });
    expect(r.excluded).toBe(true);
    expect(r.positionCapClamped).toBe(false); // subsumed
    expect(r.policyVerdict).toBe("excluded");
    expect(r.targetWeightPct).toBe(2); // no-add to current
  });

  it("held-but-unpriced → NO clamp, householdWeightKnown false (never fabricate a weight)", () => {
    const r = computePolicyGate({
      mandate: mandate({ exclusions: ["NVDA"], maxPositionWeightPct: 5 }),
      ticker: "NVDA",
      targetWeightPct: 8,
      householdWeightPct: null, // held but unpriced
    });
    expect(r.targetWeightPct).toBe(8); // unchanged — clamp skipped
    expect(r.positionCapClamped).toBe(false);
    expect(r.householdWeightKnown).toBe(false);
    expect(r.excluded).toBe(true); // verdict still reflects the exclusion
    expect(r.policyVerdict).toBe("excluded");
  });

  it("held-but-unpriced with a cap (not excluded) → 'unenforced', never a false within-policy", () => {
    const r = computePolicyGate({
      mandate: mandate({ maxPositionWeightPct: 5 }),
      ticker: "NVDA",
      targetWeightPct: 8, // above the cap, but the cap can't be evaluated
      householdWeightPct: null, // held but unpriced
    });
    expect(r.targetWeightPct).toBe(8); // unchanged — clamp skipped
    expect(r.positionCapClamped).toBe(false);
    expect(r.householdWeightKnown).toBe(false);
    expect(r.policyVerdict).toBe("unenforced"); // NOT "within-policy"
  });

  it("held-but-unpriced with NO hard constraint → within-policy (nothing to enforce)", () => {
    const r = computePolicyGate({
      mandate: mandate({ minCashPct: 10 }), // advisory only
      ticker: "NVDA",
      targetWeightPct: 8,
      householdWeightPct: null,
    });
    expect(r.policyVerdict).toBe("within-policy");
  });

  it("reports householdWeightKnown true when a clamp was actually evaluated", () => {
    const r = computePolicyGate({
      mandate: mandate({ maxPositionWeightPct: 5 }),
      ticker: "NVDA",
      targetWeightPct: 3,
      householdWeightPct: 1,
    });
    expect(r.householdWeightKnown).toBe(true);
  });
});
