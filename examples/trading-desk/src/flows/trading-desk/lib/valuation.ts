/**
 * Pure derived-valuation computation from raw statement payloads.
 *
 * Takes the four already-fetched payloads (fundamentals, balance sheet,
 * income statement, cashflow) and produces a capital-structure-aware
 * valuation set. Each metric is `null` when its inputs are unobserved or
 * when a non-positive denominator makes the ratio uninterpretable. Proxy
 * metrics carry an explicit label naming the approximation.
 */
import type { z } from "zod";
import type {
  balanceSheetSchema,
  cashflowSchema,
  fundamentalsSchema,
  incomeStatementSchema,
} from "../phase-1/tools/schemas";

type Fundamentals = z.infer<typeof fundamentalsSchema>;
type BalanceSheet = z.infer<typeof balanceSheetSchema>;
type IncomeStatement = z.infer<typeof incomeStatementSchema>;
type Cashflow = z.infer<typeof cashflowSchema>;

export type DerivedMetric = {
  value: number | null;
  proxy?: string;
  note?: string;
};

export interface DerivedValuation {
  enterpriseValue: DerivedMetric;
  evToSales: DerivedMetric;
  evToEbit: DerivedMetric;
  evToFcf: DerivedMetric;
  priceToBook: DerivedMetric;
  fcfYield: DerivedMetric;
  priceToFcf: DerivedMetric;
  earningsYield: DerivedMetric;
  returnOnAssets: DerivedMetric;
  netDebt: DerivedMetric;
  netLeverage: DerivedMetric;
  roic: DerivedMetric;
  peg: DerivedMetric;
  pegy: DerivedMetric;
}

const PROXY_EBIT = "operating income used as EBIT proxy";
const PROXY_TAX = "approx — 21% tax assumption";
const PROXY_PEG = "revenue growth used in place of EPS growth";

const TAX_RATE = 0.21;

/** Returns `null` when the denominator is null or non-positive (ratio is uninterpretable). */
function ratio(
  numerator: number | null,
  denominator: number | null,
): number | null {
  if (numerator == null || denominator == null || denominator <= 0) return null;
  return numerator / denominator;
}

/** A statement input that is observed and strictly positive, else `null`.
 *  Collapses both "field unobserved" (null) and "non-positive, so the metric
 *  built on it is uninterpretable" into a single null signal. */
function pos(v: number | null): number | null {
  return v != null && v > 0 ? v : null;
}

/** Sum that is `null` if any addend is unobserved — an EV/net-debt figure
 *  built on a missing balance-sheet component is itself unobserved, not a
 *  partial sum that silently treats the missing piece as zero. */
function sum(...parts: Array<number | null>): number | null {
  let total = 0;
  for (const p of parts) {
    if (p == null) return null;
    total += p;
  }
  return total;
}

/** Compute the full Tier 1 derived valuation set from raw payloads. */
export function computeValuation(args: {
  fundamentals: Fundamentals;
  balanceSheet: BalanceSheet;
  incomeStatement: IncomeStatement;
  cashflow: Cashflow;
}): DerivedValuation {
  const { fundamentals: f, balanceSheet: bs, incomeStatement: is_, cashflow: cf } = args;

  const marketCap = f.marketCap;
  const totalDebt = bs.totalDebt;
  const cash = bs.cashAndEquivalents;
  const totalEquity = bs.totalEquity;
  const totalAssets = bs.totalAssets;
  const revenue = is_.revenue;
  const operatingIncome = is_.operatingIncome;
  const netIncome = is_.netIncome;
  const fcf = cf.freeCashFlow;
  const trailingPE = f.trailingPE;
  const yoyGrowth = is_.yoyRevenueGrowth;
  const divYield = f.dividendYield;

  // EV and net debt are `null` if any balance-sheet component is unobserved —
  // a partial sum that treats a missing piece as 0 would be a fabricated value.
  const netDebtVal = sum(totalDebt, cash == null ? null : -cash);
  const ev = sum(marketCap, totalDebt, cash == null ? null : -cash);
  const evPositive = pos(ev);

  const investedCapital = sum(totalDebt, totalEquity, cash == null ? null : -cash);

  const growthPct = yoyGrowth == null ? null : yoyGrowth * 100;
  const divYieldPct = divYield != null && divYield > 0 ? divYield * 100 : 0;
  const pegyDenom = growthPct == null ? null : growthPct + divYieldPct;

  return {
    enterpriseValue: {
      value: ev,
      ...(ev != null && ev <= 0
        ? { note: "net cash exceeds debt + equity market value" }
        : {}),
    },
    evToSales: { value: ratio(evPositive, revenue) },
    evToEbit: { value: ratio(evPositive, operatingIncome), proxy: PROXY_EBIT },
    evToFcf: { value: ratio(evPositive, fcf) },
    priceToBook: { value: ratio(marketCap, totalEquity) },
    fcfYield: { value: ratio(pos(fcf), marketCap) },
    priceToFcf: { value: ratio(marketCap, fcf) },
    earningsYield: { value: ratio(pos(netIncome), marketCap) },
    returnOnAssets: {
      // Keep a real negative ROA (loss-making name) — only null when assets
      // are unobserved/non-positive or net income is unobserved.
      value:
        totalAssets != null && totalAssets > 0 && netIncome != null
          ? netIncome / totalAssets
          : null,
    },
    netDebt: {
      value: netDebtVal,
      ...(netDebtVal != null && netDebtVal < 0 ? { note: "net cash" } : {}),
    },
    netLeverage: {
      value:
        netDebtVal != null && operatingIncome != null && operatingIncome > 0
          ? netDebtVal / operatingIncome
          : null,
    },
    roic: {
      value:
        operatingIncome != null &&
        operatingIncome > 0 &&
        investedCapital != null &&
        investedCapital > 0
          ? (operatingIncome * (1 - TAX_RATE)) / investedCapital
          : null,
      proxy: PROXY_TAX,
    },
    peg: {
      value:
        trailingPE != null && growthPct != null && growthPct > 0
          ? trailingPE / growthPct
          : null,
      proxy: PROXY_PEG,
    },
    pegy: {
      value:
        trailingPE != null && pegyDenom != null && pegyDenom > 0
          ? trailingPE / pegyDenom
          : null,
      proxy: PROXY_PEG,
      ...(divYield == null
        ? { note: "dividend yield absent; denominator is growth-only (equals PEG)" }
        : {}),
    },
  };
}

export type MetricVerdict = "cheap" | "fair" | "expensive" | "n/a";

/** Absolute heuristic bands for ratio-type metrics. Cheap/expensive when
 *  more than one standard deviation from a reasonable sector median. These
 *  are blunt fallbacks — justified-multiple comparison is preferred when
 *  the valuation spine provides one. */
const RATIO_BANDS: Record<string, { cheap: number; expensive: number }> = {
  evToSales: { cheap: 2.0, expensive: 10.0 },
  evToEbit: { cheap: 10.0, expensive: 25.0 },
  evToFcf: { cheap: 15.0, expensive: 35.0 },
  priceToBook: { cheap: 1.5, expensive: 5.0 },
  priceToFcf: { cheap: 15.0, expensive: 35.0 },
  peg: { cheap: 0.8, expensive: 2.0 },
  pegy: { cheap: 0.6, expensive: 1.5 },
};

const YIELD_BANDS: Record<string, { cheap: number; expensive: number }> = {
  fcfYield: { cheap: 0.06, expensive: 0.02 },
  earningsYield: { cheap: 0.06, expensive: 0.02 },
};

function verdictForRatio(key: string, value: number | null): MetricVerdict {
  if (value == null) return "n/a";
  const band = RATIO_BANDS[key];
  if (!band) return "fair";
  if (value <= band.cheap) return "cheap";
  if (value >= band.expensive) return "expensive";
  return "fair";
}

function verdictForYield(key: string, value: number | null): MetricVerdict {
  if (value == null) return "n/a";
  const band = YIELD_BANDS[key];
  if (!band) return "fair";
  // Higher yield = cheaper
  if (value >= band.cheap) return "cheap";
  if (value <= band.expensive) return "expensive";
  return "fair";
}

/** Render a `DerivedValuation` as a compact labeled block for prompt injection.
 *  Each metric now carries a cheap / fair / expensive / n/a verdict. */
export function formatValuation(v: DerivedValuation): string {
  const lines: string[] = [];

  const fmt = (
    label: string,
    m: DerivedMetric,
    style: "money" | "ratio" | "pct",
    verdict?: MetricVerdict,
  ) => {
    if (m.value == null) {
      lines.push(`${label}: n/a`);
      return;
    }
    let display: string;
    if (style === "money") display = `$${m.value.toFixed(1)}B`;
    else if (style === "pct") display = `${(m.value * 100).toFixed(2)}%`;
    else display = `${m.value.toFixed(2)}×`;

    const suffixes: string[] = [];
    if (verdict && verdict !== "n/a") suffixes.push(verdict);
    if (m.proxy) suffixes.push(`proxy: ${m.proxy}`);
    if (m.note) suffixes.push(m.note);
    const suffix = suffixes.length > 0 ? ` (${suffixes.join("; ")})` : "";
    lines.push(`${label}: ${display}${suffix}`);
  };

  fmt("Enterprise value", v.enterpriseValue, "money");
  fmt("EV/Sales", v.evToSales, "ratio", verdictForRatio("evToSales", v.evToSales.value));
  fmt("EV/EBIT", v.evToEbit, "ratio", verdictForRatio("evToEbit", v.evToEbit.value));
  fmt("EV/FCF", v.evToFcf, "ratio", verdictForRatio("evToFcf", v.evToFcf.value));
  fmt("Price/Book", v.priceToBook, "ratio", verdictForRatio("priceToBook", v.priceToBook.value));
  fmt("FCF yield", v.fcfYield, "pct", verdictForYield("fcfYield", v.fcfYield.value));
  fmt("Price/FCF", v.priceToFcf, "ratio", verdictForRatio("priceToFcf", v.priceToFcf.value));
  fmt("Earnings yield", v.earningsYield, "pct", verdictForYield("earningsYield", v.earningsYield.value));
  fmt("ROA", v.returnOnAssets, "pct");
  fmt("Net debt", v.netDebt, "money");
  fmt("Net leverage", v.netLeverage, "ratio");
  fmt("ROIC", v.roic, "pct");
  fmt("PEG", v.peg, "ratio", verdictForRatio("peg", v.peg.value));
  fmt("PEGY", v.pegy, "ratio", verdictForRatio("pegy", v.pegy.value));

  return lines.join("\n");
}
