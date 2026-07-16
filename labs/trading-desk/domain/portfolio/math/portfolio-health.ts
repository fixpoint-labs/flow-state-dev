/**
 * Pure, browser-safe household portfolio-health aggregation (FIX-762).
 *
 * The deterministic answer to "how balanced is my book?" — computed identically
 * by the Health perspective (`components/portfolio/health-section.tsx`) and the
 * analysis seed (`build-portfolio-context.ts`), so the pane and the trader/PM
 * see ONE household picture, not two. No model calls: knowing your own weights
 * is arithmetic.
 *
 * It imports ONLY types + `value-holding.ts` (the single per-type valuation
 * rule) — no `@flow-state-dev/core`, no IO — so it runs in the client and the
 * server action alike and is unit-testable in isolation (BP-019: leaf, no
 * cycles). Reusing `holdingMarketValue` means there is exactly ONE copy of "what
 * is this holding worth" and the `inconsistent_history` inclusion gate across
 * the pane rollups, `buildPortfolioContext`, and this leaf (BP-028/034).
 *
 * REAL-MONEY DISCIPLINE (non-negotiable): every figure traces to a stored
 * quantity valued by a sourced price. An unpriced holding contributes to NO
 * numerator or denominator and is surfaced in `coverage`, never fabricated. An
 * `inconsistent_history` row (an unaccounted split, FIX-876) is excluded from
 * all money math and counted separately so the view shows the ⚠ rather than
 * silently shrinking the book. Every division is guarded — a zero/negative
 * denominator yields `null`, never `NaN`/`Infinity`.
 *
 * Fund positions (ETF / mutual fund) are honestly opaque in v1: no look-through
 * (`lookThrough: "none"`), exempt from single-name concentration flags, and
 * bucketed as "Funds (no look-through)" in the sector view. FIX-801 refines this
 * without reshaping the payload.
 *
 * Mandate drift / standing-constraint compliance (`computeAllocationDrift`) is
 * the FIX-761-gated follow-up slice; it is intentionally NOT in this module yet.
 * The analysis-context `drift` block stays `null` until it lands.
 */
import type { AssetClass, AssetType, AccountState } from "../schema/portfolio-schema";
import { holdingMarketValue } from "@/domain/portfolio/math/value-holding";

/** Quote map as the pane and seed already hold it: UPPER ticker → { price, asOf }. */
export type QuoteMap = Map<string, { price: number | null; asOf: string | null }>;

/** UPPER ticker → Yahoo sector string, or null when unresolved. */
export type ClassificationMap = Map<string, string | null>;

/** Sector bucket label for a position whose every constituent row is a fund. */
export const FUNDS_BUCKET = "Funds (no look-through)";
/** Sector bucket label for a single-name equity whose sector didn't resolve. */
export const UNCLASSIFIED_BUCKET = "Unclassified";

/** Single-name concentration thresholds (% of invested NAV). Warn ≥ these; the
 *  industry rules of thumb (J.P. Morgan / T. Rowe) converge on ~10% / ~25%.
 *  Exported so the UI and context formatter label the same lines; configurability
 *  is deferred (Non-Goals) — if made configurable, the mandate is the home. */
export const SINGLE_NAME_WARN_PCT = 10;
export const SINGLE_NAME_ALERT_PCT = 25;
/** Sector-concentration warn threshold (% of invested NAV). ~25–30% rule of thumb. */
export const SECTOR_WARN_PCT = 30;

/** One ticker-merged household position (summed across accounts). */
export type HealthPosition = {
  /** Canonical UPPER ticker (the merge key). */
  ticker: string;
  assetClass: AssetClass;
  assetType: AssetType;
  /** Quantity summed across included rows (excluded rows not summed). */
  quantity: number;
  /** Σ `holdingMarketValue` over included rows; null when none is priceable. */
  marketValue: number | null;
  /** % of totalNav; null when totalNav ≤ 0 or the value is unknown. */
  allocationWeightPct: number | null;
  /** % of investedNav; null for cash positions or when investedNav ≤ 0. */
  exposureWeightPct: number | null;
  /** Equities only (its classification sector); null otherwise or unresolved. */
  sector: string | null;
  /** Per-account sub-rows for the drill-down. */
  accounts: Array<{ accountId: string; label: string; quantity: number; marketValue: number | null }>;
  /** `inconsistent_history` rows skipped from money math (⚠ semantics). */
  excludedRows: number;
};

/** One ticker inside a sector-exposure bucket (the drill-down under each bar).
 *  `weightPct` is of investedNav — the SAME denominator as the bucket's own
 *  `pct` — so a bucket's constituents' weights sum to the bucket weight. */
export type SectorConstituent = {
  ticker: string;
  assetType: AssetType;
  marketValue: number;
  weightPct: number | null;
};

/** A concentration finding to surface as a chip. */
export type HealthFlag =
  | { kind: "single_name"; level: "warn" | "alert"; ticker: string; weightPct: number }
  | { kind: "sector"; level: "warn"; sector: string; weightPct: number };

/** The full deterministic household-health read. Every figure is derived; none
 *  is persisted (recomputed per view / per seed). */
export type PortfolioHealth = {
  /** Pass-through quote snapshot as-of (staleness label). */
  asOf: string | null;
  /** Explicit v1 caveat: funds are opaque, no look-through (Key Decision 5). */
  lookThrough: "none";
  /** Σ priced MV + Σ account cash; null when nothing priceable and no cash. */
  totalNav: number | null;
  /** totalNav − cash bucket; null when totalNav is null. */
  investedNav: number | null;
  /** Account cash + MV of cash-class / money-market holdings. */
  cash: { amount: number; pct: number | null };
  coverage: {
    pricedPositions: number;
    /** Ticker-merged count, including unpriced + excluded-only. */
    totalPositions: number;
    unpricedTickers: string[];
    /** Positions whose every row is `inconsistent_history`. */
    excludedTickers: string[];
  };
  /** Sorted by |exposureWeightPct| desc, unpriced last. */
  positions: HealthPosition[];
  /** Of totalNav (cash is a class; sums to ~100 at full coverage). */
  assetClassAllocation: Array<{ assetClass: AssetClass; marketValue: number; pct: number | null }>;
  /** Of investedNav (funds and unclassified as their own buckets). Each bucket
   *  carries its constituent tickers (weight desc) for the drill-down. */
  sectorExposure: Array<{
    bucket: string;
    marketValue: number;
    pct: number | null;
    constituents: SectorConstituent[];
  }>;
  concentration: {
    /** Single-name-eligible (equity/crypto) only; null when none priced. */
    maxPosition: { ticker: string; weightPct: number } | null;
    top5Pct: number | null;
    top10Pct: number | null;
    /** 1 / Σ(exposureWeight²) over priced non-cash positions. */
    effectivePositions: number | null;
    flags: HealthFlag[];
  };
};

/** A finite number, or null (guards NaN/Infinity out of the math). */
function finiteOrNull(n: number | null | undefined): number | null {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/** A holding whose mass belongs to the cash bucket, not the invested book: an
 *  explicit cash-class row OR a money-market fund (both value at par per
 *  `value-holding.ts`). Kept consistent with the valuation rule so cash never
 *  double-counts into exposure/sector/concentration. */
function isCashPosition(assetClass: AssetClass, assetType: AssetType): boolean {
  return assetClass === "cash" || assetType === "money_market";
}

/** Sector bucket for a position, deterministic off `assetType` (Key Decision 5).
 *  Cash positions are handled before this is called (they never reach the sector
 *  view). */
function sectorBucket(assetType: AssetType, sector: string | null): string {
  switch (assetType) {
    case "equity":
      return sector ?? UNCLASSIFIED_BUCKET;
    case "etf":
    case "mutual_fund":
      return FUNDS_BUCKET;
    case "crypto":
      return "Crypto";
    case "bond":
      return "Fixed income";
    default:
      // option / other (money_market never reaches here — it is a cash position).
      return "Other";
  }
}

/** Weight as a percent of a denominator, guarded: denom ≤ 0 → null. */
function pctOf(value: number | null, denom: number | null): number | null {
  if (value === null || denom === null || denom <= 0) return null;
  return (value / denom) * 100;
}

/**
 * Summarize the household book across all accounts. `accounts` is the inline-
 * holdings `AccountState` shape (`toAccountStates` / the pane's `usePortfolioAccounts`);
 * `quotes` is a UPPER-ticker → { price, asOf } map from any source (the pane's
 * quotes resource / seed's `app.quotes`); `classifications` maps equity tickers
 * to a Yahoo sector (or null). `asOf` is the snapshot label passed through.
 *
 * Pure and total: never throws on any typechecking input; every division is
 * guarded; empty inputs produce nulls / empty arrays.
 */
export function summarizePortfolioHealth(
  accounts: ReadonlyArray<Readonly<AccountState>>,
  quotes: QuoteMap,
  classifications: ClassificationMap,
  asOf: string | null,
): PortfolioHealth {
  // --- Pass 1: ticker-merge holdings across accounts, valuing included rows. ---
  type Merged = {
    ticker: string;
    assetClass: AssetClass;
    assetType: AssetType;
    quantity: number;
    marketValue: number | null; // null when no included row is priceable
    includedRows: number;
    excludedRows: number;
    // |MV| of the row whose classification currently wins the merge — so the
    // merged line's class/type is decided deterministically by the DOMINANT lot,
    // not by iteration order, when two accounts disagree on a symbol's type
    // (e.g. one CSV tags it `equity`, another `etf`).
    classifierMass: number;
    accounts: Array<{ accountId: string; label: string; quantity: number; marketValue: number | null }>;
  };
  const merged = new Map<string, Merged>();
  let cashAmount = 0;

  for (const acc of accounts) {
    cashAmount += finiteOrNull(acc.cashBalance) ?? 0;
    for (const h of acc.holdings) {
      const key = h.ticker.toUpperCase();
      let m = merged.get(key);
      if (!m) {
        m = {
          ticker: key,
          assetClass: h.assetClass,
          assetType: h.assetType,
          quantity: 0,
          marketValue: null,
          includedRows: 0,
          excludedRows: 0,
          classifierMass: -1,
          accounts: [],
        };
        merged.set(key, m);
      }
      // Excluded rows (unaccounted split, quantity 0) never enter money math;
      // they are counted so the view can surface the ⚠ instead of shrinking.
      if (h.dataQuality === "inconsistent_history") {
        m.excludedRows += 1;
        continue;
      }
      m.includedRows += 1;
      m.quantity += h.quantity;
      const quote = quotes.get(key);
      const mv = holdingMarketValue(h, quote ? { price: quote.price } : undefined);
      if (mv !== null) m.marketValue = (m.marketValue ?? 0) + mv;
      // The larger-mass lot defines the merged classification (deterministic).
      // An unpriced row still wins over the initial placeholder (mass -1) so the
      // first row seen classifies a fully-unpriced position.
      const rowMass = mv === null ? 0 : Math.abs(mv);
      if (rowMass > m.classifierMass) {
        m.classifierMass = rowMass;
        m.assetClass = h.assetClass;
        m.assetType = h.assetType;
      }
      m.accounts.push({
        accountId: acc.accountId,
        label: acc.name,
        quantity: h.quantity,
        marketValue: mv,
      });
    }
  }

  // --- Pass 2: NAV, cash, coverage. ---
  let investedMassKnown = 0; // Σ priced non-cash MV
  let anyPriced = false;
  for (const m of merged.values()) {
    if (m.marketValue === null) continue;
    anyPriced = true;
    if (isCashPosition(m.assetClass, m.assetType)) cashAmount += m.marketValue;
    else investedMassKnown += m.marketValue;
  }
  const totalNav = anyPriced || cashAmount !== 0 ? investedMassKnown + cashAmount : null;
  const investedNav = totalNav === null ? null : totalNav - cashAmount;

  // --- Pass 3: per-position weights + classification. ---
  const positions: HealthPosition[] = [];
  const unpricedTickers: string[] = [];
  const excludedTickers: string[] = [];
  let pricedPositions = 0;

  for (const m of merged.values()) {
    const excludedOnly = m.includedRows === 0 && m.excludedRows > 0;
    if (excludedOnly) excludedTickers.push(m.ticker);
    else if (m.marketValue === null) unpricedTickers.push(m.ticker);
    else pricedPositions += 1;

    const cash = isCashPosition(m.assetClass, m.assetType);
    const sector = m.assetType === "equity" ? (classifications.get(m.ticker) ?? null) : null;
    positions.push({
      ticker: m.ticker,
      assetClass: m.assetClass,
      assetType: m.assetType,
      quantity: m.quantity,
      marketValue: m.marketValue,
      allocationWeightPct: pctOf(m.marketValue, totalNav),
      // Cash positions have no exposure weight (they are not part of the invested book).
      exposureWeightPct: cash ? null : pctOf(m.marketValue, investedNav),
      sector,
      accounts: m.accounts,
      excludedRows: m.excludedRows,
    });
  }

  // Sort by |exposureWeightPct| desc; unpriced / no-exposure last, stable by ticker.
  positions.sort((a, b) => {
    const aw = a.exposureWeightPct === null ? -1 : Math.abs(a.exposureWeightPct);
    const bw = b.exposureWeightPct === null ? -1 : Math.abs(b.exposureWeightPct);
    if (aw !== bw) return bw - aw;
    return a.ticker.localeCompare(b.ticker);
  });

  // --- Asset-class allocation (of totalNav); cash-predicate mass folds to `cash`. ---
  const classMass = new Map<AssetClass, number>();
  classMass.set("cash", cashAmount);
  for (const m of merged.values()) {
    if (m.marketValue === null) continue;
    const cls: AssetClass = isCashPosition(m.assetClass, m.assetType) ? "cash" : m.assetClass;
    if (cls === "cash") continue; // already folded into cashAmount above
    classMass.set(cls, (classMass.get(cls) ?? 0) + m.marketValue);
  }
  const assetClassAllocation = [...classMass.entries()]
    .filter(([, mv]) => mv !== 0)
    .map(([assetClass, marketValue]) => ({ assetClass, marketValue, pct: pctOf(marketValue, totalNav) }))
    .sort((a, b) => b.marketValue - a.marketValue);

  // --- Sector exposure (of investedNav); priced non-cash positions only. ---
  const sectorMass = new Map<string, number>();
  const sectorConstituents = new Map<string, SectorConstituent[]>();
  for (const m of merged.values()) {
    if (m.marketValue === null || isCashPosition(m.assetClass, m.assetType)) continue;
    const bucket = sectorBucket(m.assetType, classifications.get(m.ticker) ?? null);
    sectorMass.set(bucket, (sectorMass.get(bucket) ?? 0) + m.marketValue);
    const list = sectorConstituents.get(bucket) ?? [];
    list.push({
      ticker: m.ticker,
      assetType: m.assetType,
      marketValue: m.marketValue,
      weightPct: pctOf(m.marketValue, investedNav),
    });
    sectorConstituents.set(bucket, list);
  }
  const sectorExposure = [...sectorMass.entries()]
    .map(([bucket, marketValue]) => ({
      bucket,
      marketValue,
      pct: pctOf(marketValue, investedNav),
      constituents: (sectorConstituents.get(bucket) ?? []).sort(
        (a, b) => b.marketValue - a.marketValue,
      ),
    }))
    .sort((a, b) => b.marketValue - a.marketValue);

  // --- Concentration (of investedNav). ---
  const concentration = computeConcentration(positions, investedNav, sectorExposure);

  return {
    asOf,
    lookThrough: "none",
    totalNav,
    investedNav,
    cash: { amount: cashAmount, pct: pctOf(cashAmount, totalNav) },
    coverage: {
      pricedPositions,
      totalPositions: merged.size,
      unpricedTickers,
      excludedTickers,
    },
    positions,
    assetClassAllocation,
    sectorExposure,
    concentration,
  };
}

/** A position eligible for single-name concentration: a priced non-cash equity
 *  or crypto (funds are exempt — a 30% SPY is not a 30% single name). */
function isSingleNameEligible(p: HealthPosition): boolean {
  return (
    p.marketValue !== null &&
    p.exposureWeightPct !== null &&
    (p.assetType === "equity" || p.assetType === "crypto")
  );
}

function computeConcentration(
  positions: HealthPosition[],
  investedNav: number | null,
  sectorExposure: Array<{ bucket: string; marketValue: number; pct: number | null }>,
): PortfolioHealth["concentration"] {
  // top-N / effective-N are over ALL priced non-cash positions (funds included —
  // "biggest lines", not a single-name read).
  const investedPositions = positions.filter(
    (p) => p.marketValue !== null && p.exposureWeightPct !== null,
  );
  const byWeightDesc = [...investedPositions].sort(
    (a, b) => Math.abs(b.exposureWeightPct as number) - Math.abs(a.exposureWeightPct as number),
  );
  const sumTopN = (n: number): number | null =>
    investedPositions.length === 0
      ? null
      : byWeightDesc.slice(0, n).reduce((s, p) => s + Math.abs(p.exposureWeightPct as number), 0);

  const top5Pct = sumTopN(5);
  const top10Pct = sumTopN(10);

  // Effective number of positions = 1 / Σ(exposureWeight²), weights as fractions.
  let sumSq = 0;
  for (const p of investedPositions) {
    const w = (p.exposureWeightPct as number) / 100;
    sumSq += w * w;
  }
  const effectivePositions = sumSq > 0 ? 1 / sumSq : null;

  // Single-name max + flags (equity/crypto only).
  const singleNames = positions.filter(isSingleNameEligible);
  let maxPosition: { ticker: string; weightPct: number } | null = null;
  const flags: HealthFlag[] = [];
  for (const p of singleNames) {
    const w = p.exposureWeightPct as number;
    if (maxPosition === null || Math.abs(w) > Math.abs(maxPosition.weightPct)) {
      maxPosition = { ticker: p.ticker, weightPct: w };
    }
    const absW = Math.abs(w);
    if (absW > SINGLE_NAME_ALERT_PCT) {
      flags.push({ kind: "single_name", level: "alert", ticker: p.ticker, weightPct: w });
    } else if (absW > SINGLE_NAME_WARN_PCT) {
      flags.push({ kind: "single_name", level: "warn", ticker: p.ticker, weightPct: w });
    }
  }

  // Sector flags — the data-gap and known-caveat buckets never flag.
  for (const s of sectorExposure) {
    if (s.pct === null) continue;
    if (s.bucket === UNCLASSIFIED_BUCKET || s.bucket === FUNDS_BUCKET) continue;
    if (s.pct > SECTOR_WARN_PCT) {
      flags.push({ kind: "sector", level: "warn", sector: s.bucket, weightPct: s.pct });
    }
  }

  return { maxPosition, top5Pct, top10Pct, effectivePositions, flags };
}
