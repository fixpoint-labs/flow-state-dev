/**
 * The legacy-zero normalizer for persisted `financialsData` (FIX-1063).
 *
 * These tests pin the SCOPE of the conversion, because the scope is the whole
 * design. Converting too little leaves resumed pre-fix sessions computing off
 * fabricated market caps; converting too much invents a data gap where there
 * was a measurement, which is the same defect in mirror image. The dividing
 * line is provenance, and it is provable in exactly one direction:
 *
 *   - `source: "unavailable"` → the empty-payload builder is the ONLY producer
 *     of that payload, so every zero in it is PROVABLY a fill. Converting it
 *     invents nothing.
 *   - any live source tag → a zero MAY be a real measurement (a company that
 *     pays no dividend, a break-even margin). Left exactly as it is; the remedy
 *     for those records is re-recording, not coercion.
 */
import { describe, expect, it } from "vitest";
import { normalizeLegacyFinancials } from "../flows/analysis/tools/runtime/normalize-legacy-financials";

/** A pre-fix `unavailable` fundamentals payload, as written before the fix. */
const legacyUnavailableFundamentals = {
  source: "unavailable" as const,
  ticker: "NVDA",
  asOf: "2026-05-06",
  marketCap: 0,
  forwardPE: null,
  trailingPE: null,
  priceToSales: 0,
  returnOnEquity: 0,
  operatingMargin: 0,
  grossMargin: 0,
  dividendYield: null,
};

describe("normalizeLegacyFinancials — converts a provable fill", () => {
  it("nulls the zeros in an unavailable-tagged fundamentals payload", () => {
    const out = normalizeLegacyFinancials({
      fundamentals: legacyUnavailableFundamentals,
    } as never) as { fundamentals: Record<string, unknown> };

    expect(out.fundamentals.marketCap).toBeNull();
    expect(out.fundamentals.priceToSales).toBeNull();
    expect(out.fundamentals.returnOnEquity).toBeNull();
    expect(out.fundamentals.operatingMargin).toBeNull();
    expect(out.fundamentals.grossMargin).toBeNull();
    // Non-numeric identity fields are untouched.
    expect(out.fundamentals.ticker).toBe("NVDA");
    expect(out.fundamentals.source).toBe("unavailable");
  });

  it("normalizes the statement payloads on the same rule", () => {
    const out = normalizeLegacyFinancials({
      balanceSheet: { source: "unavailable", totalDebt: 0, totalAssets: 0 },
      incomeStatement: { source: "unavailable", revenue: 0 },
      cashflow: { source: "unavailable", freeCashFlow: 0 },
    } as never) as Record<string, Record<string, unknown>>;

    expect(out.balanceSheet.totalDebt).toBeNull();
    expect(out.balanceSheet.totalAssets).toBeNull();
    expect(out.incomeStatement.revenue).toBeNull();
    expect(out.cashflow.freeCashFlow).toBeNull();
  });
});

describe("normalizeLegacyFinancials — leaves everything else alone", () => {
  it("does NOT touch a zero under a live source tag", () => {
    // The over-application guard, and the reason the normalizer keys on
    // provenance rather than on the value. Under a live tag these zeros may be
    // real: a company that genuinely pays no dividend, a break-even operating
    // margin. Flipping them would fabricate a gap where there was a fact.
    const live = {
      source: "finnhub" as const,
      ticker: "BRK.B",
      asOf: "2026-05-06",
      marketCap: 0,
      operatingMargin: 0,
      returnOnEquity: 0,
    };
    const out = normalizeLegacyFinancials({ fundamentals: live } as never) as {
      fundamentals: Record<string, unknown>;
    };

    expect(out.fundamentals.marketCap).toBe(0);
    expect(out.fundamentals.operatingMargin).toBe(0);
    expect(out.fundamentals.returnOnEquity).toBe(0);
  });

  it("does not touch a fixture-tagged payload either", () => {
    const out = normalizeLegacyFinancials({
      fundamentals: { source: "fixture", marketCap: 0 },
    } as never) as { fundamentals: Record<string, unknown> };

    expect(out.fundamentals.marketCap).toBe(0);
  });

  it("preserves a non-zero value in an unavailable payload", () => {
    // Only the literal 0 is a fill signal. A number that somehow survived on an
    // unavailable payload is data, not a placeholder.
    const out = normalizeLegacyFinancials({
      fundamentals: { source: "unavailable", marketCap: 2950 },
    } as never) as { fundamentals: Record<string, unknown> };

    expect(out.fundamentals.marketCap).toBe(2950);
  });

  it("is a no-op on post-fix data — same object back", () => {
    // Already-null unavailable payload: nothing to convert. Returning the same
    // reference is what makes it safe to call unconditionally on a hot path.
    const state = {
      fundamentals: { source: "unavailable", marketCap: null, operatingMargin: null },
    } as never;
    expect(normalizeLegacyFinancials(state)).toBe(state);
  });

  it("handles absent / null / partial state without throwing", () => {
    expect(normalizeLegacyFinancials(null)).toBeNull();
    expect(normalizeLegacyFinancials(undefined)).toBeUndefined();
    expect(normalizeLegacyFinancials({} as never)).toEqual({});
    // A legacy record missing a payload entirely.
    const partial = { cashflow: { source: "unavailable", operating: 0 } } as never;
    const out = normalizeLegacyFinancials(partial) as Record<
      string,
      Record<string, unknown>
    >;
    expect(out.cashflow.operating).toBeNull();
    expect(out.fundamentals).toBeUndefined();
  });

  it("does not descend into arrays or unlisted nested shapes", () => {
    // Shallow and schema-keyed by design: a generic deep walk would rewrite
    // zeros in shapes nobody enumerated — a `0` volume bar is a measurement.
    const state = {
      fundamentals: {
        source: "unavailable",
        marketCap: 0,
        bars: [{ close: 0, volume: 0 }],
        nested: { value: 0 },
      },
    } as never;
    const out = normalizeLegacyFinancials(state) as {
      fundamentals: Record<string, unknown>;
    };

    expect(out.fundamentals.marketCap).toBeNull();
    expect(out.fundamentals.bars).toEqual([{ close: 0, volume: 0 }]);
    expect(out.fundamentals.nested).toEqual({ value: 0 });
  });

  it("does not mutate the input", () => {
    // It normalizes a value read back from a live resource handle; writing
    // through would corrupt the stored record.
    const fundamentals = { ...legacyUnavailableFundamentals };
    normalizeLegacyFinancials({ fundamentals } as never);
    expect(fundamentals.marketCap).toBe(0);
  });
});

describe("the normalized payload reaches the evidence gate", () => {
  it("a legacy unavailable-tagged zero market cap reads as thin evidence", async () => {
    // The end-to-end point of the second read boundary: before normalization a
    // legacy `marketCap: 0` looked like a measured market cap to
    // `deriveCriticalDataThin`, so the desk would add to a position on it. The
    // `source: "unavailable"` tag alone already gated this one; the assertion
    // that matters is that normalization does not UNDO that.
    const { deriveCriticalDataThin } = await import(
      "../flows/analysis/lib/evidence-gate"
    );
    const normalized = normalizeLegacyFinancials({
      fundamentals: legacyUnavailableFundamentals,
      balanceSheet: { source: "edgar" },
      incomeStatement: { source: "edgar" },
      cashflow: { source: "edgar" },
    } as never);

    expect(deriveCriticalDataThin(normalized as never)).toBe(true);
  });
});
