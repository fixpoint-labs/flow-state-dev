/**
 * SEC EDGAR XBRL `companyfacts` mapper.
 *
 * EDGAR is the authoritative US-filing statements source and the primary
 * provider for the three statement tools (ahead of Yahoo, which throttles its
 * unauthenticated endpoint and returned zero-filled statements — the bug this
 * fixes). `companyfacts` returns every us-gaap fact a filer has reported, so
 * the work is selecting the right tag and the right period, not access.
 *
 * This module is the pure mapping layer — given a raw `companyfacts` response
 * it produces the three canonical statement payloads. The HTTP fetch and the
 * ticker→CIK lookup live in `edgar.ts`.
 *
 * Selection rules learned from real filings:
 *  - Balance-sheet facts are *instant* (end-date only); income/cashflow facts
 *    are *duration* (start+end). The annual selector differs accordingly.
 *  - Total debt has no single tag: sum LongTermDebtNoncurrent + ...Current,
 *    falling back to the combined LongTermDebt tag.
 *  - Revenue lives under `Revenues` (older filings) or
 *    `RevenueFromContractWithCustomerExcludingAssessedTax` (newer). Pick the
 *    most recent across both rather than a fixed preference — a filer that
 *    switched tags leaves the old one frozen at a stale value.
 *  - EDGAR reports capex (`PaymentsToAcquirePropertyPlantAndEquipment`) as a
 *    positive outflow, so FCF = operating − capex.
 *  - A tag the filer never reported is absent → `null`, never 0.
 */
import type { ToolOutput } from "../schemas";
import type { FinancialPeriod } from "./financials-history";

/** One reported fact entry under a us-gaap tag's USD unit. EDGAR emits
 *  `start: null` (and `frame: null`) for instant balance-sheet facts, so both
 *  are typed nullable to match the raw JSON. */
type FactEntry = {
  start?: string | null;
  end?: string;
  val?: number;
  fy?: number;
  fp?: string;
  form?: string;
  frame?: string | null;
};

type Fact = { units?: { USD?: FactEntry[] } };

/** The raw `companyfacts` response shape (only the parts we read). US filers
 *  report under `us-gaap`; foreign private issuers (20-F) report under
 *  `ifrs-full`, with a USD convenience translation in the `USD` unit. */
export interface EdgarCompanyFacts {
  cik?: number;
  entityName?: string;
  facts?: {
    "us-gaap"?: Record<string, Fact>;
    "ifrs-full"?: Record<string, Fact>;
  };
}

const USD_BILLION = 1_000_000_000;
/** A duration fact spanning more than this many days is treated as annual. */
const ANNUAL_MIN_DAYS = 350;

function daysBetween(start: string, end: string): number {
  return (Date.parse(end) - Date.parse(start)) / 86_400_000;
}

/** All USD entries for a tag, or `[]` if the tag/unit is absent. */
function entries(facts: Record<string, Fact>, tag: string): FactEntry[] {
  return facts[tag]?.units?.USD ?? [];
}

/** Latest annual *instant* value (balance-sheet facts: end-date, no start). */
function latestInstantB(facts: Record<string, Fact>, tag: string): number | null {
  const usable = entries(facts, tag)
    .filter((e) => e.start == null && e.end != null && typeof e.val === "number")
    .sort((a, b) => Date.parse(a.end!) - Date.parse(b.end!));
  const last = usable[usable.length - 1];
  return last && typeof last.val === "number" ? last.val / USD_BILLION : null;
}

/** Latest annual *duration* value (income/cashflow facts: full-year span). */
function latestDurationB(facts: Record<string, Fact>, tag: string): number | null {
  const usable = entries(facts, tag)
    .filter(
      (e) =>
        e.start != null &&
        e.end != null &&
        typeof e.val === "number" &&
        daysBetween(e.start, e.end) > ANNUAL_MIN_DAYS,
    )
    .sort((a, b) => Date.parse(a.end!) - Date.parse(b.end!));
  const last = usable[usable.length - 1];
  return last && typeof last.val === "number" ? last.val / USD_BILLION : null;
}

/** Latest-period value across several duration tags (e.g. the two revenue
 *  tags). Picks by recency of period end, so a frozen legacy tag never wins. */
function latestDurationAcrossB(
  facts: Record<string, Fact>,
  tags: string[],
): number | null {
  let best: FactEntry | null = null;
  for (const tag of tags) {
    for (const e of entries(facts, tag)) {
      if (
        e.start != null &&
        e.end != null &&
        typeof e.val === "number" &&
        daysBetween(e.start, e.end) > ANNUAL_MIN_DAYS
      ) {
        if (best == null || Date.parse(e.end) > Date.parse(best.end!)) best = e;
      }
    }
  }
  return best && typeof best.val === "number" ? best.val / USD_BILLION : null;
}

/** Period end-date of the latest entry for a tag, for the `asOf` field. */
function latestEndDate(
  facts: Record<string, Fact>,
  tags: string[],
  fallback: string,
): string {
  let latest: string | null = null;
  for (const tag of tags) {
    for (const e of entries(facts, tag)) {
      if (e.end != null && (latest == null || Date.parse(e.end) > Date.parse(latest))) {
        latest = e.end;
      }
    }
  }
  return latest ?? fallback;
}

const REVENUE_TAGS = ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues"];

/**
 * Map a raw `companyfacts` response into the three canonical statement
 * payloads. Missing tags → `null` fields. Monetary values are normalized to
 * USD billions to match the statement schemas and fixtures.
 */
export function mapEdgarCompanyFacts(
  resp: EdgarCompanyFacts,
  ticker: string,
  date: string,
): {
  balanceSheet: ToolOutput<"get_balance_sheet">;
  incomeStatement: ToolOutput<"get_income_statement">;
  cashflow: ToolOutput<"get_cashflow">;
} {
  const g = resp.facts?.["us-gaap"] ?? {};

  // Total debt: prefer summing current + noncurrent long-term debt; fall back
  // to the combined LongTermDebt tag when a filer reports only that.
  const ltNoncurrent = latestInstantB(g, "LongTermDebtNoncurrent");
  const ltCurrent = latestInstantB(g, "LongTermDebtCurrent");
  let totalDebt: number | null;
  if (ltNoncurrent != null || ltCurrent != null) {
    totalDebt = (ltNoncurrent ?? 0) + (ltCurrent ?? 0);
  } else {
    totalDebt = latestInstantB(g, "LongTermDebt");
  }

  // FCF = operating − capex (EDGAR reports capex as a positive outflow).
  const operating = latestDurationB(g, "NetCashProvidedByUsedInOperatingActivities");
  const capex = latestDurationB(g, "PaymentsToAcquirePropertyPlantAndEquipment");
  const freeCashFlow =
    operating != null && capex != null ? operating - capex : null;

  return {
    incomeStatement: {
      source: "edgar",
      ticker,
      asOf: latestEndDate(g, REVENUE_TAGS, date),
      revenue: latestDurationAcrossB(g, REVENUE_TAGS),
      grossProfit: latestDurationB(g, "GrossProfit"),
      operatingIncome: latestDurationB(g, "OperatingIncomeLoss"),
      netIncome: latestDurationB(g, "NetIncomeLoss"),
      // EDGAR is point-in-time per filing; YoY would need two annual periods
      // selected consistently. Left null here — Yahoo supplies YoY when it
      // answers, and the desk treats a null growth field as unobserved.
      yoyRevenueGrowth: null,
      unit: "USD billions",
    },
    balanceSheet: {
      source: "edgar",
      ticker,
      asOf: latestEndDate(g, ["Assets"], date),
      totalAssets: latestInstantB(g, "Assets"),
      totalLiabilities: latestInstantB(g, "Liabilities"),
      totalEquity: latestInstantB(g, "StockholdersEquity"),
      cashAndEquivalents: latestInstantB(g, "CashAndCashEquivalentsAtCarryingValue"),
      totalDebt,
      unit: "USD billions",
    },
    cashflow: {
      source: "edgar",
      ticker,
      asOf: latestEndDate(g, ["NetCashProvidedByUsedInOperatingActivities"], date),
      operating,
      investing: latestDurationB(g, "NetCashProvidedByUsedInInvestingActivities"),
      financing: latestDurationB(g, "NetCashProvidedByUsedInFinancingActivities"),
      freeCashFlow,
      unit: "USD billions",
    },
  };
}

/** A fiscal year's value for one tag, in USD billions, with its period end. */
type FyValue = { end: string; valB: number };

/**
 * Collect annual facts for a set of tags, indexed by fiscal year (`fy`), in
 * USD billions. Annual = a full-year duration fact (income/cashflow) or a
 * fiscal-year-end instant fact (balance sheet), both marked `fp: "FY"`. When a
 * fiscal year appears under more than one tag/filing, the latest period end
 * wins (so a restated comparative never overwrites the as-filed value).
 */
function annualByFy(
  facts: Record<string, Fact>,
  tags: string[],
  kind: "instant" | "duration",
): Map<number, FyValue> {
  const byFy = new Map<number, FyValue>();
  for (const tag of tags) {
    for (const e of entries(facts, tag)) {
      if (typeof e.val !== "number" || e.end == null || e.fy == null) continue;
      const isAnnual =
        kind === "instant"
          ? e.start == null && e.fp === "FY"
          : e.start != null &&
            (e.fp === "FY" || daysBetween(e.start, e.end) > ANNUAL_MIN_DAYS);
      if (!isAnnual) continue;
      const prev = byFy.get(e.fy);
      if (prev == null || Date.parse(e.end) > Date.parse(prev.end)) {
        byFy.set(e.fy, { end: e.end, valB: e.val / USD_BILLION });
      }
    }
  }
  return byFy;
}

/** Cost-of-revenue tags, newest-tag-wins like revenue. */
const COGS_TAGS = ["CostOfGoodsAndServicesSold", "CostOfRevenue"];

/** Per-field tag selection for one XBRL taxonomy: which tag(s) to read and
 *  whether the fact is instant (balance sheet) or duration (income/cashflow). */
type FieldSpec = { tags: string[]; kind: "instant" | "duration" };
type StatementTagMap = Record<keyof Omit<FinancialPeriod, "endDate">, FieldSpec>;

/** US filers (`us-gaap`). */
const US_GAAP_HISTORY_TAGS: StatementTagMap = {
  totalAssets: { tags: ["Assets"], kind: "instant" },
  totalCurrentAssets: { tags: ["AssetsCurrent"], kind: "instant" },
  totalCurrentLiabilities: { tags: ["LiabilitiesCurrent"], kind: "instant" },
  totalLiabilities: { tags: ["Liabilities"], kind: "instant" },
  retainedEarnings: { tags: ["RetainedEarningsAccumulatedDeficit"], kind: "instant" },
  totalEquity: { tags: ["StockholdersEquity"], kind: "instant" },
  totalRevenue: { tags: REVENUE_TAGS, kind: "duration" },
  costOfRevenue: { tags: COGS_TAGS, kind: "duration" },
  grossProfit: { tags: ["GrossProfit"], kind: "duration" },
  operatingIncome: { tags: ["OperatingIncomeLoss"], kind: "duration" },
  netIncome: { tags: ["NetIncomeLoss"], kind: "duration" },
  cfo: { tags: ["NetCashProvidedByUsedInOperatingActivities"], kind: "duration" },
  capitalExpenditures: {
    tags: ["PaymentsToAcquirePropertyPlantAndEquipment"],
    kind: "duration",
  },
};

/** Foreign private issuers (20-F, `ifrs-full`). IFRS uses different tag names;
 *  operating income is `ProfitLossFromOperatingActivities` and net income is
 *  `ProfitLoss`. Values are read from the `USD` convenience-translation unit. */
const IFRS_HISTORY_TAGS: StatementTagMap = {
  totalAssets: { tags: ["Assets"], kind: "instant" },
  totalCurrentAssets: { tags: ["CurrentAssets"], kind: "instant" },
  totalCurrentLiabilities: { tags: ["CurrentLiabilities"], kind: "instant" },
  totalLiabilities: { tags: ["Liabilities"], kind: "instant" },
  retainedEarnings: { tags: ["RetainedEarnings"], kind: "instant" },
  totalEquity: { tags: ["Equity"], kind: "instant" },
  totalRevenue: { tags: ["Revenue"], kind: "duration" },
  costOfRevenue: { tags: ["CostOfSales"], kind: "duration" },
  grossProfit: { tags: ["GrossProfit"], kind: "duration" },
  operatingIncome: { tags: ["ProfitLossFromOperatingActivities"], kind: "duration" },
  netIncome: { tags: ["ProfitLoss"], kind: "duration" },
  cfo: { tags: ["CashFlowsFromUsedInOperatingActivities"], kind: "duration" },
  capitalExpenditures: {
    tags: ["PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities"],
    kind: "duration",
  },
};

/** Assemble annual `FinancialPeriod`s from one taxonomy's facts. */
function buildPeriods(
  facts: Record<string, Fact>,
  tagMap: StatementTagMap,
  maxPeriods: number,
): FinancialPeriod[] {
  const series = {
    totalAssets: annualByFy(facts, tagMap.totalAssets.tags, tagMap.totalAssets.kind),
    totalCurrentAssets: annualByFy(facts, tagMap.totalCurrentAssets.tags, tagMap.totalCurrentAssets.kind),
    totalCurrentLiabilities: annualByFy(facts, tagMap.totalCurrentLiabilities.tags, tagMap.totalCurrentLiabilities.kind),
    totalLiabilities: annualByFy(facts, tagMap.totalLiabilities.tags, tagMap.totalLiabilities.kind),
    retainedEarnings: annualByFy(facts, tagMap.retainedEarnings.tags, tagMap.retainedEarnings.kind),
    totalEquity: annualByFy(facts, tagMap.totalEquity.tags, tagMap.totalEquity.kind),
    totalRevenue: annualByFy(facts, tagMap.totalRevenue.tags, tagMap.totalRevenue.kind),
    costOfRevenue: annualByFy(facts, tagMap.costOfRevenue.tags, tagMap.costOfRevenue.kind),
    grossProfit: annualByFy(facts, tagMap.grossProfit.tags, tagMap.grossProfit.kind),
    operatingIncome: annualByFy(facts, tagMap.operatingIncome.tags, tagMap.operatingIncome.kind),
    netIncome: annualByFy(facts, tagMap.netIncome.tags, tagMap.netIncome.kind),
    cfo: annualByFy(facts, tagMap.cfo.tags, tagMap.cfo.kind),
    capitalExpenditures: annualByFy(facts, tagMap.capitalExpenditures.tags, tagMap.capitalExpenditures.kind),
  };

  // Fiscal years present in any core series, newest first.
  const fySet = new Set<number>();
  for (const fy of series.totalAssets.keys()) fySet.add(fy);
  for (const fy of series.totalRevenue.keys()) fySet.add(fy);
  for (const fy of series.netIncome.keys()) fySet.add(fy);
  const fys = [...fySet].sort((a, b) => b - a).slice(0, maxPeriods);

  const valB = (m: Map<number, FyValue>, fy: number): number | null =>
    m.get(fy)?.valB ?? null;

  return fys.map((fy) => ({
    endDate:
      series.totalAssets.get(fy)?.end ??
      series.totalRevenue.get(fy)?.end ??
      series.netIncome.get(fy)?.end ??
      "",
    totalAssets: valB(series.totalAssets, fy),
    totalCurrentAssets: valB(series.totalCurrentAssets, fy),
    totalCurrentLiabilities: valB(series.totalCurrentLiabilities, fy),
    totalLiabilities: valB(series.totalLiabilities, fy),
    retainedEarnings: valB(series.retainedEarnings, fy),
    totalEquity: valB(series.totalEquity, fy),
    totalRevenue: valB(series.totalRevenue, fy),
    costOfRevenue: valB(series.costOfRevenue, fy),
    grossProfit: valB(series.grossProfit, fy),
    operatingIncome: valB(series.operatingIncome, fy),
    netIncome: valB(series.netIncome, fy),
    cfo: valB(series.cfo, fy),
    capitalExpenditures: valB(series.capitalExpenditures, fy),
  }));
}

/**
 * Map a raw `companyfacts` response into up to `maxPeriods` annual
 * `FinancialPeriod`s, newest first, for the composite scores. Unlike the
 * single-period statement mapper this surfaces working-capital and
 * retained-earnings inputs (Altman X1/X2) and keeps the prior period Piotroski
 * needs for its change-based criteria. Tries `us-gaap` first, then `ifrs-full`
 * (foreign private issuers / 20-F filers like TSM), reading the USD unit in
 * both. A tag a filer never reported is `null`, never 0. Returns `[]` when no
 * annual facts are present in either taxonomy so the caller falls through to
 * Yahoo. (An IFRS filer that reports no USD convenience translation also
 * returns `[]` — currency conversion is out of scope.)
 */
export function mapEdgarFinancialsHistory(
  resp: EdgarCompanyFacts,
  maxPeriods = 4,
): FinancialPeriod[] {
  const usGaap = buildPeriods(resp.facts?.["us-gaap"] ?? {}, US_GAAP_HISTORY_TAGS, maxPeriods);
  if (usGaap.length > 0) return usGaap;
  return buildPeriods(resp.facts?.["ifrs-full"] ?? {}, IFRS_HISTORY_TAGS, maxPeriods);
}
