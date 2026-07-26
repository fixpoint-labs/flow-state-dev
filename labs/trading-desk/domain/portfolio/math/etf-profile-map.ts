/**
 * Shared adapters between the stored ETF-profile row shape (`payload | null` +
 * `refusalReason | null`) and the pure look-through leaf's `FundProfileInput`
 * discriminated union — used by both the Health pane (reading the route's
 * client projection) and the analysis seed (reading the repository row
 * directly), so the row→map judgment call lives in exactly one place.
 *
 * The leaf's own header notes that `NormalizedFundProfile` mirrors
 * `NormalizedEtfProfile` FIELD-FOR-FIELD, so no PAYLOAD reshaping is needed — a
 * stored payload satisfies `NormalizedFundProfile` structurally as-is (TS
 * variable assignment tolerates its two extra fields, `netExpenseRatio` /
 * `inceptionDate`). What IS needed is turning a flat "exactly one of these two
 * is non-null" row into the leaf's union + a ticker-keyed map.
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
import {
  FIXED_INCOME_ATTRIBUTION_SUPPRESSED_REASON,
  isFundConfirmingProfileEntry,
  type FundProfileInput,
  type NormalizedFundProfile,
} from "./etf-look-through";
import { dominantClassificationByTicker } from "./value-holding";

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
 * derivation rather than each reimplementing `new Set(...).map(...)`, which
 * would let the two read sets drift apart.
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
 * **Why this exists.** `allHeldTickers`'s broad read (above) covers every
 * ticker the HOUSEHOLD holds directly, but the oracle also needs evidence for
 * a fund's CONSTITUENTS that the household does NOT separately hold — a held
 * allocation ETF (e.g. AOA) that itself holds component ETFs (e.g. VTI) which
 * aren't ALSO a household position. Without VTI's profile in the map, all
 * three of the oracle's evidence layers fail for it (no stored profile, not
 * on the curated bond-ETF list, not a household holding), so it decomposes as
 * an ordinary single-name stock inside AOA instead of being recognized as
 * fund-of-funds.
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
 * Read-only, same posture as every other broadening in this file: never
 * fetches a constituent, only surfaces whatever the shared, global
 * `app.etf_profiles` table already has cached for it (from this household
 * warming it directly, or another household's fund-of-funds lookup, or a
 * prior constituent broadening elsewhere).
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
 * Every (upper-cased) key in `profiles` whose OWN constituents include at
 * least one of `tickers` — the wrapper funds a caller must WITHDRAW when a
 * `missingConstituentTickers` follow-up read fails partway through the
 * broadening pass.
 *
 * **Why this exists.** `missingConstituentTickers` and the second read it
 * drives are two separate steps; if the second read throws (a genuine DB
 * error), a caller that already merged the FIRST read's wrapper profiles into
 * the map — then swallows the second read's error and moves on — leaves those
 * wrappers in a "looks complete, isn't" state: their fund-of-funds verdict
 * depends on constituent evidence that never arrived. A caller passes the
 * SAME `tickers` list it just failed to read (the exact output of the
 * `missingConstituentTickers` call that preceded the failed read) to find
 * every wrapper whose verdict is now unverifiable.
 *
 * **What a caller does with the result: WITHDRAW, don't delete.** `guards.ts`
 * REPLACES each affected wrapper's map entry with
 * `{ payload: null, refusalReason: CONSTITUENT_EVIDENCE_UNAVAILABLE_REASON }`
 * (`etf-look-through.ts`) rather than deleting the key outright. Deleting
 * would also delete the wrapper's OWN fund evidence: if the wrapper's local
 * `assetType` is stale/mistyped (not fund-typed), `resolveTickerIsFund`'s
 * layer 1a can't prove it's a fund either, and with the stored profile gone
 * (layer 1b) the oracle falls all the way to layer 1c — the wrapper's own
 * non-fund classification — and reports it as an ordinary direct stock,
 * potentially a huge fabricated single-name concentration, instead of a
 * diversified fund. The withdrawal reason is deliberately recognized by
 * `resolveTickerIsFund`'s layer 1b as POSITIVE fund evidence (the same bucket
 * as `"ineligible"`/`"malformed"` — the fetch resolved something for this
 * ticker at some point; what's missing is confidence in its CONSTITUENTS, not
 * whether it's a fund), so the wrapper still reads as an opaque fund-of-funds
 * — never decomposed (constituent evidence is unverified), never mistaken for
 * a direct name.
 */
export function fundsReferencingTickers(
  profiles: ReadonlyMap<
    string,
    { payload: { constituents: ReadonlyArray<{ ticker: string | null }> } | null } | undefined
  >,
  tickers: ReadonlyArray<string>,
): string[] {
  const tickerSet = new Set(tickers.map((t) => t.toUpperCase()));
  const affected: string[] = [];
  for (const [key, entry] of profiles.entries()) {
    if (entry === undefined || entry.payload === null) continue;
    const references = entry.payload.constituents.some(
      (c) => c.ticker !== null && tickerSet.has(c.ticker.toUpperCase()),
    );
    if (references) affected.push(key);
  }
  return affected;
}

/**
 * Suppresses attribution for any ticker whose DOMINANT lot (the largest
 * `|marketValue|` row across accounts — {@link dominantClassificationByTicker})
 * is classified `assetClass === "fixed_income"`, in an already-built
 * `FundProfileInput` map, before it reaches the look-through leaf.
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
 * from before the reclassification, or from another household.
 *
 * **REPLACES a fund-confirming entry with an opaque-but-fund-evidence
 * refusal; PROACTIVELY SEEDS one for a curated ticker with no entry at all;
 * never touches a non-fund-confirming entry or manufactures one for a
 * non-curated ticker.** `resolveTickerIsFund`'s (`etf-look-through.ts`)
 * evidence-ordering oracle treats a ticker's map entry as one of three
 * things: POSITIVE fund evidence (a real `payload`, or a refusal reason that
 * only withholds attribution — `"ineligible"`, `"malformed"`,
 * `CONSTITUENT_EVIDENCE_UNAVAILABLE_REASON`,
 * `FIXED_INCOME_ATTRIBUTION_SUPPRESSED_REASON`), DISPROOF (`"not_an_etf"`),
 * or NEUTRAL — no entry at all, or a transport-failure refusal
 * (`"quota"`/`"transient"`) that says nothing about fund-ness either way.
 * This function must preserve that distinction, not collapse it:
 *
 * - **Fund-confirming entry** (`isFundConfirmingProfileEntry`, exported by
 *   `etf-look-through.ts` — the same check the oracle's own layer 1b makes) —
 *   REPLACE with `{ payload: null, refusalReason:
 *   FIXED_INCOME_ATTRIBUTION_SUPPRESSED_REASON }`. Deleting the key outright
 *   would lose the ticker's only positive fund evidence when its local
 *   `assetType` is stale (still tagged `equity` while `assetClass` is now
 *   `fixed_income`, the manual-override state): the oracle would fall all the
 *   way to the ticker's own stale `equity` tag and report it as an ordinary
 *   direct stock — a fabricated single-name concentration for what's actually
 *   a bond fund. Replacing with a reason the oracle still recognizes as
 *   positive evidence keeps it reading as a fund, just with this one
 *   attribution suppressed — opaque-fund on the WRAPPER basis, never
 *   decomposed.
 * - **Disproof (`"not_an_etf"`) or neutral (`"quota"`/`"transient"`)** — LEAVE
 *   UNTOUCHED. Neither is fund evidence to withdraw; replacing either would
 *   FLIP fund identity the oracle doesn't otherwise have — a ticker AV has
 *   already proven isn't a fund, or one with only a transient/quota hiccup on
 *   record (still, by the oracle's own rules, no evidence either way), would
 *   incorrectly start reading as an opaque "fixed-income fund" in the
 *   residual instead of the direct name it actually is.
 * - **No entry, NOT on the curated list** — LEAVE ABSENT. An ordinary held
 *   bond whose dominant lot merely happens to be classified `fixed_income`
 *   has no independent fund evidence at all; manufacturing one would fabricate
 *   fund identity from nothing, same as the disproof/neutral case above.
 * - **No entry, ON the curated list** — SEED `{ payload: null, refusalReason:
 *   FIXED_INCOME_ATTRIBUTION_SUPPRESSED_REASON }`. Unlike an ordinary bond,
 *   curated-list membership IS independent, externally-verified fund evidence
 *   — no fetch is needed to establish it, and Decision 5's pre-filter
 *   (`isEtfProfileFetchCandidate`) guarantees a curated ticker is NEVER
 *   fetched, so it can never earn a "real" entry on its own. `resolveTickerIsFund`
 *   already resolves the ticker as a fund without this entry (layer 1a off its
 *   own `assetType`, or layer 2 off the curated list directly), so this seed
 *   doesn't change the fund/not-fund verdict — it fixes the OPACITY REASON the
 *   leaf reports: absent this seed, `computeLookThroughExposure`'s main loop
 *   falls back to `"no stored profile"` for an unentried fund position, which
 *   `UNAVAILABLE_REASONS` (`build-portfolio-context.ts`) reports to the
 *   trader/PM as merely "not yet available" — implying a future fetch might
 *   fill it in, when Decision 5 guarantees one never will.
 *
 * **Judged by the DOMINANT lot, not "any row".** `summarizePortfolioHealth`
 * (`portfolio-health.ts`) resolves a ticker's merged classification by its
 * LARGEST-market-value lot when accounts disagree — this check matches that:
 * a tiny manually-reclassified `fixed_income` lot of, say, SPY does not
 * suppress attribution for a much larger equity-classified SPY position
 * elsewhere in the household. `quotes` is required so the dominant-lot
 * comparison uses real market value, not row order.
 *
 * Deliberately NOT `isEtfProfileFetchCandidate` reapplied here — that
 * predicate is the FETCH decision and is stricter than this check (it also
 * requires `assetType === "etf"`), which would reintroduce the
 * mistyped-equity bug `allHeldTickers`'s own docblock describes: a holding
 * still tagged `equity` locally (the exact case the broad read exists to
 * recover) would fail that stricter check and get its already-correct
 * stored profile suppressed again.
 *
 * **Excludes on EITHER the dominant lot's `assetClass === "fixed_income"` OR
 * `isKnownBondEtf(ticker)`, not just the classified field — the same
 * "trust the curated list directly, don't rely solely on the mutable
 * `assetClass` field" lesson as `isEtfProfileFetchCandidate`'s own bond-ETF
 * check.** `assetClass` is a user-editable field (`setHoldingAssetClass`),
 * so a curated bond ETF (e.g. BND) manually overridden to `assetClass:
 * "equity"` would otherwise still pass this check and get a cached profile
 * decomposed by the look-through leaf for a fund the methodology declares
 * opaque. Checking the curated list directly closes that gap regardless of
 * what the stored field currently says — exactly the fetch predicate's own
 * reasoning, applied here on the attribution side instead of the fetch side.
 * The bond-ETF-list check runs over EVERY held ticker (not just the
 * dominant-lot-fixed-income ones) — a curated bond ETF is fixed income
 * regardless of how any lot of it happens to be classified locally.
 */
export function excludeFixedIncomeFromProfileMap(
  profiles: Map<string, FundProfileInput>,
  holdings: ReadonlyArray<
    Pick<Holding, "ticker" | "assetClass" | "assetType" | "quantity" | "attributes" | "dataQuality">
  >,
  quotes: ReadonlyMap<string, { price: number | null }>,
): Map<string, FundProfileInput> {
  const dominantClassification = dominantClassificationByTicker(holdings, quotes);
  const heldTickers = new Set(holdings.map((h) => h.ticker.toUpperCase()));
  const fixedIncomeTickers = new Set(
    [...heldTickers].filter(
      (ticker) => dominantClassification.get(ticker)?.assetClass === "fixed_income" || isKnownBondEtf(ticker),
    ),
  );
  if (fixedIncomeTickers.size === 0) return profiles;
  const suppressed = new Map(profiles);
  for (const ticker of fixedIncomeTickers) {
    const existing = suppressed.get(ticker);
    if (existing !== undefined) {
      // Only REPLACE an entry that is itself fund-confirming evidence — an
      // existing entry that DISPROVES fund identity (`not_an_etf`) or is
      // NEUTRAL (`quota`/`transient` — a transport failure, not a judgment)
      // must be left untouched: overwriting either with
      // `FIXED_INCOME_ATTRIBUTION_SUPPRESSED_REASON` would flip a proven-or-
      // unproven-non-fund ticker into `resolveTickerIsFund`'s positive-
      // evidence bucket. `isFundConfirmingProfileEntry` (`etf-look-through.ts`)
      // is the same judgment `resolveTickerIsFund`'s own layer 1b makes —
      // shared, not re-derived, so the two can't drift apart.
      if (isFundConfirmingProfileEntry(existing)) {
        suppressed.set(ticker, { payload: null, refusalReason: FIXED_INCOME_ATTRIBUTION_SUPPRESSED_REASON });
      }
      continue;
    }
    // No prior entry. For an ORDINARY ticker whose dominant lot merely
    // happens to be classified `fixed_income` (not on the curated list), that
    // classification alone is no independent evidence it's a fund at all — an
    // ordinary held bond that was never fetched or refused stays absent,
    // reading as a direct holding, same as any other ticker with no fund
    // evidence (the round-18/20 no-manufacture rule).
    //
    // A CURATED bond ETF is different: the curated list itself is
    // independent, externally-verified evidence the ticker is a fund — no
    // fetch is needed to establish that, and no fetch will EVER happen for it
    // (Decision 5's pre-filter, `isEtfProfileFetchCandidate`, permanently
    // excludes every curated ticker from the ETF_PROFILE fill). Leaving it
    // absent doesn't misreport its FUND-NESS (layer 1a/2 already resolve that
    // correctly regardless of a map entry — see `resolveTickerIsFund`), but it
    // does misreport its OPACITY REASON: the leaf's main loop falls back to
    // `"no stored profile"` for an unentried fund position, which
    // `UNAVAILABLE_REASONS` (`build-portfolio-context.ts`) reports to the
    // trader/PM as "not yet available" — implying a future fetch might fill
    // it in, when Decision 5 guarantees one never will. Proactively seeding
    // the permanent-suppression entry reports the true, permanent state
    // instead.
    if (isKnownBondEtf(ticker)) {
      suppressed.set(ticker, { payload: null, refusalReason: FIXED_INCOME_ATTRIBUTION_SUPPRESSED_REASON });
    }
  }
  return suppressed;
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
 * locally but already correctly profiled).
 *
 * ETF-only (the endpoint never fetches mutual funds — Non-goals), excludes a
 * curated bond ETF, and excludes a flagged inconsistent-history row (never a
 * fetch target). Shared by the route's own eligible-ticker derivation and the
 * Health UI's eligibility-refetch signature so a household holding a mutual
 * fund or a bond ETF (which the route will NEVER fetch) can't change the
 * hook's signature and trigger a spurious refetch/cache-bust.
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
