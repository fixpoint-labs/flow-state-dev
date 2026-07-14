/**
 * Unit tests for the durable portfolio-mandate leaf (FIX-761):
 * `validatePortfolioMandate` (the business-rule checks the editor + action
 * boundary run), `toleranceToAppetite` (the 1:1 tolerance→appetite default), and
 * `timeHorizonCategoryFor` (the derived horizon category).
 *
 * These are the schema's INTENT checks — each asserts a specific contradiction
 * is caught (over-100 allocation, infeasible corridors, cash-floor conflict,
 * band-width bounds, appetite/tolerance contradiction), not just that parsing
 * succeeds.
 */
import { describe, expect, it } from "vitest";
import {
  portfolioMandateSchema,
  timeHorizonCategoryFor,
  toleranceToAppetite,
  validatePortfolioMandate,
  type PortfolioMandate,
} from "../src/domain/portfolio/schema/portfolio-mandate-schema";

/** Build a schema-valid mandate (defaults filled via parse) so the tests target
 *  BUSINESS validation, not schema parsing. Overrides shallow-merge onto the base. */
function mk(overrides: Record<string, unknown> = {}): PortfolioMandate {
  return portfolioMandateSchema.parse({
    objectives: { riskTolerance: "moderate" },
    constraints: {},
    rebalancing: {},
    timeHorizon: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  });
}

describe("validatePortfolioMandate", () => {
  it("accepts a mandate with no target-allocation policy (constraints only)", () => {
    expect(
      validatePortfolioMandate(
        mk({ constraints: { maxPositionWeightPct: 5, exclusions: ["NVDA"] } }),
      ),
    ).toEqual([]);
  });

  it("accepts an allocation summing below 100 (the remainder is implicit cash)", () => {
    expect(
      validatePortfolioMandate(
        mk({
          targetAllocation: [
            { assetClass: "equity", targetPct: 60 },
            { assetClass: "fixed_income", targetPct: 30 },
          ],
        }),
      ),
    ).toEqual([]);
  });

  it("accepts an explicit-cash allocation summing to exactly 100", () => {
    expect(
      validatePortfolioMandate(
        mk({
          targetAllocation: [
            { assetClass: "equity", targetPct: 60 },
            { assetClass: "fixed_income", targetPct: 30 },
            { assetClass: "cash", targetPct: 10 },
          ],
        }),
      ),
    ).toEqual([]);
  });

  it("rejects a no-cash allocation summing above 100", () => {
    const issues = validatePortfolioMandate(
      mk({
        targetAllocation: [
          { assetClass: "equity", targetPct: 70 },
          { assetClass: "fixed_income", targetPct: 40 },
        ],
      }),
    );
    expect(issues.some((i) => i.includes("sum above 100"))).toBe(true);
  });

  it("rejects an explicit-cash allocation that does not sum to exactly 100", () => {
    const issues = validatePortfolioMandate(
      mk({
        targetAllocation: [
          { assetClass: "equity", targetPct: 60 },
          { assetClass: "cash", targetPct: 10 },
        ],
      }),
    );
    expect(issues.some((i) => i.includes("must sum to 100"))).toBe(true);
  });

  it("rejects infeasible corridors (minimums sum above 100)", () => {
    const issues = validatePortfolioMandate(
      mk({
        targetAllocation: [
          { assetClass: "equity", targetPct: 80, minPct: 80 },
          { assetClass: "fixed_income", targetPct: 20, minPct: 30 },
        ],
      }),
    );
    expect(issues.some((i) => i.includes("infeasible"))).toBe(true);
  });

  it("rejects a cash target below the minimum-cash constraint", () => {
    // 100% equity, no cash bucket → implicit cash target 0, below a 10% floor.
    const issues = validatePortfolioMandate(
      mk({
        targetAllocation: [{ assetClass: "equity", targetPct: 100 }],
        constraints: { minCashPct: 10 },
      }),
    );
    expect(issues.some((i) => i.includes("below the minimum-cash"))).toBe(true);
  });

  it("rejects a duplicate asset-class bucket", () => {
    const issues = validatePortfolioMandate(
      mk({
        targetAllocation: [
          { assetClass: "equity", targetPct: 40 },
          { assetClass: "equity", targetPct: 40 },
        ],
      }),
    );
    expect(issues.some((i) => i.includes("more than once"))).toBe(true);
  });

  it("rejects a bucket whose minPct exceeds its targetPct", () => {
    const issues = validatePortfolioMandate(
      mk({ targetAllocation: [{ assetClass: "equity", targetPct: 50, minPct: 60 }] }),
    );
    expect(issues.some((i) => i.includes("minPct") && i.includes("exceeds"))).toBe(true);
  });

  it("rejects a return target with no return basis", () => {
    const issues = validatePortfolioMandate(
      mk({ objectives: { riskTolerance: "moderate", returnTargetPct: 6 } }),
    );
    expect(issues.some((i) => i.includes("return basis"))).toBe(true);
  });

  it("accepts a return target that names its basis", () => {
    expect(
      validatePortfolioMandate(
        mk({
          objectives: { riskTolerance: "moderate", returnTargetPct: 6, returnBasis: "real" },
        }),
      ),
    ).toEqual([]);
  });

  it("treats band-width bounds as band-type-specific", () => {
    // A 5pp absolute band is valid, not an error.
    expect(
      validatePortfolioMandate(mk({ rebalancing: { bandType: "absolute" } })),
    ).toEqual([]);
    // A relative band above 1 (>100% of target) is nonsense.
    expect(
      validatePortfolioMandate(mk({ rebalancing: { bandType: "relative", bandWidthPct: 1.5 } })).some(
        (i) => i.includes("relative"),
      ),
    ).toBe(true);
    // An absolute band above 100pp is nonsense.
    expect(
      validatePortfolioMandate(mk({ rebalancing: { bandType: "absolute", bandWidthPct: 150 } })).some(
        (i) => i.includes("absolute"),
      ),
    ).toBe(true);
  });

  it("rejects an appetite on the opposite extreme from the tolerance", () => {
    expect(
      validatePortfolioMandate(
        mk({ objectives: { riskTolerance: "conservative" }, riskAppetite: "aggressive-growth" }),
      ).length,
    ).toBeGreaterThan(0);
    expect(
      validatePortfolioMandate(
        mk({ objectives: { riskTolerance: "aggressive" }, riskAppetite: "conservative-income" }),
      ).length,
    ).toBeGreaterThan(0);
  });

  it("allows an adjacent appetite override", () => {
    expect(
      validatePortfolioMandate(
        mk({ objectives: { riskTolerance: "moderate" }, riskAppetite: "aggressive-growth" }),
      ),
    ).toEqual([]);
  });

  it("does NOT flag an unknown appetite id (that is the action's save-only guard)", () => {
    // A stale/unknown id must degrade only the appetite at seed, never blank the
    // whole IPS — so the shared validator leaves it alone.
    expect(
      validatePortfolioMandate(mk({ riskAppetite: "totally-made-up" })),
    ).toEqual([]);
  });
});

describe("toleranceToAppetite", () => {
  it("maps each tolerance to its 1:1 appetite id", () => {
    expect(toleranceToAppetite("conservative")).toBe("conservative-income");
    expect(toleranceToAppetite("moderate")).toBe("balanced");
    expect(toleranceToAppetite("aggressive")).toBe("aggressive-growth");
  });

  it("returns null for a null/undefined tolerance", () => {
    expect(toleranceToAppetite(null)).toBeNull();
    expect(toleranceToAppetite(undefined)).toBeNull();
  });
});

describe("timeHorizonCategoryFor", () => {
  it("derives the category from the stored years", () => {
    expect(timeHorizonCategoryFor(1)).toBe("short");
    expect(timeHorizonCategoryFor(5)).toBe("intermediate");
    expect(timeHorizonCategoryFor(10)).toBe("intermediate");
    expect(timeHorizonCategoryFor(20)).toBe("long");
  });

  it("returns null when no horizon is set", () => {
    expect(timeHorizonCategoryFor(null)).toBeNull();
  });
});

describe("rebalancing band default (unit-correct per band type)", () => {
  it("fills a relative default of 0.2 (±20%) when omitted", () => {
    expect(mk({ rebalancing: { bandType: "relative" } }).rebalancing.bandWidthPct).toBe(0.2);
  });

  it("fills an absolute default of 5 (±5pp) when omitted", () => {
    expect(mk({ rebalancing: { bandType: "absolute" } }).rebalancing.bandWidthPct).toBe(5);
  });
});
