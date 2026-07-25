/**
 * Pure ETF look-through arithmetic (FIX-801) — the second, additive read of
 * household exposure that sees INSIDE a fund: a direct holding and the same
 * name held through a fund add up instead of sitting apart. Kept out of
 * `portfolio-health.ts` (already large) and unit-testable on its own
 * (`summarizePortfolioHealth` delegates to this leaf and keeps everything
 * else — the wrapper-basis fields — exactly as it is today; see Decision 2).
 *
 * Total and pure — guarded division, never throws, empty/degenerate inputs
 * give nulls. No IO, no `@flow-state-dev/core` (BP-019 leaf).
 *
 * INPUT SHAPE NOTE: {@link NormalizedFundProfile} / {@link FundProfileInput}
 * mirror `NormalizedEtfProfile` / `EtfProfileRow` from FIX-801 sub-PR a
 * (`lib/providers/etf-profile.ts`, `db/repository.ts`) FIELD-FOR-FIELD, but
 * are declared fresh here rather than imported. This leaf must stay IO-free
 * (no `db/`, no `lib/providers/` — BP-019), and sub-PR a's branch isn't
 * available from sub-PR b's (they're independent per the spec's DAG, built
 * off `main` in parallel — Decision 10, §8). Sub-PR c, which depends on both,
 * wires the real stored rows through this shape; they are structurally
 * identical by construction, so no adapter should be needed.
 *
 * THE HONESTY RULES THIS FILE ENCODES (FIX-801 spec §§6–9):
 * - Decision 3: uncovered fund weight is an explicit RESIDUAL, never
 *   renormalized to make a total reach 100%.
 * - Decision 4: coverage is gated PER AXIS (names vs sectors independently)
 *   against {@link LOOK_THROUGH_COVERAGE_FLOOR_PCT}; a thin fund is stored
 *   data but opaque on the failing axis(es). The effective-position count is
 *   reported as an INTERVAL, not a point estimate — the corrected
 *   overlap-aware bound (not the earlier, wrong `r²`-only bound).
 * - Decision 6: no top-N truncation — every constituent the profile carries
 *   is consumed.
 * - Decision 7: the sector axis comes from the fund's OWN reported (and,
 *   upstream, already app-vocabulary-mapped) sector allocation, never
 *   per-constituent classification lookups. A constituent is a "name" by
 *   DEFAULT; fund-ness is a positive finding from an ordered oracle (layers
 *   1–3 here — layer 4, a description-text signal, is not yet reachable; see
 *   the module-level note on `resolveTickerIsFund`).
 * - Decision 8: the look-through axis gets its own concentration flags, at
 *   the SAME thresholds as the wrapper basis, tagged separately.
 */
import type { AssetClass, AssetType } from "../schema/portfolio-schema";
import {
  SECTOR_WARN_PCT,
  SINGLE_NAME_ALERT_PCT,
  SINGLE_NAME_WARN_PCT,
  UNCLASSIFIED_BUCKET,
} from "@/domain/portfolio/math/concentration-thresholds";
import { classifyInstrument, isKnownBondEtf } from "@/domain/portfolio/math/classify-instrument";

/** Below this per-axis coverage a fund stays opaque on that axis (Decision
 *  4) — a tuning number beside the wrapper basis's concentration thresholds,
 *  not a contract. */
export const LOOK_THROUGH_COVERAGE_FLOOR_PCT = 85;

/** When at least this share of a fund's constituent weight resolves as OTHER
 *  funds, the fund itself is a fund-of-funds and stays opaque rather than
 *  being half-decomposed (§7). A tuning number: "material share" is not
 *  pinned to an exact figure in the spec text; 50% (a majority) is a
 *  conservative, defensible reading — the regression case it exists for (an
 *  all-ETF allocation fund) sits far above it. */
export const FUND_OF_FUNDS_THRESHOLD_PCT = 50;

/** Tolerance (as a `[0, 1]` fraction) for reconciling a stored profile's
 *  declared `nameCoverage`/`sectorCoverage` against the ACTUAL sum of that
 *  axis's row weights. A profile can pass the floor check on a coverage
 *  figure that doesn't match what its own rows sum to — e.g. a duplicated
 *  constituent row (two 0.9-weight AAPL lines) — in which case the coverage
 *  figure is not "thin," it's WRONG, and trusting it would both attribute a
 *  name at more than its true weight (a false concentration alert) and,
 *  separately, size the residual off a number that no longer means "the
 *  unreported remainder." Beyond this tolerance the axis is rejected as
 *  malformed rather than reconciled (see the NAME/SECTOR axis blocks below
 *  for why "reconcile the residual" alone doesn't fix the per-row problem).
 *  Mirrors sub-PR a's fetcher-level `COVERAGE_OVERAGE_EPSILON`
 *  (`lib/providers/etf-profile.ts`) — same tolerance, same "over-summing
 *  data is untrustworthy" precedent, applied here to a coverage-vs-rows
 *  mismatch instead of a rows-only oversum (Codex review, FIX-801 sub-PR b). */
const COVERAGE_RECONCILIATION_EPSILON = 0.01;

/** One constituent holding, mirroring the fetcher's normalized shape
 *  (`EtfConstituent`). `ticker` null = AV's `"n/a"` row. `weight` a fraction
 *  in `[0, 1]` of the WHOLE fund. */
export type LookThroughConstituent = { ticker: string | null; weight: number };

/** One sector-allocation row, already mapped to the app's sector vocabulary
 *  upstream (mirroring `EtfSectorRow`). `weight` a fraction in `[0, 1]`. */
export type LookThroughSectorRow = { sector: string; weight: number };

/** A fund's normalized profile, mirroring `NormalizedEtfProfile`. `constituents`
 *  / `sectors` are `readonly` — this leaf only ever reads them, and both the
 *  fetcher's real output (sub-PR a) and test/fixture literals (which TS often
 *  infers as deeply-readonly tuples) flow in naturally without a cast. */
export type NormalizedFundProfile = {
  leveraged: boolean;
  constituents: readonly LookThroughConstituent[];
  nameCoverage: number;
  sectors: readonly LookThroughSectorRow[];
  sectorCoverage: number;
};

/** One fund's stored fill outcome, mirroring `EtfProfileRow`: exactly one of
 *  `payload` / `refusalReason` is set. A THIN but stored `payload` (below the
 *  coverage floor) is still the success shape — Decision 4: the gate is a
 *  presentation verdict this leaf makes, not a fetch-time refusal. */
export type FundProfileInput =
  | { payload: NormalizedFundProfile; refusalReason: null }
  | { payload: null; refusalReason: string };

/** One household position, as this leaf needs it. `sectorBucket` is the
 *  position's WRAPPER-BASIS bucket (`portfolio-health.ts`'s `sectorBucket()`
 *  output) — reused as-is for a DIRECT (non-fund) position's look-through
 *  sector attribution; Decision 7 changes how a FUND's sector data is
 *  attributed, not how a directly-held name's own sector is determined.
 *  Ignored for a fund position (its sector rows come from its own profile). */
export type LookThroughPositionInput = {
  ticker: string;
  assetType: AssetType;
  assetClass: AssetClass;
  marketValue: number | null;
  sectorBucket: string;
};

/** One effective name on the look-through basis — the sum of every source
 *  (a direct holding and/or one slice per attributing fund) that resolves to
 *  this ticker. `sources` is what lets a consumer show "which wrapper each
 *  slice came from" (§8 step 6) without recomputing the leaf's own math. */
export type EffectiveNamePosition = {
  ticker: string;
  marketValue: number;
  /** % of investedNav. */
  weightPct: number;
  /** `from` is `"direct"` for the position's own holding, or a fund ticker
   *  for a slice attributed through that fund. */
  sources: Array<{ from: string; marketValue: number }>;
};

/** The uncovered mass on one axis — an explicit entry, never folded back into
 *  the attributed total (Decision 3). */
export type LookThroughResidual = {
  marketValue: number;
  /** % of investedNav. */
  sharePct: number;
  cause: string;
};

/** One fund left unattributed on one or both axes, with why (Decision 4's
 *  per-axis gate — a fund can pass names and fail sectors, or the reverse). */
export type OpaqueFund = {
  ticker: string;
  axis: "names" | "sectors" | "both";
  reason: string;
};

export type LookThroughSectorBucket = {
  bucket: string;
  marketValue: number;
  /** % of investedNav. */
  pct: number | null;
};

/** A look-through concentration finding — same shape as the wrapper basis's
 *  `HealthFlag`, declared independently here (this leaf must not import
 *  `portfolio-health.ts`, which imports this leaf — BP-019 acyclic) and
 *  surfaced on its own field, tagged as look-through (Decision 8). */
export type LookThroughFlag =
  | { kind: "single_name"; level: "warn" | "alert"; ticker: string; weightPct: number }
  | { kind: "sector"; level: "warn"; sector: string; weightPct: number };

export type LookThroughExposure = {
  /** Household-level NAME-axis coverage: % of investedNav attributed to a
   *  name (direct or through a fund), vs. sitting in the name residual. */
  coveragePct: number | null;
  /** Household-level SECTOR-axis coverage, independent of the above
   *  (Decision 7 — the two provider fields are independently incomplete). */
  sectorCoveragePct: number | null;
  /** Every effective name, sorted by |weightPct| desc. Includes every
   *  priced, non-cash, positive-mass DIRECT position (any asset type — a
   *  directly-held bond is unambiguously "itself" on this axis) plus every
   *  resolved-name constituent of an attributed fund. */
  positions: EffectiveNamePosition[];
  residual: LookThroughResidual;
  /** Of investedNav; direct positions bucket by their own wrapper-basis
   *  sector, attributed funds bucket by their reported sector allocation. */
  sectorExposure: LookThroughSectorBucket[];
  sectorResidual: LookThroughResidual;
  /** Single-name-eligible (equity/crypto) only — the same eligibility the
   *  wrapper basis's `concentration.maxPosition` uses, so the two are
   *  directly comparable (§5's worked illustration). A LOWER BOUND (Decision
   *  3) — the residual could still hide a larger single name. */
  maxPosition: { ticker: string; weightPct: number } | null;
  /** `[low, high]` per Decision 4's corrected overlap-aware bound — NEVER a
   *  point estimate. `low` piles the residual entirely onto the largest
   *  already-attributed name (the worst case for concentration); `high`
   *  assumes the residual holds no concentration at all. Null when there is
   *  no attributed mass to bound. */
  effectivePositions: { low: number; high: number } | null;
  opaqueFunds: OpaqueFund[];
  flags: LookThroughFlag[];
  /** True once at least one fund cleared the coverage floor on EITHER axis
   *  (names or sectors independently, Decision 4/7) AND at least one REAL
   *  slice was actually attributed on that axis — clearing the coverage
   *  floor alone is not enough: coverage can clear using only
   *  non-attributable rows (every constituent `null`-ticker or itself a
   *  fund), in which case nothing is really attributed (Codex review round
   *  3, FIX-801). The caller (`summarizePortfolioHealth`) uses this — not
   *  just a non-empty `positions` array — to decide `lookThrough: "none"` vs
   *  `"partial"`, so a fund that is opaque on names but attributes on
   *  sectors (or the reverse) still reads `"partial"` instead of having its
   *  lone successful axis silently discarded (Codex review, FIX-801). */
  hasAttribution: boolean;
};

function isCashPosition(assetClass: AssetClass, assetType: AssetType): boolean {
  return assetClass === "cash" || assetType === "money_market";
}

function isFundAssetType(assetType: AssetType): boolean {
  return assetType === "etf" || assetType === "mutual_fund";
}

/** Single-name-eligible for flags/maxPosition — the wrapper basis's own rule
 *  (equity/crypto only; funds and bonds don't fire a single-name flag). */
function isFlagEligibleAssetType(assetType: AssetType): boolean {
  return assetType === "equity" || assetType === "crypto";
}

function pctOf(value: number, denom: number): number {
  return (value / denom) * 100;
}

/**
 * The ONE shared "does this ticker have fund evidence" oracle (§7), layers
 * 1–3 — the SINGLE evidence-ordering check every caller in this file uses,
 * not a per-caller reimplementation. It takes a bare ticker + the two
 * lookups every caller already has in scope (`positionsByTicker`,
 * `fundProfiles`), deliberately NOT shaped around "constituent" — a fund's
 * constituent, a household's own directly-held position, and a fund-of-funds
 * candidate are all really asking the SAME question ("is this ticker a
 * fund?") over the SAME two evidence sources, just from three different call
 * sites: the fund-of-funds share check, the name-axis constituent-attribution
 * loop, and the main loop's direct-holding-vs-decompose routing decision.
 * Three independently-drifting copies of this check were each found missing
 * a piece of the same evidence-ordering fix in three separate review rounds
 * (Codex review, FIX-801 sub-PR b) — this is the consolidation instead of a
 * fourth copy.
 *
 * Evidence is checked in STRENGTH order, not simply "held ticker first": a
 * held ticker's OWN classification is authoritative ONLY when it says "fund"
 * (layer 1a) — a `etf`/`mutual_fund` `assetType` is unambiguous positive
 * evidence no matter what else is known. A stored profile (layer 1b) is
 * checked NEXT, before falling back to a held ticker's NON-fund
 * classification, because a direct holding's `assetType` can be stale or
 * simply wrong (an import default, a classification that was never
 * corrected) while a stored profile is a real fetched fact. Concretely: VTI
 * held directly but still classified `equity` (misclassified/stale), where
 * VTI ALSO has a successful stored profile (fetched because ANOTHER fund's
 * holdings include VTI) — the profile must win, or a fund-of-funds situation
 * reports as a 100% single-name concentration alert instead of correctly
 * attributing through (Codex review round 2, FIX-801 sub-PR b). Once BOTH of
 * those are exhausted, the curated bond-ETF list (layer 2) is checked NEXT —
 * BEFORE falling back to a held ticker's own non-fund classification, for the
 * SAME reason layer 1b jumps the queue: the curated list is a deterministic,
 * externally-verified fact about the ticker, stronger than a possibly-stale
 * local `assetType` field. Concretely: BND held directly but still classified
 * `equity` (stale/never re-classified) — BND is never fetched at all (it's
 * pre-filtered from the ETF_PROFILE fill by Decision 5, so it can never reach
 * layer 1b), so without this ordering the curated list would never be
 * consulted for a HELD ticker and the stale classification would flow
 * straight through to the flag logic as a false single-name alert on a bond
 * ETF (a 4th instance of the same evidence-ordering gap, Codex review round
 * 5, FIX-801 sub-PR b). Only once ALL THREE of those are exhausted does a
 * held ticker's non-fund classification settle it (layer 1c — still
 * authoritative in the ABSENCE of any stronger evidence). Layer 1c means this
 * function ALWAYS terminates by layer 1c for a ticker the household holds
 * directly UNLESS the curated list already proved it a fund (the final
 * default is only reachable for a ticker that is NOT held AND not on the
 * curated list — e.g. a pure fund-of-funds constituent) — which is exactly
 * why it's also correct as the main loop's direct-holding routing predicate.
 *
 * The stored-profile check also reads a REFUSED profile's own reason:
 * `"ineligible"` (e.g. a leveraged/inverse fund, or a fund with no resolvable
 * constituent tickers) and `"malformed"` (corrupted holdings data) both mean
 * the upstream fetch DID resolve an ETF_PROFILE for the ticker — the refusal
 * is about the fund's data, not about whether it's a fund — so both are fund
 * evidence, same as a stored success payload. `"not_an_etf"` (an empty
 * profile response) is the only refusal reason that disproves fund-ness.
 * `"quota"` / `"transient"` (the route's own classification of a
 * request-level failure, never reaching the fetcher's own judgment) carry no
 * evidence either way and fall through to the next layer (Codex review,
 * FIX-801).
 *
 * LAYER 4 (a fund-shaped signal on the constituent's description text) is
 * NOT implemented here: the upstream fetcher (`lib/providers/etf-profile.ts`,
 * sub-PR a) does not currently carry per-constituent description text, so
 * there is no signal to route on. This is a known, spec-flagged residual risk
 * (§7: "a first-encounter allocation fund whose components are in none of
 * layers 1–3 relies on layer 4") — layers 1–3 cover every case this leaf's
 * tests exercise, including the fund-of-funds regression case, because the
 * regression fund's components are themselves held directly or profiled.
 * Threading `description` through sub-PR a's fetcher/table is a documented
 * follow-up, not a blocker for this leaf.
 */
function resolveTickerIsFund(
  ticker: string,
  positionsByTicker: ReadonlyMap<string, LookThroughPositionInput>,
  fundProfiles: ReadonlyMap<string, FundProfileInput>,
): boolean {
  const held = positionsByTicker.get(ticker);
  const profile = fundProfiles.get(ticker);

  // Layer 1a — a held ticker's OWN classification, but ONLY as positive
  // evidence: "yes, this is a fund" is unambiguous no matter what else is
  // known. A non-fund classification is NOT trusted yet — a stored profile
  // (checked next) can outweigh it. EXCEPT when a stored `not_an_etf`
  // refusal already disproves it: this is the 5th evidence-ordering case,
  // but in the OPPOSITE direction from the other four (which were all about
  // POSITIVE evidence beating a stale non-fund tag) — here it's NEGATIVE
  // evidence beating a stale FUND-TYPE tag. AV's own fetcher already
  // determined the ticker isn't actually an ETP, a stronger and more
  // specific signal than a possibly-stale `assetType: "etf"/"mutual_fund"`
  // classification (e.g. an import default that was never corrected).
  // Without this, a ticker held-and-tagged as a fund but proven NOT to be
  // one gets routed to residual as an opaque fund instead of being treated
  // as a direct name with its own effective exposure and its own
  // concentration eligibility (Codex review, FIX-801 sub-PR b).
  const disprovenByProfile = profile?.payload === null && profile.refusalReason === "not_an_etf";
  if (held && isFundAssetType(held.assetType) && !disprovenByProfile) return true;

  // Layer 1b — a stored profile, checked BEFORE a held ticker's non-fund
  // classification is allowed to settle the question (see the docblock
  // above for why: a direct holding's assetType can be stale/misclassified).
  if (profile) {
    if (profile.payload !== null) return true; // a stored profile proves it's a fund
    if (profile.refusalReason === "not_an_etf") return false; // proven NOT a fund
    if (profile.refusalReason === "ineligible" || profile.refusalReason === "malformed") return true; // the fetch resolved an ETF_PROFILE; refusal is about the DATA, not fund-ness
  }

  // Layer 2 — the curated bond-ETF list, checked BEFORE a held ticker's
  // non-fund classification is allowed to settle the question, same
  // reasoning as layer 1b: a curated bond ETF (e.g. BND) is pre-filtered
  // from the ETF_PROFILE fill (Decision 5) and so can NEVER reach layer 1b —
  // this is the only remaining evidence source for it, and it's stronger
  // than a possibly-stale local `assetType` field (Codex review round 5,
  // FIX-801 sub-PR b).
  if (isKnownBondEtf(ticker)) return true;

  // Layer 1c — a held ticker with NO evidence from either the stored
  // profile OR the curated list falls back to its own (non-fund)
  // classification, authoritative in the absence of anything stronger.
  if (held) return false;

  return false; // default: a name (§7 — fund-ness is a positive finding only)
}

/** Accumulate `amount` into `map[key]`, creating the entry at `0` first. */
function add(map: Map<string, number>, key: string, amount: number): void {
  map.set(key, (map.get(key) ?? 0) + amount);
}

/**
 * Defensively validate a stored profile's `[0, 1]`-fraction field — a
 * constituent/sector `weight` OR `nameCoverage`/`sectorCoverage` (all four
 * share the exact same documented contract) — before it enters ANY
 * accumulation. A corrupted `etf_profiles` row (hand-edited, migrated, or
 * otherwise bypassing sub-PR a's own write-time `parseFraction` guard) must
 * never propagate a non-finite or out-of-range value into either axis's
 * mass, same "no NaN/Infinity output" contract the market-value guard already
 * enforces on `investedNav`/positions (Codex review round 7, FIX-801). An
 * invalid value is treated as 0 — for a weight that means it contributes
 * NOTHING; for a coverage figure it means the axis reads as opaque/thin
 * rather than a passing/complete profile. Mirrors the fetcher's own defense
 * (`lib/providers/etf-profile.ts`'s `parseFraction`, sub-PR a), which this
 * leaf must not assume held for every row it will ever see.
 */
function safeWeight(fraction: number): number {
  return Number.isFinite(fraction) && fraction >= 0 && fraction <= 1 ? fraction : 0;
}

/**
 * Compute the look-through exposure axis from a household's positions and
 * its fund profiles. Returns `null` when `investedNav` is not usable (≤ 0 or
 * null — the guarded-division rule every leaf in this domain follows) or
 * when any priced non-cash position carries a negative OR non-finite
 * (`Infinity` / `NaN`) market value (a short position anywhere makes the
 * shared invested-NAV denominator uninterpretable for a look-through weight —
 * Decision 4's "Also refused" edge case, §9; a non-finite value would
 * silently produce infinite/`NaN` weights downstream, violating this leaf's
 * own guarded-division contract — Codex review round 5, FIX-801 sub-PR b).
 *
 * Empty `fundProfiles` (no funds fetched, or no fund positions at all) is NOT
 * itself a reason to return null — it produces a well-formed axis with 100%
 * coverage and zero residual (every position is already "itself"). Whether
 * that state is worth reporting as `lookThrough: "partial"` vs `"none"` is
 * the caller's call (`summarizePortfolioHealth`, which knows whether the
 * household holds any fund positions at all).
 */
export function computeLookThroughExposure(
  positions: ReadonlyArray<LookThroughPositionInput>,
  investedNav: number | null,
  fundProfiles: ReadonlyMap<string, FundProfileInput>,
): LookThroughExposure | null {
  if (investedNav === null || !Number.isFinite(investedNav) || investedNav <= 0) return null;

  const eligible = positions.filter(
    (p) => p.marketValue !== null && !isCashPosition(p.assetClass, p.assetType),
  );
  // Any short (negative) OR non-finite (Infinity/NaN) market value makes the
  // shared invested-NAV denominator uninterpretable → refuse the whole axis,
  // never silently produce an infinite/NaN weight downstream.
  if (eligible.some((p) => !Number.isFinite(p.marketValue as number) || (p.marketValue as number) < 0)) {
    return null;
  }

  const positionsByTicker = new Map(positions.map((p) => [p.ticker.toUpperCase(), p]));

  // The fund/not-fund verdict for a ticker is computed ONCE here and reused
  // everywhere this function asks the question — routing, the fund-of-funds
  // share check, the name-axis attribution loop, the direct-position sector
  // fallback, and flag eligibility. Three earlier rounds of review found the
  // SAME evidence-ordering bug independently re-derived (slightly
  // differently, and so inconsistently) at multiple call sites; two more
  // rounds found the fix to `resolveTickerIsFund` itself hadn't propagated to
  // two DOWNSTREAM consumers that independently re-checked the raw
  // classification tag instead of reusing the already-corrected verdict
  // (Codex review, FIX-801 sub-PR b). This cache is what makes "one source of
  // truth" actually structural rather than a convention every new call site
  // has to remember.
  const fundVerdictCache = new Map<string, boolean>();
  function isFundCached(ticker: string): boolean {
    let verdict = fundVerdictCache.get(ticker);
    if (verdict === undefined) {
      verdict = resolveTickerIsFund(ticker, positionsByTicker, fundProfiles);
      fundVerdictCache.set(ticker, verdict);
    }
    return verdict;
  }

  const nameMass = new Map<string, number>(); // ticker -> attributed mass
  const nameSources = new Map<string, Array<{ from: string; marketValue: number }>>();
  const sectorMass = new Map<string, number>(); // bucket -> attributed mass
  let nameResidualMass = 0;
  let sectorResidualMass = 0;
  let hasAttribution = false;
  const opaqueByTicker = new Map<string, { names?: string; sectors?: string; both?: string }>();

  function pushSource(ticker: string, from: string, amount: number): void {
    add(nameMass, ticker, amount);
    const list = nameSources.get(ticker) ?? [];
    list.push({ from, marketValue: amount });
    nameSources.set(ticker, list);
  }

  for (const pos of eligible) {
    const mv = pos.marketValue as number;
    if (mv === 0) continue; // no mass to attribute either way

    const profile = fundProfiles.get(pos.ticker);
    // The DIRECT-holding routing decision is the SAME "does this ticker have
    // fund evidence" question the constituent checks below ask — reusing
    // `isFundCached` here (rather than a narrower reimplementation) is what
    // keeps this branch, the fund-of-funds check, and the name-axis
    // attribution loop from drifting out of sync one evidence-ordering fix
    // at a time (Codex review rounds 4-5, FIX-801 — see `resolveTickerIsFund`'s
    // docblock, including why the curated bond-ETF list is now checked
    // BEFORE a held ticker's own classification too — exactly the same
    // "don't trust stale local metadata over stronger external evidence"
    // rule this branch relies on).
    const isFund = isFundCached(pos.ticker);
    if (!isFund) {
      // A direct holding is unambiguously itself (§7). EXCEPTION: the
      // wrapper-basis `sectorBucket` this leaf normally reuses as-is (see the
      // INPUT SHAPE docblock) was computed purely off the position's own
      // `assetType` tag — for a ticker tagged etf/mutual_fund but DISPROVEN
      // as a fund by `isFundCached` (e.g. a stored `not_an_etf` refusal), that
      // bucket is the wrapper's stale "Funds (no look-through)" label, which
      // is actively wrong once we know it isn't a fund — trusting it would
      // both mislabel the position and could fire a nonsensical sector-
      // concentration warning for a bucket that isn't a real sector. This
      // leaf has no real sector data for that ticker (BP-019 — no
      // classifications lookup here), so it honestly falls back to
      // `UNCLASSIFIED_BUCKET` (the established "data gap, not a real sector"
      // bucket, already excluded from the sector-flag loop below) instead of
      // keeping a bucket built on the assumption this IS a fund (Codex
      // review, FIX-801 sub-PR b).
      const bucket = isFundAssetType(pos.assetType) ? UNCLASSIFIED_BUCKET : pos.sectorBucket;
      pushSource(pos.ticker, "direct", mv);
      add(sectorMass, bucket, mv);
      continue;
    }

    if (!profile) {
      // Never fetched (or the caller didn't warm it) — opaque on both axes.
      nameResidualMass += mv;
      sectorResidualMass += mv;
      opaqueByTicker.set(pos.ticker, { both: "no stored profile" });
      continue;
    }
    if (profile.payload === null) {
      nameResidualMass += mv;
      sectorResidualMass += mv;
      opaqueByTicker.set(pos.ticker, { both: profile.refusalReason });
      continue;
    }
    const fp = profile.payload;

    // A leveraged/inverse fund's constituent weights don't represent honest
    // household exposure at all (2x/3x leverage, or inverse positioning) —
    // the spec's own non-goal explicitly excludes "leveraged, inverse...
    // fund attribution" (Decision 4's eligibility gate). Refused the same
    // way a fund-of-funds or a below-floor axis is refused: whole mass to
    // residual, opaque on BOTH axes, never decomposed as an ordinary long
    // fund. This mirrors the fetch-time `"leveraged/inverse fund"` REFUSAL
    // reason (a fund AV itself flagged before ever returning a payload) —
    // this is the same call for a fund whose payload made it through with
    // `leveraged: true` set (Codex review, FIX-801 sub-PR b).
    if (fp.leveraged) {
      nameResidualMass += mv;
      sectorResidualMass += mv;
      opaqueByTicker.set(pos.ticker, { both: "leveraged/inverse fund" });
      continue;
    }

    // NAME axis diagnostics — computed BEFORE the fund-of-funds check below,
    // because that check consumes the SAME `fp.constituents` rows the name
    // axis does. If those rows don't even clear the coverage floor, or don't
    // reconcile against the declared `nameCoverage` (a duplicated/corrupted
    // row), the fund-of-funds SHARE computed from them is built on
    // untrustworthy data — and letting it veto the fund anyway would gate the
    // SECTOR axis (`fundShare >= threshold` marks BOTH axes opaque) off data
    // that has nothing to do with sectors at all. Concretely: two duplicated
    // 0.3-weight BND rows with `nameCoverage: 0.3` inflate the apparent
    // fund-of-funds share to 60% (BND resolves as a fund via the curated
    // list) even though the name axis's OWN reconciliation check below would
    // separately (and correctly) reject just the name axis — while an
    // independently valid, fully-reconciled sector allocation on the same
    // fund was wiped out for no reason (Codex review, FIX-801 sub-PR b).
    // `fp.sectors`/`fp.sectorCoverage` are a wholly separate declared field,
    // unaffected by a corrupted constituent row, and get evaluated entirely
    // on their own below regardless of what happens here.
    const safeNameCoverage = safeWeight(fp.nameCoverage);
    const namesPass = safeNameCoverage * 100 >= LOOK_THROUGH_COVERAGE_FLOOR_PCT;
    const actualNameSum = fp.constituents.reduce((sum, c) => sum + safeWeight(c.weight), 0);
    const nameReconciles = Math.abs(actualNameSum - safeNameCoverage) <= COVERAGE_RECONCILIATION_EPSILON;

    // Fund-of-funds check — a material share resolving as OTHER funds makes
    // the WHOLE fund ineligible rather than half-decomposed (§7). Only
    // evaluated when the constituent row data itself is trustworthy (see
    // above) — when it isn't, this is skipped entirely and the NAME axis's
    // own floor/reconciliation branches below report the more specific
    // reason instead of a "fund-of-funds" verdict this leaf can't actually
    // stand behind from corrupted rows.
    if (namesPass && nameReconciles) {
      let fundShare = 0;
      for (const c of fp.constituents) {
        if (c.ticker === null) continue;
        if (isFundCached(c.ticker)) fundShare += safeWeight(c.weight);
      }
      if (fundShare * 100 >= FUND_OF_FUNDS_THRESHOLD_PCT) {
        nameResidualMass += mv;
        sectorResidualMass += mv;
        opaqueByTicker.set(pos.ticker, {
          both: `fund-of-funds: ${(fundShare * 100).toFixed(1)}% of holdings resolve to other funds`,
        });
        continue;
      }
    }

    // NAME axis — gated independently of sectors (Decision 4). `fp.nameCoverage`
    // is itself a stored profile field, subject to the same corruption risk as
    // a row weight — an Infinity coverage would pass the floor check but then
    // poison `nameResidualMass` via `(1 - fp.nameCoverage) * mv` (`-Infinity`);
    // `safeWeight` doubles as the coverage validator since both share the same
    // documented [0, 1]-fraction contract (Codex review round 7, FIX-801).
    // An invalid coverage defaults to 0 — the safe, opaque-on-this-axis
    // reading, never treated as a passing/complete profile.
    if (!namesPass) {
      nameResidualMass += mv;
      opaqueByTicker.set(pos.ticker, {
        ...opaqueByTicker.get(pos.ticker),
        names: `holdings data incomplete (${(safeNameCoverage * 100).toFixed(1)}% coverage, floor ${LOOK_THROUGH_COVERAGE_FLOOR_PCT}%)`,
      });
    } else if (!nameReconciles) {
      // Reconcile the declared coverage against what the rows actually sum
      // to BEFORE attributing anything. A mismatch beyond tolerance means
      // the coverage figure is not describing these rows — most likely a
      // duplicated/corrupted row (e.g. two 0.9-weight lines for the same
      // ticker: rows sum to 1.8 while `nameCoverage` still says ~0.9).
      // Reconciling only the RESIDUAL (deriving it from the actual sum
      // instead of the declared coverage) would make the axis's total add
      // up again, but it does nothing about the per-row attribution itself
      // — that duplicated AAPL row would still get pushed as a ~180%-of-fund
      // position via two `pushSource` calls, which is exactly the false
      // single-name concentration alert this check exists to prevent. There
      // is no way to know FROM THIS DATA which row (if either) is the real
      // one, so the whole axis is rejected as malformed instead — the same
      // "don't trust a self-inconsistent profile" call sub-PR a's fetcher
      // already makes at write time for an over-summing payload (Codex
      // review, FIX-801 sub-PR b).
      nameResidualMass += mv;
      opaqueByTicker.set(pos.ticker, {
        ...opaqueByTicker.get(pos.ticker),
        names: `holdings data malformed (declared ${(safeNameCoverage * 100).toFixed(1)}% coverage doesn't match ${(actualNameSum * 100).toFixed(1)}% summed constituent weight)`,
      });
    } else {
      for (const c of fp.constituents) {
        const slice = safeWeight(c.weight) * mv;
        if (c.ticker === null || isFundCached(c.ticker)) {
          nameResidualMass += slice; // non-attributable line, or routed away from the name axis
        } else if (slice > 0) {
          // The same "real attribution, not just a passing gate" rule the
          // sector axis below already applies (Codex review round 6,
          // FIX-801): an otherwise-attributable constituent with a ZERO
          // weight contributes nothing real — pushing it anyway would
          // create a phantom $0 position that could surface as
          // `maxPosition` (the first-eligible-candidate case) and wrongly
          // flip `hasAttribution` even though every other slice is
          // genuinely residual.
          pushSource(c.ticker, pos.ticker, slice);
          hasAttribution = true;
        }
      }
      // The unreported remainder (rows the profile never listed at all).
      nameResidualMass += (1 - safeNameCoverage) * mv;
    }

    // SECTOR axis — gated independently of names (Decision 4/7). Same coverage
    // validation as the name axis above.
    const safeSectorCoverage = safeWeight(fp.sectorCoverage);
    const sectorsPass = safeSectorCoverage * 100 >= LOOK_THROUGH_COVERAGE_FLOOR_PCT;
    if (!sectorsPass) {
      sectorResidualMass += mv;
      opaqueByTicker.set(pos.ticker, {
        ...opaqueByTicker.get(pos.ticker),
        sectors: `sector data incomplete (${(safeSectorCoverage * 100).toFixed(1)}% coverage, floor ${LOOK_THROUGH_COVERAGE_FLOOR_PCT}%)`,
      });
    } else {
      // Same reconciliation as the name axis above, and for the same
      // reason: a declared `sectorCoverage` that doesn't match what the
      // rows actually sum to means the rows are self-inconsistent (e.g. a
      // duplicated sector line), and reconciling only the residual would
      // still let the duplicated slice double up inside `sectorMass` —
      // reject the axis as malformed instead of half-trusting it.
      const actualSectorSum = fp.sectors.reduce((sum, s) => sum + safeWeight(s.weight), 0);
      if (Math.abs(actualSectorSum - safeSectorCoverage) > COVERAGE_RECONCILIATION_EPSILON) {
        sectorResidualMass += mv;
        opaqueByTicker.set(pos.ticker, {
          ...opaqueByTicker.get(pos.ticker),
          sectors: `sector data malformed (declared ${(safeSectorCoverage * 100).toFixed(1)}% coverage doesn't match ${(actualSectorSum * 100).toFixed(1)}% summed sector weight)`,
        });
      } else {
        for (const s of fp.sectors) {
          const slice = safeWeight(s.weight) * mv;
          add(sectorMass, s.sector, slice);
          // Same "real attribution, not just a passing gate" rule as the name
          // axis above — a zero-weight row adds nothing real.
          if (slice > 0) hasAttribution = true;
        }
        sectorResidualMass += (1 - safeSectorCoverage) * mv;
      }
    }
  }

  const opaqueFunds: OpaqueFund[] = [...opaqueByTicker.entries()].flatMap(([ticker, r]) => {
    if (r.both !== undefined) return [{ ticker, axis: "both" as const, reason: r.both }];
    const out: OpaqueFund[] = [];
    if (r.names !== undefined) out.push({ ticker, axis: "names" as const, reason: r.names });
    if (r.sectors !== undefined) out.push({ ticker, axis: "sectors" as const, reason: r.sectors });
    return out;
  });

  const positionsOut: EffectiveNamePosition[] = [...nameMass.entries()]
    .map(([ticker, marketValue]) => ({
      ticker,
      marketValue,
      weightPct: pctOf(marketValue, investedNav),
      sources: nameSources.get(ticker) ?? [],
    }))
    .sort((a, b) => Math.abs(b.weightPct) - Math.abs(a.weightPct));

  const sectorExposure: LookThroughSectorBucket[] = [...sectorMass.entries()]
    .map(([bucket, marketValue]) => ({ bucket, marketValue, pct: pctOf(marketValue, investedNav) }))
    .sort((a, b) => b.marketValue - a.marketValue);

  const residual: LookThroughResidual = {
    marketValue: nameResidualMass,
    sharePct: pctOf(nameResidualMass, investedNav),
    cause:
      "non-attributable constituent lines (unsymboled foreign holdings, futures, cash) and fund-of-funds constituents inside otherwise-attributed funds — per-fund opacity is listed separately in opaqueFunds",
  };
  const sectorResidual: LookThroughResidual = {
    marketValue: sectorResidualMass,
    sharePct: pctOf(sectorResidualMass, investedNav),
    cause: "non-attributable sector rows inside otherwise-attributed funds — see opaqueFunds",
  };

  // maxPosition + flags — single-name-eligible (equity/crypto) only, the same
  // scope the wrapper basis's concentration read uses, so the two are
  // directly comparable (§5).
  let maxPosition: { ticker: string; weightPct: number } | null = null;
  const flags: LookThroughFlag[] = [];
  for (const p of positionsOut) {
    const heldDirect = positionsByTicker.get(p.ticker);
    // A ticker the household actually HOLDS is authoritative (real
    // classification data — same rule the wrapper basis uses). A ticker
    // attributed ONLY through a fund (never held directly) has no such
    // record, so it independently checks the ticker's own SHAPE via the
    // classifier rather than assuming every non-"direct" source is a
    // flag-eligible name: the upstream bond-ETF pre-filter and the
    // fund-detection oracle (`isFundCached`) both curate/infer FUND-ness, but
    // neither is exhaustive, and a fixed-income ETF that slips past them
    // could resolve constituents to Treasury/CUSIP-shaped tickers — this is
    // the leaf's own defense-in-depth against exactly that (Codex review,
    // FIX-801 sub-PR b). EXCEPTION: a held ticker's fund-type tag
    // (etf/mutual_fund) is not trusted for eligibility when `isFundCached`
    // has DISPROVEN it (a stored `not_an_etf` refusal) — the same "don't
    // independently re-derive from the raw classification tag" rule the
    // routing decision and the sector-bucket fallback above already apply.
    // Without this, a ticker routed as a direct name (its true, disproven
    // state) would still be suppressed from ever being flagged, hiding a
    // legitimate concentration signal (Codex review, FIX-801 sub-PR b).
    const heldTagDisprovenAsFund =
      heldDirect !== undefined && isFundAssetType(heldDirect.assetType) && !isFundCached(p.ticker);
    const eligibleForFlags =
      heldDirect !== undefined && !heldTagDisprovenAsFund
        ? isFlagEligibleAssetType(heldDirect.assetType)
        : isFlagEligibleAssetType(classifyInstrument(p.ticker).assetType);
    if (!eligibleForFlags) continue;
    if (maxPosition === null || Math.abs(p.weightPct) > Math.abs(maxPosition.weightPct)) {
      maxPosition = { ticker: p.ticker, weightPct: p.weightPct };
    }
    const absW = Math.abs(p.weightPct);
    if (absW > SINGLE_NAME_ALERT_PCT) {
      flags.push({ kind: "single_name", level: "alert", ticker: p.ticker, weightPct: p.weightPct });
    } else if (absW > SINGLE_NAME_WARN_PCT) {
      flags.push({ kind: "single_name", level: "warn", ticker: p.ticker, weightPct: p.weightPct });
    }
  }
  for (const s of sectorExposure) {
    // The unclassified bucket is a data gap, not a concentration finding —
    // mirrors the wrapper basis's own exclusion (`computeConcentration` in
    // `portfolio-health.ts`, Codex review, FIX-801).
    if (s.bucket === UNCLASSIFIED_BUCKET) continue;
    if (s.pct !== null && s.pct > SECTOR_WARN_PCT) {
      flags.push({ kind: "sector", level: "warn", sector: s.bucket, weightPct: s.pct });
    }
  }

  // Effective-position INTERVAL (Decision 4's corrected, overlap-aware bound).
  let sumSq = 0;
  let wMax = 0;
  for (const p of positionsOut) {
    const w = p.weightPct / 100;
    sumSq += w * w;
    if (w > wMax) wMax = w;
  }
  const r = residual.sharePct / 100;
  let effectivePositions: { low: number; high: number } | null = null;
  if (sumSq > 0) {
    const upperHhi = sumSq + 2 * wMax * r + r * r;
    effectivePositions = { low: 1 / upperHhi, high: 1 / sumSq };
  }

  return {
    coveragePct: 100 - residual.sharePct,
    sectorCoveragePct: 100 - sectorResidual.sharePct,
    positions: positionsOut,
    residual,
    sectorExposure,
    sectorResidual,
    maxPosition,
    effectivePositions,
    opaqueFunds,
    flags,
    hasAttribution,
  };
}
