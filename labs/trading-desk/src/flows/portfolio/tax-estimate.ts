/**
 * Deterministic current-year federal+state tax estimate (FIX-874).
 *
 * A deliberately-rough UPPER BOUND (decision 7a), NOT a filing-grade Schedule-D
 * calculator. Every omitted step (loss netting, the $3k loss deduction,
 * carryforward, bracket stacking, wash sales, NIIT, qualified-dividend nuance)
 * only REDUCES real tax, so this figure is a ceiling by construction. Framed as
 * a planning estimate, never advice — the desk's real-money honesty posture.
 *
 * Method: ST gains + interest are taxed at the flat marginal ordinary rate; LT
 * gains + qualified dividends at the flat 0/15/20 LTCG rate. Each character
 * bucket AND each income sub-bucket is floored at 0 INDIVIDUALLY — a net loss or
 * a negative same-year correction contributes 0, never a negative, and never
 * cancels a differently-charactered gain. No cross-netting between ST and LT.
 *
 * Pure leaf (BP-019): imports only `./tax-schema` + `./tax-tables`, no
 * `@flow-state-dev/core`, browser-safe.
 */
import { marginalOrdinaryRate, ltcgRate, TAX_YEAR, TAX_TABLE_SOURCE } from "./tax-tables";
import type { TaxProfileInput } from "./tax-schema";

/** The always-present caveat: this is an upper-bound planning figure, not advice. */
const UPPER_BOUND_CAVEAT =
  "Rough upper-bound estimate, not filing-grade. Ignores loss netting/carryforward, bracket stacking, wash sales, NIIT, and qualified-dividend nuance — your actual tax is likely lower. Not tax advice.";

/** The estimate shown on the household tax card. Rates are the FRACTIONS
 *  actually applied; dollar figures are display approximations (RISK-P5). */
export type TaxEstimate = {
  /** The bracket-table year applied (always {@link TAX_YEAR}). */
  year: number;
  /** Provenance of the bracket figures ({@link TAX_TABLE_SOURCE}). */
  tableSource: string;
  /** max(0, shortGains) + max(0, interest) — taxed at the ordinary rate. */
  ordinaryGains: number;
  /** max(0, longGains) + max(0, dividends) — taxed at the LTCG rate. */
  preferentialGains: number;
  /** The ordinary rate applied (fraction). */
  effectiveOrdinaryRate: number;
  /** The LTCG rate applied (fraction). */
  effectiveLtcgRate: number;
  /** ordinaryGains×ordinaryRate + preferentialGains×ltcgRate. */
  estimatedFederal: number;
  /** (ordinaryGains + preferentialGains) × stateRate. */
  estimatedState: number;
  /** estimatedFederal + estimatedState. */
  estimatedTotal: number;
  /** Proceeds whose cost basis was unknown, passed through for honesty. */
  basisUnknownProceeds: number;
  /** Count of basis-unknown disposals, passed through for honesty. */
  basisUnknownCount: number;
  /** Human-readable caveats; ALWAYS includes the upper-bound line. */
  assumptions: string[];
};

/** Inputs to the estimate: a resolved profile (or null), the run year, and the
 *  already-summed current-year gain/income buckets (may be negative — corrections
 *  and net losses are floored inside). */
export type TaxEstimateInput = {
  profile: TaxProfileInput | null;
  year: number;
  /** Net short-term gain (may be negative). */
  shortGains: number;
  /** Net long-term gain (may be negative). */
  longGains: number;
  /** Dividend income (may be negative — a same-year correction). */
  dividends: number;
  /** Interest income (may be negative — a same-year correction). */
  interest: number;
  basisUnknownProceeds: number;
  basisUnknownCount: number;
};

/** Floor a value at 0 (a loss/correction contributes nothing, never a negative). */
const nonNeg = (n: number): number => Math.max(0, n);

/**
 * Estimate current-year tax liability as an upper bound. NEVER throws: a null
 * profile returns all zeros with a "set a profile" assumption. Rate overrides
 * are on the 0..100 scale and divided by 100 before applying; absent overrides
 * fall back to the flat bracket lookup keyed on the profile's baseline income.
 */
export function estimateTaxLiability(input: TaxEstimateInput): TaxEstimate {
  const {
    profile,
    year,
    shortGains,
    longGains,
    dividends,
    interest,
    basisUnknownProceeds,
    basisUnknownCount,
  } = input;

  // Each character bucket and each sub-bucket is floored INDIVIDUALLY.
  const ordinaryGains = nonNeg(shortGains) + nonNeg(interest);
  const preferentialGains = nonNeg(longGains) + nonNeg(dividends);

  if (profile === null) {
    return {
      year,
      tableSource: TAX_TABLE_SOURCE,
      ordinaryGains,
      preferentialGains,
      effectiveOrdinaryRate: 0,
      effectiveLtcgRate: 0,
      estimatedFederal: 0,
      estimatedState: 0,
      estimatedTotal: 0,
      basisUnknownProceeds,
      basisUnknownCount,
      assumptions: [
        "No tax profile set — enter filing status and income for an estimate.",
      ],
    };
  }

  const baselineIncome = profile.taxableIncome ?? 0;

  const effectiveOrdinaryRate =
    profile.marginalOrdinaryRatePct !== null
      ? profile.marginalOrdinaryRatePct / 100
      : marginalOrdinaryRate(profile.filingStatus, baselineIncome);

  const effectiveLtcgRate =
    profile.ltcgRatePct !== null
      ? profile.ltcgRatePct / 100
      : ltcgRate(profile.filingStatus, baselineIncome);

  const estimatedFederal =
    ordinaryGains * effectiveOrdinaryRate + preferentialGains * effectiveLtcgRate;

  const stateRate = (profile.stateRatePct ?? 0) / 100;
  const estimatedState = (ordinaryGains + preferentialGains) * stateRate;

  const assumptions = [UPPER_BOUND_CAVEAT];
  if (year !== TAX_YEAR) {
    assumptions.push(`Using ${TAX_YEAR} brackets.`);
  }

  return {
    year,
    tableSource: TAX_TABLE_SOURCE,
    ordinaryGains,
    preferentialGains,
    effectiveOrdinaryRate,
    effectiveLtcgRate,
    estimatedFederal,
    estimatedState,
    estimatedTotal: estimatedFederal + estimatedState,
    basisUnknownProceeds,
    basisUnknownCount,
    assumptions,
  };
}
