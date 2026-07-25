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
 *   the module-level note on `resolveConstituentIsFund`).
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
import { isKnownBondEtf } from "@/domain/portfolio/math/classify-instrument";

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
   *  (names or sectors independently, Decision 4/7) and contributed
   *  attributed mass. The caller (`summarizePortfolioHealth`) uses this —
   *  not just a non-empty `positions` array — to decide `lookThrough: "none"`
   *  vs `"partial"`, so a fund that is opaque on names but attributes on
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
 * The ordered fund-detection oracle (§7), layers 1–3. A ticker held directly
 * by the household is decided by ITS OWN classification (layer 3, most
 * authoritative when available); otherwise a stored profile row proves or
 * disproves fund-ness (layer 1); otherwise the curated bond-ETF list is
 * consulted (layer 2 — a bond ETF is a fund, just an ineligible one).
 *
 * Layer 1 also reads a REFUSED profile's own reason: `"ineligible"` (e.g. a
 * leveraged/inverse fund, or a fund with no resolvable constituent tickers)
 * and `"malformed"` (corrupted holdings data) both mean the upstream fetch
 * DID resolve an ETF_PROFILE for the ticker — the refusal is about the fund's
 * data, not about whether it's a fund — so both are fund evidence, same as a
 * stored success payload. `"not_an_etf"` (an empty profile response) is the
 * only refusal reason that disproves fund-ness. `"quota"` / `"transient"`
 * (the route's own classification of a request-level failure, never reaching
 * the fetcher's own judgment) carry no evidence either way and fall through
 * to the next layer (Codex review, FIX-801).
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
function resolveConstituentIsFund(
  ticker: string,
  positionsByTicker: ReadonlyMap<string, LookThroughPositionInput>,
  fundProfiles: ReadonlyMap<string, FundProfileInput>,
): boolean {
  const held = positionsByTicker.get(ticker);
  if (held) return isFundAssetType(held.assetType); // layer 3 — authoritative for a held ticker
  const profile = fundProfiles.get(ticker);
  if (profile) {
    if (profile.payload !== null) return true; // layer 1 — a stored profile proves it's a fund
    if (profile.refusalReason === "not_an_etf") return false; // layer 1 — proven NOT a fund
    if (profile.refusalReason === "ineligible" || profile.refusalReason === "malformed") return true; // layer 1 — the fetch resolved an ETF_PROFILE; refusal is about the DATA, not fund-ness
  }
  if (isKnownBondEtf(ticker)) return true; // layer 2 — curated bond-ETF list
  return false; // default: a name (§7 — fund-ness is a positive finding only)
}

/** Accumulate `amount` into `map[key]`, creating the entry at `0` first. */
function add(map: Map<string, number>, key: string, amount: number): void {
  map.set(key, (map.get(key) ?? 0) + amount);
}

/**
 * Compute the look-through exposure axis from a household's positions and
 * its fund profiles. Returns `null` when `investedNav` is not usable (≤ 0 or
 * null — the guarded-division rule every leaf in this domain follows) or
 * when any priced non-cash position carries a negative market value (a short
 * position anywhere makes the shared invested-NAV denominator uninterpretable
 * for a look-through weight — Decision 4's "Also refused" edge case, §9).
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
  if (eligible.some((p) => (p.marketValue as number) < 0)) return null; // any short → refuse the axis

  const positionsByTicker = new Map(positions.map((p) => [p.ticker.toUpperCase(), p]));

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

    if (!isFundAssetType(pos.assetType)) {
      // A direct holding is unambiguously itself (§7).
      pushSource(pos.ticker, "direct", mv);
      add(sectorMass, pos.sectorBucket, mv);
      continue;
    }

    const profile = fundProfiles.get(pos.ticker);
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

    // Fund-of-funds check — a material share resolving as OTHER funds makes
    // the WHOLE fund ineligible rather than half-decomposed (§7).
    let fundShare = 0;
    for (const c of fp.constituents) {
      if (c.ticker === null) continue;
      if (resolveConstituentIsFund(c.ticker, positionsByTicker, fundProfiles)) fundShare += c.weight;
    }
    if (fundShare * 100 >= FUND_OF_FUNDS_THRESHOLD_PCT) {
      nameResidualMass += mv;
      sectorResidualMass += mv;
      opaqueByTicker.set(pos.ticker, {
        both: `fund-of-funds: ${(fundShare * 100).toFixed(1)}% of holdings resolve to other funds`,
      });
      continue;
    }

    // NAME axis — gated independently of sectors (Decision 4).
    const namesPass = fp.nameCoverage * 100 >= LOOK_THROUGH_COVERAGE_FLOOR_PCT;
    if (!namesPass) {
      nameResidualMass += mv;
      opaqueByTicker.set(pos.ticker, {
        ...opaqueByTicker.get(pos.ticker),
        names: `holdings data incomplete (${(fp.nameCoverage * 100).toFixed(1)}% coverage, floor ${LOOK_THROUGH_COVERAGE_FLOOR_PCT}%)`,
      });
    } else {
      hasAttribution = true;
      for (const c of fp.constituents) {
        const slice = c.weight * mv;
        if (c.ticker === null || resolveConstituentIsFund(c.ticker, positionsByTicker, fundProfiles)) {
          nameResidualMass += slice; // non-attributable line, or routed away from the name axis
        } else {
          pushSource(c.ticker, pos.ticker, slice);
        }
      }
      // The unreported remainder (rows the profile never listed at all).
      nameResidualMass += (1 - fp.nameCoverage) * mv;
    }

    // SECTOR axis — gated independently of names (Decision 4/7).
    const sectorsPass = fp.sectorCoverage * 100 >= LOOK_THROUGH_COVERAGE_FLOOR_PCT;
    if (!sectorsPass) {
      sectorResidualMass += mv;
      opaqueByTicker.set(pos.ticker, {
        ...opaqueByTicker.get(pos.ticker),
        sectors: `sector data incomplete (${(fp.sectorCoverage * 100).toFixed(1)}% coverage, floor ${LOOK_THROUGH_COVERAGE_FLOOR_PCT}%)`,
      });
    } else {
      hasAttribution = true;
      for (const s of fp.sectors) add(sectorMass, s.sector, s.weight * mv);
      sectorResidualMass += (1 - fp.sectorCoverage) * mv;
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
    const eligibleForFlags =
      p.sources.some((s) => s.from !== "direct") || // any fund-attributed slice — assumed a name
      (heldDirect !== undefined && isFlagEligibleAssetType(heldDirect.assetType));
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
