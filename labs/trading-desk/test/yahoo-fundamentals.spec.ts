/**
 * `fetchYahooFundamentals` — absence vs. measured zero (FIX-1063).
 *
 * This is the sparse-but-successful producer path, and the reason the whole
 * issue is framed by PROVENANCE rather than by the three fields its title
 * named. A `quoteSummary` call can return HTTP 200 with a perfectly valid
 * response that simply omits `financialData.returnOnEquity`. There is no
 * failure, no `source: "unavailable"` tag, no marker of any kind — so before
 * this fix the omission was published as `0` under a live `yahoo` tag, and
 * nothing anywhere in the report could tell a reader it had never been read.
 *
 * The tests pin BOTH directions on purpose. The two failure modes pull opposite
 * ways and each one is a real-money defect:
 *   - absent → `0` fabricates a measurement (a missing market cap makes
 *     enterprise value equal net debt and price-to-book read cheap);
 *   - a measured `0` → `null` deletes a reading the desk actually took (a
 *     break-even company genuinely has a 0% operating margin).
 * Reusing the `!== 0` P/E helpers here would have caused the second.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const { quoteSummaryMock } = vi.hoisted(() => ({ quoteSummaryMock: vi.fn() }));

vi.mock("yahoo-finance2", () => ({
  default: class {
    quoteSummary = quoteSummaryMock;
  },
}));

import { fetchYahooFundamentals } from "../lib/providers/yahoo";

const INPUT = { ticker: "NVDA", date: "2026-05-06" } as const;

afterEach(() => {
  quoteSummaryMock.mockReset();
});

describe("fetchYahooFundamentals — a successful but sparse response", () => {
  it("reports null for every field the response omitted, under the live yahoo tag", async () => {
    // The failure this issue exists to stop: a 200 with the modules present and
    // the numeric fields simply absent.
    quoteSummaryMock.mockResolvedValue({
      summaryDetail: {},
      financialData: {},
      defaultKeyStatistics: {},
    });

    const out = await fetchYahooFundamentals(INPUT);

    expect(out.source).toBe("yahoo");
    expect(out.marketCap).toBeNull();
    expect(out.priceToSales).toBeNull();
    expect(out.returnOnEquity).toBeNull();
    expect(out.operatingMargin).toBeNull();
    expect(out.grossMargin).toBeNull();
  });

  it("reports null when a module itself is missing from the response", async () => {
    quoteSummaryMock.mockResolvedValue({ summaryDetail: { marketCap: 3e12 } });

    const out = await fetchYahooFundamentals(INPUT);

    expect(out.marketCap).toBeCloseTo(3000, 1); // absolute USD → $B
    expect(out.returnOnEquity).toBeNull();
    expect(out.operatingMargin).toBeNull();
  });

  it("keeps a genuinely measured zero as zero", async () => {
    // A break-even name: Yahoo REPORTED these zeros. They are measurements, and
    // the schema's own first edge case says they survive. Both the plain and
    // the `{ raw }`-wrapped shapes Yahoo mixes are covered.
    quoteSummaryMock.mockResolvedValue({
      summaryDetail: {
        marketCap: { raw: 5_000_000_000 },
        priceToSalesTrailing12Months: 0,
      },
      financialData: {
        returnOnEquity: { raw: 0 },
        operatingMargins: 0,
        grossMargins: { raw: 0 },
      },
      defaultKeyStatistics: {},
    });

    const out = await fetchYahooFundamentals(INPUT);

    expect(out.marketCap).toBeCloseTo(5, 5);
    expect(out.priceToSales).toBe(0);
    expect(out.returnOnEquity).toBe(0);
    expect(out.operatingMargin).toBe(0);
    expect(out.grossMargin).toBe(0);
  });

  it("still nulls a zero P/E — that field's zero IS non-physical (FIX-692)", async () => {
    // The distinction the two helpers encode, asserted side by side so a future
    // reader can't collapse them back into one.
    quoteSummaryMock.mockResolvedValue({
      summaryDetail: { trailingPE: 0, marketCap: 1e9 },
      financialData: { operatingMargins: 0 },
      defaultKeyStatistics: {},
    });

    const out = await fetchYahooFundamentals(INPUT);

    expect(out.trailingPE).toBeNull(); // zero P/E → unobserved
    expect(out.operatingMargin).toBe(0); // zero margin → measured
  });

  it("passes a negative margin through — nothing here keys on sign", async () => {
    quoteSummaryMock.mockResolvedValue({
      summaryDetail: { marketCap: 1e9 },
      financialData: { returnOnEquity: -0.31, operatingMargins: { raw: -0.12 } },
      defaultKeyStatistics: {},
    });

    const out = await fetchYahooFundamentals(INPUT);

    expect(out.returnOnEquity).toBeCloseTo(-0.31, 5);
    expect(out.operatingMargin).toBeCloseTo(-0.12, 5);
  });
});
