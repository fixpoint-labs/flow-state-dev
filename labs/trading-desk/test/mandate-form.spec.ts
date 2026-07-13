/**
 * Unit tests for the pure portfolio-mandate form model (FIX-761) — the
 * node-testable logic the editor delegates to (the `thesis-form.spec.ts`
 * precedent). Covers record ↔ form round-trip, payload building (exclusion
 * canonicalization, blank → null, empty-row drop, band-default omission), and the
 * client-side validation that mirrors the server guard.
 */
import { describe, expect, it } from "vitest";
import {
  buildSaveMandatePayload,
  emptyMandateForm,
  mandateFormError,
  mandateRecordToForm,
  type MandateFormState,
} from "../components/portfolio/mandate-form";
import { portfolioMandateSchema } from "../src/flows/portfolio/portfolio-mandate-schema";

function form(overrides: Partial<MandateFormState> = {}): MandateFormState {
  return { ...emptyMandateForm(), ...overrides };
}

describe("buildSaveMandatePayload", () => {
  it("canonicalizes exclusions and drops blanks/dupes", () => {
    const payload = buildSaveMandatePayload(
      form({ exclusions: " nvda, tsla  NVDA " }),
    );
    expect(payload.constraints?.exclusions).toEqual(["NVDA", "TSLA"]);
  });

  it("maps blank optional fields to null", () => {
    const payload = buildSaveMandatePayload(form());
    expect(payload.constraints?.maxPositionWeightPct).toBeNull();
    expect(payload.objectives.returnTargetPct).toBeNull();
    expect(payload.timeHorizon?.years).toBeNull();
  });

  it("drops an allocation row with a blank target", () => {
    const payload = buildSaveMandatePayload(
      form({
        targetAllocation: [
          { assetClass: "equity", targetPct: "60", minPct: "", maxPct: "" },
          { assetClass: "cash", targetPct: "", minPct: "", maxPct: "" },
        ],
      }),
    );
    expect(payload.targetAllocation).toHaveLength(1);
    expect(payload.targetAllocation?.[0]?.assetClass).toBe("equity");
  });

  it("omits bandWidthPct when blank (the schema transform fills the default)", () => {
    const payload = buildSaveMandatePayload(form({ bandType: "relative", bandWidthPct: "" }));
    // Parsing fills the unit-correct relative default (0.2).
    const parsed = portfolioMandateSchema.parse({
      ...payload,
      createdAt: "x",
      updatedAt: "y",
    });
    expect(parsed.rebalancing.bandWidthPct).toBe(0.2);
  });
});

describe("mandateRecordToForm round-trip", () => {
  it("pre-fills the form from a record and rebuilds an equivalent payload", () => {
    const record = portfolioMandateSchema.parse({
      label: "IPS",
      objectives: { riskTolerance: "aggressive", returnTargetPct: 8, returnBasis: "real" },
      targetAllocation: [{ assetClass: "equity", targetPct: 70, minPct: 60, maxPct: 80 }],
      constraints: { maxPositionWeightPct: 5, minCashPct: 5, exclusions: ["NVDA"] },
      rebalancing: { bandType: "absolute", bandWidthPct: 5 },
      timeHorizon: { years: 15 },
      riskAppetite: "aggressive-growth",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const rebuilt = buildSaveMandatePayload(mandateRecordToForm(record));
    expect(rebuilt.objectives.riskTolerance).toBe("aggressive");
    expect(rebuilt.objectives.returnTargetPct).toBe(8);
    expect(rebuilt.constraints?.maxPositionWeightPct).toBe(5);
    expect(rebuilt.constraints?.exclusions).toEqual(["NVDA"]);
    expect(rebuilt.targetAllocation?.[0]).toMatchObject({ assetClass: "equity", targetPct: 70 });
    expect(rebuilt.riskAppetite).toBe("aggressive-growth");
  });

  it("drops a stale/unknown appetite id to '' so the editor can't resubmit it", () => {
    // The seed tolerates a stale appetite id (old constraints still apply), but
    // the dropdown only offers known ids — pre-filling the stale id would silently
    // resubmit it and the save would be rejected after the dialog closed.
    const record = portfolioMandateSchema.parse({
      objectives: { riskTolerance: "moderate" },
      constraints: {},
      rebalancing: {},
      timeHorizon: {},
      riskAppetite: "totally-made-up",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(mandateRecordToForm(record).riskAppetite).toBe("");
  });
});

describe("mandateFormError", () => {
  it("returns null for a valid form", () => {
    expect(mandateFormError(form({ maxPositionWeightPct: "5", exclusions: "NVDA" }))).toBeNull();
  });

  it("flags an unparseable number before it silently nulls out", () => {
    expect(mandateFormError(form({ maxPositionWeightPct: "5O" }))).toMatch(/Max position/);
  });

  it("surfaces a business-rule violation (allocation over 100)", () => {
    const err = mandateFormError(
      form({
        targetAllocation: [
          { assetClass: "equity", targetPct: "70", minPct: "", maxPct: "" },
          { assetClass: "fixed_income", targetPct: "40", minPct: "", maxPct: "" },
        ],
      }),
    );
    expect(err).not.toBeNull();
  });

  it("surfaces the return-basis requirement", () => {
    const err = mandateFormError(form({ returnTargetPct: "6", returnBasis: "" }));
    expect(err).toMatch(/return basis/i);
  });
});
