/**
 * One shared conversion from a flat, stored ETF-profile row (`payload | null` +
 * `refusalReason | null`, the sub-PR a `EtfProfileRow` shape and its client-side
 * projection) into the pure look-through leaf's `FundProfileInput` discriminated
 * union (FIX-801 sub-PR c).
 *
 * The leaf's own header notes that `NormalizedFundProfile` mirrors
 * `NormalizedEtfProfile` FIELD-FOR-FIELD, so no PAYLOAD reshaping is needed — a
 * stored payload satisfies `NormalizedFundProfile` structurally as-is (TS
 * variable assignment tolerates its two extra fields, `netExpenseRatio` /
 * `inceptionDate`). What IS needed, and is genuinely shared by both consumers
 * (the Health pane, reading the route's client projection, and the analysis
 * seed, reading the repository row directly), is turning a flat "exactly one of
 * these two is non-null" row into the leaf's union + a ticker-keyed map — the
 * SAME judgment call twice would be exactly the kind of duplicated money-math
 * this codebase's `distill-lessons` pattern flags. One copy, here.
 *
 * Pure, no IO — takes plain data, not `db/repository.ts` or the route's response
 * types, so this stays a BP-019 leaf either caller can import without pulling in
 * a runtime dependency on the other's module graph.
 *
 * Also exports {@link isEtfProfileFetchCandidate}, the second shared judgment
 * call this feature needs three copies of: which holdings the route will ever
 * spend an Alpha Vantage unit fetching a profile for.
 */
import type { Holding } from "../schema/portfolio-schema";
import { isKnownBondEtf } from "./classify-instrument";
import type { FundProfileInput, NormalizedFundProfile } from "./etf-look-through";

/** The common shape both callers can trivially produce: a repository row
 *  (`EtfProfileRow`) already has these three fields; the route's client
 *  projection splits them across two response arrays (`EtfProfileEntry` /
 *  `EtfProfileRefusalEntry`), so callers on that side map each array into this
 *  shape before calling {@link toFundProfileMap}. */
export type FundProfileRowInput = {
  ticker: string;
  payload: NormalizedFundProfile | null;
  refusalReason: string | null;
};

/**
 * Ticker-keyed (upper-case) map of `FundProfileInput`, ready for
 * `computeLookThroughExposure` / `summarizePortfolioHealth`'s optional trailing
 * argument. A row with neither a payload nor a refusal reason (should not occur
 * per the stored-row invariant, but the type only guarantees each field is
 * independently nullable) is skipped rather than guessed — the same "never
 * fetched" treatment the leaf already gives a ticker absent from the map
 * entirely.
 */
export function toFundProfileMap(
  rows: ReadonlyArray<FundProfileRowInput>,
): Map<string, FundProfileInput> {
  const map = new Map<string, FundProfileInput>();
  for (const row of rows) {
    const ticker = row.ticker.toUpperCase();
    if (row.payload !== null) {
      map.set(ticker, { payload: row.payload, refusalReason: null });
    } else if (row.refusalReason !== null) {
      map.set(ticker, { payload: null, refusalReason: row.refusalReason });
    }
  }
  return map;
}

/**
 * Whether a holding is one `GET /api/portfolio/etf-profiles` will ever fetch
 * a profile for — the single definition of "fetch-eligible", so the route's
 * own eligible-ticker derivation, the analysis seed's `heldFundTickers`, and
 * the Health UI's eligibility-refetch signature
 * (`computeEtfEligibilitySignature`) all agree on exactly the same set.
 *
 * ETF-only (the endpoint never fetches mutual funds — Non-goals), excludes a
 * curated bond ETF, and excludes a flagged inconsistent-history row (never a
 * fetch target). Before this was extracted, `heldFundTickers` and the
 * signature both independently treated `mutual_fund` as fund-typed and
 * neither excluded a bond ETF / `inconsistent_history` — so a household
 * holding a mutual fund or a bond ETF (which the route will NEVER fetch)
 * still changed the hook's signature, triggering a spurious refetch/
 * cache-bust, and still cost the seed an unnecessary DB read. One predicate,
 * three call sites, no drift.
 *
 * **Bond-ETF exclusion checks BOTH `assetClass !== "fixed_income"` AND
 * `!isKnownBondEtf(ticker)`, not just the classified field.** The stored
 * `assetClass` is normally `fixed_income` for a known bond ETF (the
 * classifier short-circuits ahead of any hint), but it is also a
 * user-editable field (`setHoldingAssetClass`, the manual asset-class
 * override) — so a curated bond ETF whose row was manually reclassified away
 * from `fixed_income` would otherwise still pass this predicate and get
 * fetched, spending a shared 25/day Alpha Vantage unit on a fund the
 * methodology says is pre-filtered at zero cost. Checking the curated list
 * directly closes that gap regardless of what the stored field currently
 * says.
 */
export function isEtfProfileFetchCandidate(
  holding: Pick<Holding, "ticker" | "assetType" | "assetClass" | "dataQuality">,
): boolean {
  return (
    holding.assetType === "etf" &&
    holding.assetClass !== "fixed_income" &&
    !isKnownBondEtf(holding.ticker) &&
    holding.dataQuality !== "inconsistent_history"
  );
}
