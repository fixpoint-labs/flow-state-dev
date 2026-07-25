/**
 * Tests for `computeEtfEligibilitySignature` — the derived key behind the
 * `useEtfProfiles` eligibility-refetch fix (FIX-801 §8 step 6: "a real bug,
 * not a nit"). The route's own fetch set is narrowed to funds that are BOTH
 * priced and classified as a fund, and both settle asynchronously after
 * holdings load; `useApiQuery`'s stable-URL query only re-runs when its URL
 * changes, so this signature — fed into that URL — is what makes a late-
 * settling eligibility input actually trigger a refetch instead of being
 * missed for the whole session.
 *
 * A React-rendering assertion of the hook itself (mount → resolve → refetch)
 * would need jsdom + a component-test harness, which this codebase doesn't
 * have yet (no `.spec.tsx` files exist) — flagged in the PR description as a
 * follow-up rather than added speculatively here. These tests instead pin the
 * PURE logic the fix rests on: the two concrete triggers from the spec text
 * (prices resolving; a classification correction) each change the signature.
 */
import { describe, expect, it } from "vitest";
import { computeEtfEligibilitySignature } from "../components/portfolio/use-etf-profiles";
import type { AccountState } from "../domain/portfolio/schema/portfolio-schema";
import type { Quote } from "../domain/portfolio/services/get-quotes";

function holding(over: Partial<AccountState["holdings"][number]> = {}): AccountState["holdings"][number] {
  return {
    ticker: "SPY",
    quantity: 5,
    costBasis: 300,
    acquiredDate: null,
    assetClass: "equity",
    assetType: "etf",
    attributes: { kind: "none" },
    dataQuality: null,
    ...over,
  };
}

function quote(ticker: string, price: number): Quote {
  return { ticker, price, asOf: "2026-05-06" };
}

describe("computeEtfEligibilitySignature (FIX-801 eligibility-refetch fix)", () => {
  it("changes when a fund's price resolves after a cold mount (trigger 1: prices)", () => {
    const accounts = [{ holdings: [holding({ ticker: "SPY" })] }];
    // Cold mount: no quotes at all.
    const cold = computeEtfEligibilitySignature(accounts, new Map());
    // Price refresh resolves SPY's quote.
    const warm = computeEtfEligibilitySignature(accounts, new Map([["SPY", quote("SPY", 400)]]));
    expect(cold).not.toBe(warm);
  });

  it("changes when a ticker-shaped ETF is corrected from equity to etf (trigger 2: classifications)", () => {
    const priceMap = new Map([["ZZZZ", quote("ZZZZ", 50)]]);
    // Before correction: imported with no type hint, defaults to equity.
    const before = computeEtfEligibilitySignature(
      [{ holdings: [holding({ ticker: "ZZZZ", assetType: "equity" })] }],
      priceMap,
    );
    // After correction: the classifications route self-healed it to etf, and
    // health-section.tsx's own `onAccountsCorrected` effect refetches accounts
    // — this is the post-correction `accounts` prop the signature now sees.
    const after = computeEtfEligibilitySignature(
      [{ holdings: [holding({ ticker: "ZZZZ", assetType: "etf" })] }],
      priceMap,
    );
    expect(before).not.toBe(after);
  });

  it("is stable when nothing eligibility-relevant changed (no spurious refetch)", () => {
    const accounts = [{ holdings: [holding({ ticker: "SPY" }), holding({ ticker: "AAPL", assetType: "equity" })] }];
    const priceMap = new Map([["SPY", quote("SPY", 400)], ["AAPL", quote("AAPL", 100)]]);
    const first = computeEtfEligibilitySignature(accounts, priceMap);
    const second = computeEtfEligibilitySignature(accounts, priceMap);
    expect(first).toBe(second);
  });

  it("is order-independent — re-fetching with accounts/holdings in a different order doesn't change the signature", () => {
    const priceMap = new Map([["SPY", quote("SPY", 400)], ["AAPL", quote("AAPL", 100)]]);
    const a = computeEtfEligibilitySignature(
      [{ holdings: [holding({ ticker: "SPY" }), holding({ ticker: "AAPL", assetType: "equity" })] }],
      priceMap,
    );
    const b = computeEtfEligibilitySignature(
      [{ holdings: [holding({ ticker: "AAPL", assetType: "equity" }), holding({ ticker: "SPY" })] }],
      priceMap,
    );
    expect(a).toBe(b);
  });

  it("is empty for a fund-less, holding-less book", () => {
    expect(computeEtfEligibilitySignature([], new Map())).toBe("");
  });
});
