/**
 * Unit tests for `reconcileFundClassification` (FIX-762 follow-up): a ticker
 * stored `assetType: "equity"` with no resolvable GICS sector is, for a real
 * dev book, overwhelmingly a broad-market/sector/thematic ETF or crypto trust
 * mistyped at import — the ticker shape gives the CSV/PDF classifier no way to
 * tell it apart from a real equity. Yahoo's own instrument-kind field can.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fetchYahooQuoteKindMock } = vi.hoisted(() => ({
  fetchYahooQuoteKindMock: vi.fn(),
}));

vi.mock("../src/flows/analysis/tools/providers/yahoo", () => ({
  fetchYahooQuoteKind: fetchYahooQuoteKindMock,
}));

import { reconcileFundClassification } from "../src/flows/portfolio/reconcile-fund-classification";
import { _resetCache } from "../src/flows/analysis/tools/runtime/cache";

// The reconciliation result is cache-deduped (getOrFetch, process-wide) —
// reset between tests so one test's ticker lookup can't leak into another's.
beforeEach(() => {
  _resetCache();
});

afterEach(() => {
  fetchYahooQuoteKindMock.mockReset();
});

describe("reconcileFundClassification", () => {
  it("corrects a broad-market ETF (Yahoo quoteType: ETF) to assetType etf", async () => {
    fetchYahooQuoteKindMock.mockResolvedValue("ETF");
    const out = await reconcileFundClassification("VOO");
    expect(out).toEqual({ assetClass: "equity", assetType: "etf", attributes: { kind: "none" } });
  });

  it("routes a known bond ETF through the SAME classifier bond-ETF rule (fixed_income, not equity)", async () => {
    // SCHO is in classify-instrument.ts's KNOWN_BOND_ETFS — reusing
    // classifyInstrument (not hand-rolling a class here) means this still
    // resolves fixed_income/etf, not a blanket equity/etf.
    fetchYahooQuoteKindMock.mockResolvedValue("ETF");
    const out = await reconcileFundClassification("SCHO");
    expect(out).toEqual({ assetClass: "fixed_income", assetType: "etf", attributes: { kind: "none" } });
  });

  it("corrects a mutual fund (Yahoo quoteType: MUTUALFUND)", async () => {
    fetchYahooQuoteKindMock.mockResolvedValue("MUTUALFUND");
    const out = await reconcileFundClassification("VTSAX");
    expect(out).toEqual({
      assetClass: "equity",
      assetType: "mutual_fund",
      attributes: { kind: "none" },
    });
  });

  it("corrects a crypto trust ETF-labeled CRYPTOCURRENCY quote to assetType crypto", async () => {
    fetchYahooQuoteKindMock.mockResolvedValue("CRYPTOCURRENCY");
    const out = await reconcileFundClassification("BTC");
    expect(out).toEqual({ assetClass: "crypto", assetType: "crypto", attributes: { kind: "none" } });
  });

  it("corrects a money-market fund (Yahoo quoteType: MONEYMARKET) to the cash-equivalent classification", async () => {
    fetchYahooQuoteKindMock.mockResolvedValue("MONEYMARKET");
    const out = await reconcileFundClassification("TIMXX");
    expect(out).toEqual({
      assetClass: "cash",
      assetType: "money_market",
      attributes: { kind: "cash_equivalent" },
    });
  });

  it("returns null for a real equity (Yahoo quoteType: EQUITY) — no correction needed", async () => {
    fetchYahooQuoteKindMock.mockResolvedValue("EQUITY");
    expect(await reconcileFundClassification("ZZZZ")).toBeNull();
  });

  it("returns null for a kind outside the fund/crypto set (e.g. INDEX)", async () => {
    fetchYahooQuoteKindMock.mockResolvedValue("INDEX");
    expect(await reconcileFundClassification("^GSPC")).toBeNull();
  });

  it("returns null when the Yahoo lookup itself can't tell (null quoteKind)", async () => {
    fetchYahooQuoteKindMock.mockResolvedValue(null);
    expect(await reconcileFundClassification("NADA")).toBeNull();
  });
});
