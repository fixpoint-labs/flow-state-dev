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
 * Also exports {@link isEtfProfileFetchCandidate} — a FETCH-decision
 * predicate (which holdings the route will ever spend an Alpha Vantage unit
 * on), deliberately narrower than, and not to be confused with,
 * {@link allHeldTickers} — the broader READ-eligibility set both the route
 * and the analysis seed share (see the fetch predicate's own docblock for
 * why the two questions are different).
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
 * Every distinct ticker (upper-cased) in a flat holdings list — the shared
 * CACHE-READ ticker set: deliberately unfiltered by fetch-eligibility, so a
 * ticker still tagged `equity`/`mutual_fund`/etc. locally but already
 * correctly profiled (`app.etf_profiles` is global reference data) is still
 * looked up, giving the fund-detection oracle's stale-classification
 * override (`resolveTickerIsFund`'s layer 1b) the evidence it needs.
 *
 * Both call sites that need this exact set — the route's own `GET` handler
 * and the analysis seed's `heldTickersForProfileLookup` — share this one
 * derivation rather than each reimplementing `new Set(...).map(...)`. The
 * route ORIGINALLY reimplemented it (using `isEtfProfileFetchCandidate`'s
 * narrower set for its read, the same bug the seed had) — Codex review on
 * FIX-801 sub-PR c caught it a second time after the seed's own fix, which is
 * exactly the drift risk sharing this helper closes.
 */
export function allHeldTickers(holdings: ReadonlyArray<Pick<Holding, "ticker">>): string[] {
  return [...new Set(holdings.map((h) => h.ticker.toUpperCase()))];
}

/**
 * Every constituent ticker (upper-cased, deduped) referenced by any fund
 * profile ALREADY in the map, that is not itself already a key in the map —
 * i.e. exactly the tickers a caller still needs to read before
 * `resolveTickerIsFund`'s evidence-ordering oracle (`etf-look-through.ts`) can
 * correctly judge them.
 *
 * **The gap this closes (Codex review, FIX-801 sub-PR c round 12, P1 — the
 * same evidence-ordering mechanics that took 32+ review rounds to get right in
 * sub-PR b).** `allHeldTickers`'s broad read (above) covers every ticker the
 * HOUSEHOLD holds directly, but the oracle also needs evidence for a fund's
 * CONSTITUENTS that the household does NOT separately hold — a held
 * allocation ETF (e.g. AOA) that itself holds component ETFs (e.g. VTI) which
 * aren't ALSO a household position. Without VTI's profile in the map, all
 * three of the oracle's evidence layers fail for it (no stored profile, not
 * on the curated bond-ETF list, not a household holding), so it decomposes as
 * an ordinary single-name stock inside AOA instead of being recognized as
 * fund-of-funds — exactly the regression sub-PR b's own fund-of-funds tests
 * pin, except reachable here through wiring this PR (sub-PR c) controls, not
 * the leaf's own logic.
 *
 * **Call this EXACTLY ONCE per snapshot, merge the result, and stop —
 * never loop it to a fixed point.** The leaf never inspects a constituent's
 * OWN constituents: it only ever decomposes the household's own DIRECT
 * positions (the `positions` argument to `computeLookThroughExposure`); a
 * constituent ticker that resolves as a fund becomes residual mass for the
 * axis, never itself decomposed (see `etf-look-through.ts`'s main loop and
 * its module docblock's "one level of look-through only"). The oracle also
 * never reads a constituent profile's CONTENTS, only whether one is present
 * at all (`payload !== null`, or a specific refusal reason) — so there is
 * never a reason to go deeper.
 *
 * This function itself has NO memory of which entries were the ORIGINAL
 * held-fund reads versus already-merged constituent entries — it simply
 * scans every entry currently in the map. So calling it a SECOND time on a
 * map that already contains a merged constituent's own profile (e.g. VTI's)
 * WOULD surface VTI's own constituents (e.g. MSFT) as "missing" too — the
 * function is not itself idempotent once looped. The single-call discipline
 * lives at the call site, not in this function: `guards.ts` and the route's
 * `GET` handler each call this exactly once against the held-tickers read,
 * merge, and never call it again.
 *
 * Read-only, same Decision-1-style posture as every other broadening in this
 * file: never fetches a constituent, only surfaces whatever the shared,
 * global `app.etf_profiles` table already has cached for it (from this
 * household warming it directly, or another household's fund-of-funds
 * lookup, or a prior constituent broadening elsewhere).
 */
export function missingConstituentTickers(
  profiles: ReadonlyMap<
    string,
    { payload: { constituents: ReadonlyArray<{ ticker: string | null }> } | null } | undefined
  >,
): string[] {
  const missing = new Set<string>();
  for (const entry of profiles.values()) {
    if (entry === undefined || entry.payload === null) continue;
    for (const c of entry.payload.constituents) {
      if (c.ticker === null) continue;
      const ticker = c.ticker.toUpperCase();
      if (!profiles.has(ticker)) missing.add(ticker);
    }
  }
  return [...missing];
}

/**
 * Removes any ticker currently classified `assetClass === "fixed_income"`
 * from an already-built `FundProfileInput` map, before it reaches the
 * look-through leaf.
 *
 * `allHeldTickers`'s broad cache read (above) deliberately still looks up a
 * profile for a bond ETF, or for a holding a manual override has since
 * reclassified to `fixed_income` — that read has to stay broad for the
 * mistyped-equity recovery case. But a STORED profile surviving that read is
 * not itself permission to attribute through it: any ticker present in the
 * map with a `payload` gets decomposed by `computeLookThroughExposure`
 * (`etf-look-through.ts`), and bond/commodity-fund attribution is out of
 * scope for this feature (docs/etf-look-through.md — no look-through inside
 * a fixed-income fund) regardless of whether a profile happens to be cached
 * from before the reclassification, or from another household. This closes
 * that gap by removing the entry entirely — the ticker then reads exactly as
 * "never looked up" to the leaf, which is the correct fallback: still
 * classified opaque-fund on the WRAPPER basis if its own `assetType` is
 * fund-typed, just never decomposed (Codex review, FIX-801 sub-PR c).
 *
 * Deliberately NOT `isEtfProfileFetchCandidate` reapplied here — that
 * predicate is the FETCH decision and is stricter than this check (it also
 * requires `assetType === "etf"`), which would reintroduce the
 * mistyped-equity bug `allHeldTickers`'s own docblock describes: a holding
 * still tagged `equity` locally (the exact case the broad read exists to
 * recover) would fail that stricter check and get its already-correct
 * stored profile suppressed again.
 *
 * **Excludes on EITHER `assetClass === "fixed_income"` OR
 * `isKnownBondEtf(ticker)`, not just the classified field — the same
 * "trust the curated list directly, don't rely solely on the mutable
 * `assetClass` field" lesson as `isEtfProfileFetchCandidate`'s own bond-ETF
 * check.** `assetClass` is a user-editable field (`setHoldingAssetClass`),
 * so a curated bond ETF (e.g. BND) manually overridden to `assetClass:
 * "equity"` would otherwise still pass this check and get a cached profile
 * decomposed by the look-through leaf for a fund the methodology declares
 * opaque (Codex review, FIX-801 sub-PR c, round 10). Checking the curated
 * list directly closes that gap regardless of what the stored field
 * currently says — exactly the fetch predicate's own reasoning, applied
 * here on the attribution side instead of the fetch side.
 */
export function excludeFixedIncomeFromProfileMap(
  profiles: Map<string, FundProfileInput>,
  holdings: ReadonlyArray<Pick<Holding, "ticker" | "assetClass">>,
): Map<string, FundProfileInput> {
  const fixedIncomeTickers = new Set(
    holdings
      .filter((h) => h.assetClass === "fixed_income" || isKnownBondEtf(h.ticker))
      .map((h) => h.ticker.toUpperCase()),
  );
  if (fixedIncomeTickers.size === 0) return profiles;
  const filtered = new Map(profiles);
  for (const ticker of fixedIncomeTickers) filtered.delete(ticker);
  return filtered;
}

/**
 * Whether a holding is one `GET /api/portfolio/etf-profiles` will ever
 * SPEND AN ALPHA VANTAGE UNIT FETCHING a profile for — the single definition
 * of "fetch-eligible". Used by the route's own eligible-ticker derivation and
 * the Health UI's eligibility-refetch signature
 * (`computeEtfEligibilitySignature`), which both agree a fetch will happen
 * only for this set.
 *
 * **This is a FETCH predicate, not a READ predicate — do not reuse it to
 * decide which tickers to look up in the already-stored `app.etf_profiles`
 * table.** The seed's `heldTickersForProfileLookup` (`orchestration/
 * guards.ts`) deliberately does NOT filter through this function: reading a
 * cached row is free, and the pure leaf's fund-detection oracle
 * (`resolveTickerIsFund` in `etf-look-through.ts`) is designed to let a
 * STORED profile override a stale/mistyped local `assetType` — narrowing the
 * read to fetch-eligible tickers would silently defeat that override for
 * exactly the ticker it exists to catch (a holding still tagged `equity`
 * locally but already correctly profiled). An earlier version of this file
 * unified both concerns into one predicate; Codex review on FIX-801 sub-PR c
 * caught that this made the seed's cache READ too strict, not just its own
 * fetch decision.
 *
 * ETF-only (the endpoint never fetches mutual funds — Non-goals), excludes a
 * curated bond ETF, and excludes a flagged inconsistent-history row (never a
 * fetch target). Before this was extracted, the eligibility signature
 * independently treated `mutual_fund` as fund-typed and didn't exclude a
 * bond ETF / `inconsistent_history` — so a household holding a mutual fund
 * or a bond ETF (which the route will NEVER fetch) still changed the hook's
 * signature, triggering a spurious refetch/cache-bust. One predicate, two
 * fetch-decision call sites, no drift.
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
