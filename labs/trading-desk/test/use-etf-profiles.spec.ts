/**
 * Tests for `computeEtfEligibilitySignature` — the derived key behind the
 * `useEtfProfiles` eligibility-refetch fix (FIX-801 §8 step 6: "a real bug,
 * not a nit"). The route's own fetch set is narrowed to holdings that are
 * BOTH priced and a fetch candidate per `isEtfProfileFetchCandidate`
 * (`domain/portfolio/math/etf-profile-map.ts` — ETF-typed, not a curated bond
 * ETF, not flagged inconsistent-history), and the eligibility inputs settle
 * asynchronously after holdings load; `useApiQuery`'s stable-URL query only
 * re-runs when its URL changes, so this signature — fed into that URL — is
 * what makes a late-settling eligibility input actually trigger a refetch
 * instead of being missed for the whole session.
 *
 * A React-rendering assertion of the hook itself (mount → resolve → refetch)
 * would need jsdom + a component-test harness, which this codebase doesn't
 * have yet (no `.spec.tsx` files exist) — flagged in the PR description as a
 * follow-up rather than added speculatively here. These tests instead pin the
 * PURE logic the fix rests on: the two concrete triggers from the spec text
 * (prices resolving; a classification correction) each change the signature,
 * and a holding the route will NEVER fetch (a mutual fund, a curated bond ETF)
 * does NOT change the signature the way a real candidate does — the
 * eligibility-filter-mismatch fix (a review round on this PR, #927).
 */
import { describe, expect, it } from "vitest";
import {
  computeEtfEligibilitySignature,
  hashEligibilitySignature,
} from "../components/portfolio/use-etf-profiles";
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

  it("does NOT flip the candidate bit for a mutual fund — the route never fetches one", () => {
    const priceMap = new Map([["FXAIX", quote("FXAIX", 150)]]);
    // A mutual fund and a plain equity are both fetch-INeligible; the
    // signature must treat them identically (candidate bit 0), not the old
    // behavior of treating a mutual fund as fund-typed (bit 1) — that
    // mismatch against the route's actual (ETF-only) fetch set was a spurious
    // refetch trigger for a ticker that was never going to be warmed.
    const mutualFund = computeEtfEligibilitySignature(
      [{ holdings: [holding({ ticker: "FXAIX", assetType: "mutual_fund" })] }],
      priceMap,
    );
    const equity = computeEtfEligibilitySignature(
      [{ holdings: [holding({ ticker: "FXAIX", assetType: "equity" })] }],
      priceMap,
    );
    expect(mutualFund).toBe(equity);
    expect(mutualFund).toBe("FXAIX:0:1:1:1|short:0");
  });

  it("does NOT flip the candidate bit for a curated bond ETF (assetClass fixed_income) — Decision 5's local pre-filter", () => {
    const priceMap = new Map([["BND", quote("BND", 75)]]);
    // assetType stays "etf" for a bond ETF (it's still ETF-typed for
    // valuation), but assetClass is "fixed_income" — the route's own
    // pre-filter excludes it from the fetch set at zero cost. The signature
    // must agree, not just check assetType === "etf".
    const bondEtf = computeEtfEligibilitySignature(
      [{ holdings: [holding({ ticker: "BND", assetType: "etf", assetClass: "fixed_income" })] }],
      priceMap,
    );
    const equity = computeEtfEligibilitySignature(
      [{ holdings: [holding({ ticker: "BND", assetType: "equity", assetClass: "equity" })] }],
      priceMap,
    );
    expect(bondEtf).toBe(equity);
    expect(bondEtf).toBe("BND:0:1:0:1|short:0");
  });

  it("does NOT flip the candidate bit for a curated bond ETF even with a STALE assetClass (Codex review, FIX-801 sub-PR c)", () => {
    // BND is in the curated KNOWN_BOND_ETFS list. Its stored `assetClass`
    // would normally already read "fixed_income" (the classifier
    // short-circuits ahead of any hint), but `assetClass` is also a
    // user-editable field (the manual asset-class override) — so a row
    // manually (or otherwise) left at "equity" must still be excluded via
    // `isKnownBondEtf`, not just the `assetClass` check. Otherwise a stale
    // row would spend a shared Alpha Vantage unit fetching a profile for a
    // fund the methodology says is pre-filtered at zero cost.
    const priceMap = new Map([["BND", quote("BND", 75)]]);
    const staleAssetClass = computeEtfEligibilitySignature(
      [{ holdings: [holding({ ticker: "BND", assetType: "etf", assetClass: "equity" })] }],
      priceMap,
    );
    const equity = computeEtfEligibilitySignature(
      [{ holdings: [holding({ ticker: "BND", assetType: "equity", assetClass: "equity" })] }],
      priceMap,
    );
    expect(staleAssetClass).toBe(equity);
    expect(staleAssetClass).toBe("BND:0:1:0:1|short:0");
  });

  it("does NOT flip the candidate bit for a flagged inconsistent-history row — but the clean-row bit (round 39) tells it apart from a plain non-ETF holding now", () => {
    const priceMap = new Map([["NVDA", quote("NVDA", 130)]]);
    const flagged = computeEtfEligibilitySignature(
      [
        {
          holdings: [
            holding({ ticker: "NVDA", assetType: "etf", dataQuality: "inconsistent_history" }),
          ],
        },
      ],
      priceMap,
    );
    const equity = computeEtfEligibilitySignature(
      [{ holdings: [holding({ ticker: "NVDA", assetType: "equity" })] }],
      priceMap,
    );
    // The candidate bit (field 2) still agrees — neither is a local-tag fetch
    // candidate, matching `isEtfProfileFetchCandidate`'s own exclusion for a
    // flagged row and for a plain non-ETF holding alike. The FULL signature no
    // longer matches, though: the flagged row has NO clean held row at all
    // (bit 5 = 0), while the plain equity holding does (bit 5 = 1) — genuinely
    // different states for the cache-confirmed refresh path (round 37), so the
    // signature must tell them apart now (round 39's own trigger, below).
    expect(flagged).toBe("NVDA:0:1:1:0|short:0");
    expect(equity).toBe("NVDA:0:1:1:1|short:0");
  });

  it("DOES flip the candidate bit for a genuine ETF fetch candidate (control)", () => {
    const priceMap = new Map([["SPY", quote("SPY", 400)]]);
    const candidate = computeEtfEligibilitySignature(
      [{ holdings: [holding({ ticker: "SPY", assetType: "etf", assetClass: "equity" })] }],
      priceMap,
    );
    expect(candidate).toBe("SPY:1:1:1:1|short:0");
  });

  it("changes when a quantity update flips which lot is DOMINANT for a conflicting-classification ticker (trigger 3: the dominant-lot verdict) — Codex review, FIX-801 sub-PR c round 18", () => {
    // The route's fetch-eligibility now also requires the DOMINANT
    // (largest-market-value) lot's assetClass to not be fixed_income
    // (round 17/18, dominantClassificationByTicker). SPY is held in two
    // accounts with conflicting classifications; a per-row signature can't
    // see which lot is dominant, only that "some row passes" — so a
    // quantity change that flips dominance from the equity-classified lot
    // to the fixed_income-classified one (making the route newly EXCLUDE
    // it, or the reverse, newly INCLUDE it) must still change the signature.
    const priceMap = new Map([["SPY", quote("SPY", 100)]]);
    // Equity lot dominant (1,000 shares) over a tiny fixed_income lot (1 share).
    const equityDominant = computeEtfEligibilitySignature(
      [
        {
          holdings: [
            holding({ ticker: "SPY", assetType: "etf", assetClass: "equity", quantity: 1_000 }),
            holding({ ticker: "SPY", assetType: "etf", assetClass: "fixed_income", quantity: 1 }),
          ],
        },
      ],
      priceMap,
    );
    // A quantity update flips it: fixed_income lot now dominant (1,000
    // shares) over a tiny equity lot (1 share) — same two rows, same
    // per-row candidate bits individually, but the FINAL ticker-level
    // verdict flips from eligible to ineligible.
    const fixedIncomeDominant = computeEtfEligibilitySignature(
      [
        {
          holdings: [
            holding({ ticker: "SPY", assetType: "etf", assetClass: "equity", quantity: 1 }),
            holding({ ticker: "SPY", assetType: "etf", assetClass: "fixed_income", quantity: 1_000 }),
          ],
        },
      ],
      priceMap,
    );
    expect(equityDominant).toBe("SPY:1:1:1:1|short:0");
    expect(fixedIncomeDominant).toBe("SPY:0:1:0:1|short:0");
    expect(equityDominant).not.toBe(fixedIncomeDominant);
  });

  it("changes when a MISTAGGED (non-etf-local-tag) ticker's dominant classification transitions out of fixed-income suppression (trigger 4: the cache-confirmed refresh path's own dominant verdict) — Codex review, FIX-801 sub-PR c round 36, a real bug", () => {
    // SPY held as assetType: "equity" (a classification correction that
    // failed, or a stuck manual override) — round 34's route fix added a
    // SECOND, independent refresh-eligibility source: an existing successful
    // cached profile is refresh-eligible regardless of the local tag, but
    // STILL gated on the dominant lot not being fixed-income-suppressed.
    // Before this fix, `isCandidate` (bit 2) required
    // `candidateRowTickers.has(ticker)` FIRST — which is always false for a
    // ticker whose local tag never reads "etf" — so this transition never
    // changed the signature at all, and a cache-confirmed profile could stay
    // stale indefinitely with nothing to trigger a refetch.
    const priceMap = new Map([["SPY", quote("SPY", 400)]]);
    const suppressed = computeEtfEligibilitySignature(
      [{ holdings: [holding({ ticker: "SPY", assetType: "equity", assetClass: "fixed_income" })] }],
      priceMap,
    );
    const unsuppressed = computeEtfEligibilitySignature(
      [{ holdings: [holding({ ticker: "SPY", assetType: "equity", assetClass: "equity" })] }],
      priceMap,
    );
    // The load-bearing assertion: the signature CHANGES across the
    // transition, despite `candidateRowTickers.has("SPY")` staying false (bit
    // 2 stuck at 0) in BOTH cases — bit 4 is what catches it.
    expect(suppressed).not.toBe(unsuppressed);
    expect(suppressed).toBe("SPY:0:1:0:1|short:0");
    expect(unsuppressed).toBe("SPY:0:1:1:1|short:0");
  });

  it("is stable when a quantity update does NOT flip the dominant-lot verdict (no spurious refetch)", () => {
    const priceMap = new Map([["SPY", quote("SPY", 100)]]);
    const before = computeEtfEligibilitySignature(
      [
        {
          holdings: [
            holding({ ticker: "SPY", assetType: "etf", assetClass: "equity", quantity: 1_000 }),
            holding({ ticker: "SPY", assetType: "etf", assetClass: "fixed_income", quantity: 1 }),
          ],
        },
      ],
      priceMap,
    );
    // The equity lot's quantity changes, but it's still overwhelmingly
    // dominant — the final verdict (eligible) is unchanged.
    const after = computeEtfEligibilitySignature(
      [
        {
          holdings: [
            holding({ ticker: "SPY", assetType: "etf", assetClass: "equity", quantity: 900 }),
            holding({ ticker: "SPY", assetType: "etf", assetClass: "fixed_income", quantity: 1 }),
          ],
        },
      ],
      priceMap,
    );
    expect(before).toBe(after);
  });

  it("changes when a MISTAGGED ticker's ONLY holding transitions from inconsistent-history to clean (trigger 5: the cache-confirmed refresh path's own clean-row verdict) — Codex review, FIX-801 sub-PR c round 39, a real bug", () => {
    // SPY held as assetType: "equity" (mistagged, so `isCandidate` — bit 2 —
    // stays 0 throughout; the local-tag bit never sees this ticker) with its
    // only holding row flagged `inconsistent_history` (FIX-876). Round 37's
    // route fix requires at least one non-flagged held row before a
    // cache-confirmed ticker is refresh-eligible; before THIS fix, nothing in
    // the signature (bits 1-4) changed when the flag cleared, so a
    // cache-confirmed profile could stay stale indefinitely with nothing to
    // trigger a refetch — the same "route added a trigger the client
    // couldn't see" gap round 36 fixed for the dominant-lot verdict.
    const priceMap = new Map([["SPY", quote("SPY", 400)]]);
    const flagged = computeEtfEligibilitySignature(
      [
        {
          holdings: [
            holding({ ticker: "SPY", assetType: "equity", dataQuality: "inconsistent_history" }),
          ],
        },
      ],
      priceMap,
    );
    const clean = computeEtfEligibilitySignature(
      [{ holdings: [holding({ ticker: "SPY", assetType: "equity", dataQuality: null })] }],
      priceMap,
    );
    // The load-bearing assertion: the signature CHANGES across the
    // transition, despite the candidate bit staying 0 in BOTH cases (SPY is
    // never a local-tag candidate here, since assetType never reads "etf") —
    // bit 5 is what catches it.
    expect(flagged).not.toBe(clean);
    expect(flagged).toBe("SPY:0:1:1:0|short:0");
    expect(clean).toBe("SPY:0:1:1:1|short:0");
  });

  it("is stable for a ticker with no dataQuality flag involved at all (control, Codex review, FIX-801 sub-PR c round 39) — the common case's signature format doesn't change shape", () => {
    const priceMap = new Map([["SPY", quote("SPY", 400)]]);
    const first = computeEtfEligibilitySignature(
      [{ holdings: [holding({ ticker: "SPY", assetType: "etf", assetClass: "equity" })] }],
      priceMap,
    );
    const second = computeEtfEligibilitySignature(
      [{ holdings: [holding({ ticker: "SPY", assetType: "etf", assetClass: "equity" })] }],
      priceMap,
    );
    expect(first).toBe(second);
    expect(first).toBe("SPY:1:1:1:1|short:0");
  });

  it("changes when a short position is added or removed, holding everything else constant (trigger 6: the portfolio-wide net-short verdict) — Codex review, FIX-801 sub-PR c round 45, a real bug", () => {
    // TSLA transitions from a long (+10 shares) to a short (-10 shares)
    // holding — same ticker, same price, same classification, same
    // dataQuality. Round 43's route fix skips ALL ETF-profile fetches
    // whenever the portfolio holds ANY short position
    // (computeLookThroughExposure refuses the whole axis regardless). Before
    // this fix, nothing in bits 1-5 changed across this transition, so a
    // view that loaded while a short existed (route already skipped
    // fetching) would never refetch once the user covered it.
    const priceMap = new Map([["TSLA", quote("TSLA", 200)]]);
    const long = computeEtfEligibilitySignature(
      [{ holdings: [holding({ ticker: "TSLA", assetType: "equity", quantity: 10 })] }],
      priceMap,
    );
    const short = computeEtfEligibilitySignature(
      [{ holdings: [holding({ ticker: "TSLA", assetType: "equity", quantity: -10 })] }],
      priceMap,
    );
    // The load-bearing assertion: the signature CHANGES across the
    // transition, purely via the `|short:` suffix — the per-ticker portion
    // is identical either way (TSLA is never a fetch candidate, priced, and
    // clean regardless of quantity sign).
    expect(long).not.toBe(short);
    expect(long).toBe("TSLA:0:1:1:1|short:0");
    expect(short).toBe("TSLA:0:1:1:1|short:1");
  });

  it("is stable when the short-state doesn't change (no spurious refetch) — control, Codex review, FIX-801 sub-PR c round 45", () => {
    const priceMap = new Map([["TSLA", quote("TSLA", 200)]]);
    const first = computeEtfEligibilitySignature(
      [{ holdings: [holding({ ticker: "TSLA", assetType: "equity", quantity: 10 })] }],
      priceMap,
    );
    // Still long — only the quantity changed, not the sign.
    const second = computeEtfEligibilitySignature(
      [{ holdings: [holding({ ticker: "TSLA", assetType: "equity", quantity: 12 })] }],
      priceMap,
    );
    expect(first).toBe(second);
  });

  it("does NOT flip the portfolio-wide short verdict when a short lot nets positive against a larger long lot for the SAME ticker (merged per-ticker, matching route.ts's own merge)", () => {
    const priceMap = new Map([["SPY", quote("SPY", 400)]]);
    const netPositive = computeEtfEligibilitySignature(
      [
        {
          holdings: [
            holding({ ticker: "SPY", assetType: "etf", assetClass: "equity", quantity: -5 }),
            holding({ ticker: "SPY", assetType: "etf", assetClass: "equity", quantity: 50 }),
          ],
        },
      ],
      priceMap,
    );
    expect(netPositive).toBe("SPY:1:1:1:1|short:0");
  });
});

describe("hashEligibilitySignature (Codex review, FIX-801 sub-PR c)", () => {
  it("is stable — the same signature always hashes to the same token", () => {
    const a = hashEligibilitySignature("SPY:1:1,AAPL:0:1");
    const b = hashEligibilitySignature("SPY:1:1,AAPL:0:1");
    expect(a).toBe(b);
  });

  it("differs for different signatures (no trivial collision on a realistic pair)", () => {
    const a = hashEligibilitySignature("SPY:1:1,AAPL:0:1");
    const b = hashEligibilitySignature("SPY:1:0,AAPL:0:1"); // one bit flipped
    expect(a).not.toBe(b);
  });

  it("is a short, fixed-length, URL-safe token regardless of input size — the whole point of hashing instead of embedding the raw signature", () => {
    const hugeSignature = Array.from({ length: 500 }, (_, i) => `TICKER${i}:1:1`).join(",");
    const token = hashEligibilitySignature(hugeSignature);
    expect(token).toMatch(/^[0-9a-f]{8}$/);
    expect(token.length).toBeLessThan(hugeSignature.length);
  });

  it("never throws on an empty signature (a fund-less, holding-less book)", () => {
    expect(() => hashEligibilitySignature("")).not.toThrow();
    expect(hashEligibilitySignature("")).toMatch(/^[0-9a-f]{8}$/);
  });
});
