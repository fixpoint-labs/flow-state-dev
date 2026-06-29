/**
 * Unit tests for the report's standing-thesis card builder (FIX-760).
 *
 * Node + `.spec.ts` (no JSX) — the load-bearing lookup/mapping is a pure helper
 * tested directly (the `aggregate.ts` / `lens-card` precedent). INTENT-ENCODING:
 *
 *   - the household's thesis for the report's ticker is matched case-insensitive
 *     (a lower-case report ticker must still find an upper-cased record);
 *   - no thesis (or no ticker) → null, so the card omits cleanly, never a stub;
 *   - missing optional fields stay null (the `—`-for-missing real-money gate);
 *   - `fromReport` reflects whether the thesis was adopted from an analysis run.
 */
import { describe, expect, it } from "vitest";
import { buildStandingThesisModel } from "../components/theses/standing-thesis";
import type { ThesisRecord } from "../src/flows/portfolio/thesis-schema";

function record(overrides: Partial<ThesisRecord> = {}): ThesisRecord {
  return {
    ticker: "NVDA",
    entryRationale: "Durable AI compute moat.",
    invalidationConditions: "Margin compresses below 60%.",
    tripwires: [{ kind: "price", note: "Through the stop", level: 90, byDate: null }],
    timeHorizon: "years",
    targetPrice: 200,
    stopPrice: 90,
    sourceSessionId: "sess_1",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-10T00:00:00.000Z",
    ...overrides,
  };
}

describe("buildStandingThesisModel", () => {
  it("matches the household thesis for the ticker case-insensitively", () => {
    const m = buildStandingThesisModel("nvda", [record()]);
    expect(m).not.toBeNull();
    expect(m!.ticker).toBe("NVDA");
    expect(m!.entryRationale).toBe("Durable AI compute moat.");
    expect(m!.recordedAsOf).toBe("2026-06-10T00:00:00.000Z");
    expect(m!.fromReport).toBe(true);
  });

  it("returns null when no thesis exists for the ticker", () => {
    expect(buildStandingThesisModel("AAPL", [record()])).toBeNull();
  });

  it("returns null when the ticker is null or blank", () => {
    expect(buildStandingThesisModel(null, [record()])).toBeNull();
    expect(buildStandingThesisModel("   ", [record()])).toBeNull();
  });

  it("keeps missing optional fields null (the —-for-missing gate)", () => {
    const m = buildStandingThesisModel("NVDA", [
      record({ invalidationConditions: null, timeHorizon: null, tripwires: [] }),
    ]);
    expect(m!.invalidationConditions).toBeNull();
    expect(m!.timeHorizon).toBeNull();
    expect(m!.tripwires).toEqual([]);
  });

  it("flags a hand-written thesis (no source session) as not from a report", () => {
    const m = buildStandingThesisModel("NVDA", [record({ sourceSessionId: null })]);
    expect(m!.fromReport).toBe(false);
  });
});
