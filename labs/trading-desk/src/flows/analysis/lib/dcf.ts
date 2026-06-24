/**
 * Multi-stage DCF intrinsic-value method — the value leg that covers the
 * high-growth cohort justified-PE abstains on.
 *
 * Structure: a 5-year explicit free-cash-flow projection with growth fading
 * LINEARLY from a stage-1 rate down to a terminal rate (the H-model convention,
 * so the last explicit year ≈ terminal and the transition into the Gordon tail
 * is smooth), a Gordon terminal value, present-valued at a sector/leverage-aware
 * discount rate, minus net debt → a company-level EQUITY intrinsic value in $B
 * (market-cap units, NEVER per-share — the snapshot carries no share count).
 * Margin of safety = 1 − marketCap / intrinsicValue.
 *
 * FCFF-proxy approximation: the model projects `cashflow.freeCashFlow` and
 * subtracts net debt to bridge enterprise value → equity value — an FCFF
 * (free-cash-flow-to-firm) treatment. The snapshot's `freeCashFlow` is generic
 * reported FCF, which is an FCFF *proxy* (a precise FCFE path would not subtract
 * net debt). This mirrors `valuation.ts`'s "operating income as EBIT proxy" /
 * "21% tax assumption" labeling discipline.
 *
 * Reverse DCF: holding price fixed, bisect for the stage-1 growth rate that
 * makes the discounted cash flows equal the market enterprise value, then
 * compare that *implied* growth to what fundamentals support (the expectations
 * gap). Makes the market's embedded growth assumption explicit.
 *
 * Nullable honesty: the method reports n/a (all nulls, available: false, with a
 * structured `unavailableReason`) for financials, non-positive FCF, unobserved
 * net debt, a missing growth estimate, or a non-positive equity value — rather
 * than emitting a figure its assumptions don't support. A terminal-value share
 * above the reliability band is a FLAG (`tv-dominated`), not an abstention.
 *
 * Sources: Damodaran (stable growth / terminal value, cost of capital by
 * sector); Mauboussin, Expectations Investing (reverse DCF); virattt/dexter
 * dcf skill (5-year horizon, ~2.5% terminal, TV-share reliability band).
 */
import type { z } from "zod";
import type {
  cashflowSchema,
  fundamentalsSchema,
  incomeStatementSchema,
} from "../tools/schemas";
import type { ExpectedReturn } from "./expected-return";
import { isFinancialSector } from "./fair-value";
import { resolveDiscountRate } from "./discount-rate";
import type { DerivedValuation } from "./valuation";

type Fundamentals = z.infer<typeof fundamentalsSchema>;
type IncomeStatement = z.infer<typeof incomeStatementSchema>;
type Cashflow = z.infer<typeof cashflowSchema>;

export const DCF_EXPLICIT_YEARS = 5;
/** Tighter than the 25% expected-return cap: keeps a 5-year compounding sane. */
export const DCF_STAGE1_CAP = 0.15;
export const DCF_TERMINAL_GROWTH = 0.02;
/** Terminal-value share above this → flag `tv-dominated` (false precision). */
export const TV_SHARE_RELIABLE_MAX = 0.85;
/** Reverse-DCF solve bracket upper bound: 100% stage-1 FCF growth. */
const REVERSE_DCF_MAX_GROWTH = 1.0;
const REVERSE_DCF_ITERATIONS = 60;

export type DcfUnavailableReason =
  | "financial-sector"
  | "non-positive-fcf"
  | "missing-net-debt"
  | "missing-growth"
  | "negative-equity-value"
  | null;

export type ReverseDcfStatus =
  | "solved" // bisection found g' in (terminal, 1.00)
  | "below-terminal" // market EV ≤ EV(terminal): market implies sub-terminal growth
  | "above-bracket" // market EV > EV(1.00): expectations exceed the solve bracket
  | "unavailable"; // DCF itself abstained

export interface DcfValue {
  /** Equity value in $B (market-cap units) — never per-share. */
  intrinsicValue: number | null;
  marginOfSafety: number | null;
  discountRate: number | null;
  stage1Growth: number | null;
  terminalValueShare: number | null;
  /** Reverse-DCF: the stage-1 growth implied by the current price. */
  impliedGrowth: number | null;
  /** impliedGrowth − stage1Growth (how much more/less growth the price prices in). */
  expectationsGap: number | null;
  reliability: "ok" | "tv-dominated" | null;
  reverseDcfStatus: ReverseDcfStatus;
  /** Populated whenever `available === false`. */
  unavailableReason: DcfUnavailableReason;
  method: "dcf" | "none";
  available: boolean;
}

/** The all-null abstention shape, carrying the reason and a reverse-DCF status. */
function unavailable(reason: DcfUnavailableReason): DcfValue {
  return {
    intrinsicValue: null,
    marginOfSafety: null,
    discountRate: null,
    stage1Growth: null,
    terminalValueShare: null,
    impliedGrowth: null,
    expectationsGap: null,
    reliability: null,
    reverseDcfStatus: "unavailable",
    unavailableReason: reason,
    method: "none",
    available: false,
  };
}

/** Clamp `v` to `[lo, hi]`. */
function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Project enterprise value from a base FCF, a stage-1 growth rate, and a
 * discount rate: 5-year explicit FCF with a linear fade to terminal growth,
 * plus a Gordon terminal value, all present-valued. Shared by the forward DCF
 * and the reverse-DCF solve so both use identical mechanics.
 */
function projectEnterpriseValue(baseFcf: number, stage1Growth: number, r: number): {
  enterpriseValue: number;
  pvTerminal: number;
} {
  const n = DCF_EXPLICIT_YEARS;
  const terminal = DCF_TERMINAL_GROWTH;

  let fcf = baseFcf;
  let pvExplicit = 0;
  for (let t = 1; t <= n; t++) {
    // Linear fade: year 1 grows at stage1Growth, year n at terminal.
    const g = stage1Growth - (stage1Growth - terminal) * (t - 1) / (n - 1);
    fcf = fcf * (1 + g);
    pvExplicit += fcf / Math.pow(1 + r, t);
  }

  const terminalValue = fcf * (1 + terminal) / (r - terminal);
  const pvTerminal = terminalValue / Math.pow(1 + r, n);

  return { enterpriseValue: pvExplicit + pvTerminal, pvTerminal };
}

/**
 * Compute the DCF intrinsic value + reverse-DCF expectations gap for a name.
 * Returns the nullable n/a shape (with `unavailableReason`) when the method's
 * inputs don't hold. See the file header for the method and abstention rules.
 */
export function computeDcfValue(args: {
  fundamentals: Fundamentals;
  incomeStatement: IncomeStatement;
  cashflow: Cashflow;
  expectedReturn: ExpectedReturn;
  valuation: DerivedValuation | null;
  sector: string | null;
}): DcfValue {
  const { fundamentals: f, cashflow: cf, expectedReturn: er, valuation, sector } = args;

  // Abstention gates, in order — each returns the matching reason.
  if (isFinancialSector(sector)) return unavailable("financial-sector");
  const baseFcf = cf.freeCashFlow;
  if (baseFcf == null || baseFcf <= 0) return unavailable("non-positive-fcf");
  // A null valuation means net debt was never derived — can't bridge EV→equity.
  const netDebt = valuation?.netDebt.value ?? null;
  if (netDebt == null) return unavailable("missing-net-debt");
  if (er.sustainableGrowth == null) return unavailable("missing-growth");

  const stage1Growth = clamp(
    Math.min(er.sustainableGrowth, DCF_STAGE1_CAP),
    DCF_TERMINAL_GROWTH,
    DCF_STAGE1_CAP,
  );
  const r = resolveDiscountRate({ sector, netLeverage: valuation?.netLeverage.value ?? null }).rate;

  const { enterpriseValue, pvTerminal } = projectEnterpriseValue(baseFcf, stage1Growth, r);
  const intrinsicValue = enterpriseValue - netDebt;

  // A non-positive equity value is uninterpretable as a margin of safety.
  if (intrinsicValue <= 0) return unavailable("negative-equity-value");

  const marketCap = f.marketCap;
  const marginOfSafety = 1 - marketCap / intrinsicValue;
  const terminalValueShare = pvTerminal / enterpriseValue;
  const reliability: DcfValue["reliability"] =
    terminalValueShare > TV_SHARE_RELIABLE_MAX ? "tv-dominated" : "ok";

  // Reverse DCF: bisect for the stage-1 growth that makes the projected EV equal
  // the market EV (marketCap + netDebt), holding the discount rate fixed. EV is
  // monotonically increasing in stage-1 growth, so the bracket cases are clean.
  const marketEV = marketCap + netDebt;
  const evAtTerminal = projectEnterpriseValue(baseFcf, DCF_TERMINAL_GROWTH, r).enterpriseValue;
  const evAtMax = projectEnterpriseValue(baseFcf, REVERSE_DCF_MAX_GROWTH, r).enterpriseValue;

  let reverseDcfStatus: ReverseDcfStatus;
  let impliedGrowth: number | null;
  let expectationsGap: number | null;

  if (marketEV <= evAtTerminal) {
    // The market implies growth at/below terminal — cheap on the model.
    reverseDcfStatus = "below-terminal";
    impliedGrowth = DCF_TERMINAL_GROWTH;
    expectationsGap = DCF_TERMINAL_GROWTH - stage1Growth;
  } else if (marketEV > evAtMax) {
    // The market prices in more than 100% stage-1 FCF growth — off the bracket.
    reverseDcfStatus = "above-bracket";
    impliedGrowth = null;
    expectationsGap = null;
  } else {
    let lo = DCF_TERMINAL_GROWTH;
    let hi = REVERSE_DCF_MAX_GROWTH;
    for (let i = 0; i < REVERSE_DCF_ITERATIONS; i++) {
      const mid = (lo + hi) / 2;
      const ev = projectEnterpriseValue(baseFcf, mid, r).enterpriseValue;
      if (ev < marketEV) lo = mid;
      else hi = mid;
    }
    impliedGrowth = (lo + hi) / 2;
    expectationsGap = impliedGrowth - stage1Growth;
    reverseDcfStatus = "solved";
  }

  return {
    intrinsicValue,
    marginOfSafety,
    discountRate: r,
    stage1Growth,
    terminalValueShare,
    impliedGrowth,
    expectationsGap,
    reliability,
    reverseDcfStatus,
    unavailableReason: null,
    method: "dcf",
    available: true,
  };
}
