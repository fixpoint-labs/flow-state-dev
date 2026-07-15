/**
 * Unit tests for `reconcileFundClassification` (FIX-762 follow-up): a ticker
 * stored `assetType: "equity"` with no resolvable GICS sector is, for a real
 * dev book, overwhelmingly a broad-market/sector/thematic ETF or crypto trust
 * mistyped at import — the ticker shape gives the CSV/PDF classifier no way to
 * tell it apart from a real equity. Yahoo's own instrument-kind field can.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { reconcileFundClassification } from "../domain/portfolio/services/reconcile-fund-classification";
const resolveQuoteKind = vi.fn();

afterEach(() => {
  resolveQuoteKind.mockReset();
});

describe("reconcileFundClassification", () => {
  it("corrects a broad-market ETF (Yahoo quoteType: ETF) to assetType etf", async () => {
    resolveQuoteKind.mockResolvedValue("ETF");
    const out = await reconcileFundClassification("VOO", resolveQuoteKind);
    expect(out).toEqual({ assetClass: "equity", assetType: "etf", attributes: { kind: "none" } });
  });

  it("routes a known bond ETF through the SAME classifier bond-ETF rule (fixed_income, not equity)", async () => {
    // SCHO is in classify-instrument.ts's KNOWN_BOND_ETFS — reusing
    // classifyInstrument (not hand-rolling a class here) means this still
    // resolves fixed_income/etf, not a blanket equity/etf.
    resolveQuoteKind.mockResolvedValue("ETF");
    const out = await reconcileFundClassification("SCHO", resolveQuoteKind);
    expect(out).toEqual({ assetClass: "fixed_income", assetType: "etf", attributes: { kind: "none" } });
  });

  it("corrects a mutual fund (Yahoo quoteType: MUTUALFUND)", async () => {
    resolveQuoteKind.mockResolvedValue("MUTUALFUND");
    const out = await reconcileFundClassification("VTSAX", resolveQuoteKind);
    expect(out).toEqual({
      assetClass: "equity",
      assetType: "mutual_fund",
      attributes: { kind: "none" },
    });
  });

  it("corrects a crypto trust ETF-labeled CRYPTOCURRENCY quote to assetType crypto", async () => {
    resolveQuoteKind.mockResolvedValue("CRYPTOCURRENCY");
    const out = await reconcileFundClassification("BTC", resolveQuoteKind);
    expect(out).toEqual({ assetClass: "crypto", assetType: "crypto", attributes: { kind: "none" } });
  });

  it("corrects a money-market fund (Yahoo quoteType: MONEYMARKET) to the cash-equivalent classification", async () => {
    resolveQuoteKind.mockResolvedValue("MONEYMARKET");
    const out = await reconcileFundClassification("TIMXX", resolveQuoteKind);
    expect(out).toEqual({
      assetClass: "cash",
      assetType: "money_market",
      attributes: { kind: "cash_equivalent" },
    });
  });

  it("returns null for a real equity (Yahoo quoteType: EQUITY) — no correction needed", async () => {
    resolveQuoteKind.mockResolvedValue("EQUITY");
    expect(await reconcileFundClassification("ZZZZ", resolveQuoteKind)).toBeNull();
  });

  it("returns null for a kind outside the fund/crypto set (e.g. INDEX)", async () => {
    resolveQuoteKind.mockResolvedValue("INDEX");
    expect(await reconcileFundClassification("^GSPC", resolveQuoteKind)).toBeNull();
  });

  it("returns null when the Yahoo lookup itself can't tell (null quoteKind)", async () => {
    resolveQuoteKind.mockResolvedValue(null);
    expect(await reconcileFundClassification("NADA", resolveQuoteKind)).toBeNull();
  });
});
