/**
 * The current-year federal tax estimate (FIX-874) — a deterministic, pure leaf
 * (BP-019, imports only the profile schema type).
 *
 * This is a deliberately-rough UPPER BOUND (OQ #7), not filing-grade advice: the
 * user's own marginal ordinary rate and long-term capital-gains rate are applied
 * DIRECTLY to each taxable bucket — no bracket-table walking, no income
 * stacking. It is the industry-standard posture for a planning preview
 * (Betterment's Tax Impact Preview), and it keeps the honest real-money framing
 * the rest of the desk holds.
 *
 * What it still models faithfully, because these materially change the number:
 * ST/LT netting with Schedule-D cross-netting, the $3,000 ($1,500-MFS) ordinary
 * capital-loss cap + carryforward (display-only), per-bucket income floors so a
 * same-year income reversal can't erase a differently-charactered gain, and the
 * taxable-account / USD-row filter (applied upstream by the route before summing).
 */
import type { TaxProfileInput } from "../schema/tax-schema";

/** The reference year the estimate defaults to (the desk's "current" year). */
export const TAX_YEAR = 2026;

/** The summed, bucketed inputs `estimateTaxLiability` consumes. */
export type TaxEstimateInputs = {
  shortGains: number;
  longGains: number;
  dividends: number;
  interest: number;
  /** Summed proceeds of excluded disposals whose proceeds ARE known (a
   *  basis/term-unknown but priced sale). Excludes proceeds-unknown placeholders,
   *  whose proceeds are null — folding those in as $0 would understate the figure
   *  and make the note read "≈ $0 excluded". */
  basisUnknownProceeds: number;
  basisUnknownCount: number;
  /** How many of the excluded disposals have UNKNOWN proceeds (the OFX
   *  proceeds-unknown placeholder). When > 0 the note can't state a complete
   *  dollar figure. */
  proceedsUnknownCount: number;
};

/**
 * Shape the persisted realized-gain + income-by-year rows into the estimate's
 * bucket sums (FIX-874) — the pure filter the tax route composes in-handler and
 * the goal-check test shares (no duplicated route logic).
 *
 * Keeps ONLY rows that are (1) in a TAXABLE account, (2) in USD (row-level
 * currency — a default-USD account can hold foreign rows), and (3) dated in the
 * requested `year`. A disposal contributes to ST/LT buckets ONLY when
 * `gain !== null` AND `term !== "unknown"`; every other kept disposal is surfaced
 * in `basisUnknownProceeds`/`basisUnknownCount` (honest exclusion, never zeroed).
 */
export function summarizeForTaxEstimate(input: {
  realized: ReadonlyArray<{
    accountId: string;
    term: "short" | "long" | "unknown";
    gain: number | null;
    proceeds: number | null;
    currency: string;
    disposedDate: string;
  }>;
  income: ReadonlyArray<{
    accountId: string;
    dividends: number;
    interest: number;
    currency: string;
    year: number;
  }>;
  taxableAccountIds: ReadonlySet<string>;
  year: number;
}): TaxEstimateInputs {
  const out: TaxEstimateInputs = {
    shortGains: 0,
    longGains: 0,
    dividends: 0,
    interest: 0,
    basisUnknownProceeds: 0,
    basisUnknownCount: 0,
    proceedsUnknownCount: 0,
  };
  for (const r of input.realized) {
    if (!input.taxableAccountIds.has(r.accountId)) continue;
    if (r.currency !== "USD") continue;
    if (Number(r.disposedDate.slice(0, 4)) !== input.year) continue;
    if (r.gain !== null && r.term !== "unknown") {
      if (r.term === "short") out.shortGains += r.gain;
      else out.longGains += r.gain;
    } else {
      // A proceeds-unknown placeholder has null proceeds — count it as unknown
      // rather than folding a fabricated $0 into the excluded-proceeds sum.
      if (r.proceeds === null) out.proceedsUnknownCount += 1;
      else out.basisUnknownProceeds += r.proceeds;
      out.basisUnknownCount += 1;
    }
  }
  for (const i of input.income) {
    if (!input.taxableAccountIds.has(i.accountId)) continue;
    if (i.currency !== "USD") continue;
    if (i.year !== input.year) continue;
    out.dividends += i.dividends;
    out.interest += i.interest;
  }
  return out;
}

/** The Schedule-D annual capital-loss deduction against ordinary income. */
function lossCap(filingStatus: TaxProfileInput["filingStatus"]): number {
  return filingStatus === "mfs" ? 1500 : 3000;
}

/** The estimate result — every field traces to an input; the UI renders it
 *  directly with a not-advice disclaimer. */
export type TaxEstimate = {
  year: number;
  /** Net short-term capital gain/loss fed in (may be negative). */
  netShortTerm: number;
  /** Net long-term capital gain/loss fed in (may be negative). */
  netLongTerm: number;
  /** Ordinary bucket: max(0, net ST gain) + interest, less the capped loss. */
  ordinaryTaxable: number;
  /** Preferential bucket: max(0, net LT gain) + qualified dividends. */
  ltcgTaxable: number;
  /** Capital loss applied to ordinary income this year (≤ 3000/1500). */
  deductibleLossThisYear: number;
  /** Loss beyond the cap — informational; NOT applied to future years. */
  lossCarryforward: number;
  estimatedFederal: number;
  estimatedState: number;
  estimatedTotal: number;
  effectiveOrdinaryRate: number;
  effectiveLtcgRate: number;
  effectiveStateRate: number;
  /** Proceeds of excluded disposals whose proceeds are KNOWN (unknown basis/term
   *  but priced). Excludes proceeds-unknown placeholders — see `proceedsUnknownCount`. */
  basisUnknownProceeds: number;
  basisUnknownCount: number;
  /** How many excluded disposals have unknown proceeds (no dollar figure). */
  proceedsUnknownCount: number;
  /** Rendered as caveats under the figure. */
  assumptions: string[];
};

/** A zeroed estimate (no profile, or nothing taxable) with the supplied caveats. */
function emptyEstimate(
  year: number,
  basisUnknownProceeds: number,
  basisUnknownCount: number,
  proceedsUnknownCount: number,
  assumptions: string[],
): TaxEstimate {
  return {
    year,
    netShortTerm: 0,
    netLongTerm: 0,
    ordinaryTaxable: 0,
    ltcgTaxable: 0,
    deductibleLossThisYear: 0,
    lossCarryforward: 0,
    estimatedFederal: 0,
    estimatedState: 0,
    estimatedTotal: 0,
    effectiveOrdinaryRate: 0,
    effectiveLtcgRate: 0,
    effectiveStateRate: 0,
    basisUnknownProceeds,
    basisUnknownCount,
    proceedsUnknownCount,
    assumptions,
  };
}

/**
 * Estimate the federal (+ optional flat state) tax on this year's realized gains
 * and portfolio income. `profile === null` returns zeros + an "enter your
 * profile" caveat, never throws (the route calls this for the no-profile state
 * without fabricating inputs). Gains/income are already filtered to taxable-USD
 * rows for `year` and summed by the caller.
 */
export function estimateTaxLiability(input: {
  profile: TaxProfileInput | null;
  year: number;
  shortGains: number;
  longGains: number;
  dividends: number;
  interest: number;
  basisUnknownProceeds: number;
  basisUnknownCount: number;
  proceedsUnknownCount: number;
}): TaxEstimate {
  const { profile, year, shortGains, longGains, dividends, interest } = input;
  const { basisUnknownProceeds, basisUnknownCount, proceedsUnknownCount } = input;

  if (profile === null) {
    return emptyEstimate(year, basisUnknownProceeds, basisUnknownCount, proceedsUnknownCount, [
      "No tax profile set — enter your filing status and marginal + long-term capital-gains rates for an estimate.",
    ]);
  }

  // Schedule-D netting with character-preserving cross-net. A loss in one
  // character first offsets its own category (the inputs are already net), then
  // the other category; a net-negative total is a capital loss carried below.
  const netShortTerm = shortGains;
  const netLongTerm = longGains;
  const totalNet = netShortTerm + netLongTerm;
  let shortTaxable: number;
  let longTaxable: number;
  let netCapitalLoss = 0;
  if (totalNet <= 0) {
    shortTaxable = 0;
    longTaxable = 0;
    netCapitalLoss = -totalNet;
  } else if (netShortTerm >= 0 && netLongTerm >= 0) {
    shortTaxable = netShortTerm;
    longTaxable = netLongTerm;
  } else if (netShortTerm < 0) {
    // Net ST loss absorbed into the (larger) LT gain; character becomes LT.
    shortTaxable = 0;
    longTaxable = totalNet;
  } else {
    // Net LT loss absorbed into the (larger) ST gain; character becomes ST.
    shortTaxable = totalNet;
    longTaxable = 0;
  }

  const deductibleLossThisYear = Math.min(netCapitalLoss, lossCap(profile.filingStatus));
  const lossCarryforward = netCapitalLoss - deductibleLossThisYear;

  // Per-bucket floors: a same-year income reversal (negative correction row)
  // must not silently cancel a differently-charactered capital gain, so each
  // income sub-bucket is floored at 0 before joining its bucket. The outer
  // max(0, …) on ordinary floors the capped-loss deduction (a $3k loss against
  // $100 interest is 0, never negative).
  const ordinaryTaxable = Math.max(
    0,
    Math.max(0, shortTaxable) + Math.max(0, interest) - deductibleLossThisYear,
  );
  // Dividends are assumed qualified (a documented v1 assumption).
  const ltcgTaxable = Math.max(0, longTaxable) + Math.max(0, dividends);

  const effectiveOrdinaryRate = profile.marginalOrdinaryRatePct / 100;
  const effectiveLtcgRate = profile.ltcgRatePct / 100;
  const effectiveStateRate = (profile.stateRatePct ?? 0) / 100;

  const estimatedFederal = ordinaryTaxable * effectiveOrdinaryRate + ltcgTaxable * effectiveLtcgRate;
  // Flat state rate applies to the FULL taxable bucket (dividends/interest are
  // already in the federal buckets), not gains alone.
  const estimatedState = (ordinaryTaxable + ltcgTaxable) * effectiveStateRate;

  const assumptions = [
    "Rough upper-bound estimate — your marginal rates are applied directly to each bucket. Not filing-grade tax advice.",
    "Dividends are assumed qualified (taxed at your long-term capital-gains rate).",
  ];
  if (year !== TAX_YEAR) {
    assumptions.push(`Reflects transactions dated ${year}; rates are the ones on your profile today.`);
  }
  if (netCapitalLoss > 0) {
    assumptions.push(
      `Net capital loss: $${deductibleLossThisYear.toLocaleString()} offsets ordinary income this year; $${lossCarryforward.toLocaleString()} carries forward (not applied to future years here).`,
    );
  }
  if (basisUnknownCount > 0) {
    // Never present a precise "$0 excluded" when some excluded disposals have
    // unknown proceeds — that reads as harmless. Qualify (or drop) the figure.
    const knownProceedsCount = basisUnknownCount - proceedsUnknownCount;
    let proceedsClause: string;
    if (proceedsUnknownCount === 0) {
      proceedsClause = `≈ $${Math.round(basisUnknownProceeds).toLocaleString()} proceeds`;
    } else if (knownProceedsCount === 0) {
      proceedsClause = "proceeds not yet reported";
    } else {
      proceedsClause = `≈ $${Math.round(basisUnknownProceeds).toLocaleString()} known proceeds, ${proceedsUnknownCount} with proceeds not yet reported`;
    }
    assumptions.push(
      `${basisUnknownCount} disposal(s) with unknown cost basis or holding period (${proceedsClause}) are excluded from the estimate.`,
    );
  }

  return {
    year,
    netShortTerm,
    netLongTerm,
    ordinaryTaxable,
    ltcgTaxable,
    deductibleLossThisYear,
    lossCarryforward,
    estimatedFederal,
    estimatedState,
    estimatedTotal: estimatedFederal + estimatedState,
    effectiveOrdinaryRate,
    effectiveLtcgRate,
    effectiveStateRate,
    basisUnknownProceeds,
    basisUnknownCount,
    proceedsUnknownCount,
    assumptions,
  };
}
