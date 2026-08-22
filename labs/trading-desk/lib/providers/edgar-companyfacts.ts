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
 * PERIOD SELECTION IS NOT THIS MODULE'S (FIX-1113). Every figure is read at the
 * ONE anchor chosen by `financial-period.ts`; a figure the anchor does not carry
 * is absent. The fiscal-year (`fy`) index this module used to build is GONE and
 * must not come back: `fy` records the year of the FILING, not the year the
 * number describes, so last year's comparatives republished inside this year's
 * annual report carry this year's label. In this repository's own Apple
 * fixture that collides the period ending 2024-09-28 into fy 2025 across
 * fifteen of sixteen line items, and collapses three years of `Revenues` into
 * the single label 2018 — discarding two of them.
 *
 * Selection rules learned from real filings:
 *  - Balance-sheet facts are *instant* (end-date only); income/cashflow facts
 *    are *duration* (start+end). The annual test differs accordingly.
 *  - Total debt has no single tag: sum LongTermDebtNoncurrent + ...Current,
 *    falling back to the combined LongTermDebt tag.
 *  - Revenue lives under `Revenues` (older filings) or
 *    `RevenueFromContractWithCustomerExcludingAssessedTax` (newer). Both are
 *    read at the anchor, newest-filed wins — a filer that switched tags leaves
 *    the old one frozen, and reading AT a period means the frozen one simply
 *    has nothing at the anchor.
 *  - EDGAR reports capex (`PaymentsToAcquirePropertyPlantAndEquipment`) as a
 *    positive outflow, so FCF = operating − capex.
 *  - A tag the filer never reported is absent → `null`, never 0.
 */
import type { FinancialPeriod } from "./financials-history";
import {
  ANNUAL_MIN_DAYS,
  chooseAnchorPeriodEnd,
  samePeriod,
} from "./financial-period";

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

function daysBetween(start: string, end: string): number {
  return (Date.parse(end) - Date.parse(start)) / 86_400_000;
}

/** All USD entries for a tag, or `[]` if the tag/unit is absent. */
function entries(facts: Record<string, Fact>, tag: string): FactEntry[] {
  return facts[tag]?.units?.USD ?? [];
}

/**
 * Whether a fact entry is an ANNUAL observation of the shape this field takes.
 *
 * Duration (flow) facts must span a full year, so a quarter of revenue can
 * never be read as the year's.
 *
 * Instant (balance) facts carry no `start`, and a snapshot shape alone is NOT
 * enough: a quarterly balance sheet is also an instant. The old selector tested
 * only for the snapshot shape and never for annual, which is why the desk paired
 * a full year of profit with whatever quarter was filed most recently. An
 * explicitly sub-annual period (`fp: "Q1".."Q4"`) is rejected here; an entry
 * with no `fp` at all is kept, so this narrows the defect without narrowing
 * coverage on filers that leave the field off.
 */
function isAnnual(e: FactEntry, kind: "instant" | "duration"): boolean {
  if (e.end == null || typeof e.val !== "number") return false;
  if (kind === "duration") {
    return e.start != null && daysBetween(e.start, e.end) > ANNUAL_MIN_DAYS;
  }
  return e.start == null && (e.fp == null || e.fp === "FY");
}

/** Every annual period end this tag set reports. The candidate pool the anchor
 *  is chosen from — wide by design: a period carried by one figure is real. */
function annualEndsFor(
  facts: Record<string, Fact>,
  tags: string[],
  kind: "instant" | "duration",
): string[] {
  const ends: string[] = [];
  for (const tag of tags) {
    for (const e of entries(facts, tag)) {
      if (isAnnual(e, kind)) ends.push(e.end!);
    }
  }
  return ends;
}

/**
 * The $B value this tag set reports AT `periodEnd`, else `null`.
 *
 * This is the whole fix in one function: the value is read AT a period, never
 * "the most recent value". When several entries cover the same period (an
 * as-filed figure and a later restatement) the one from the NEWEST FILING wins
 * — a period-preserving choice, not a period-selecting one.
 */
function valueAtB(
  facts: Record<string, Fact>,
  tags: string[],
  kind: "instant" | "duration",
  periodEnd: string | null,
): number | null {
  if (!periodEnd) return null;
  let best: FactEntry | null = null;
  for (const tag of tags) {
    for (const e of entries(facts, tag)) {
      if (!isAnnual(e, kind)) continue;
      if (!samePeriod(e.end!, periodEnd)) continue;
      // Newest filing wins for the same period: prefer a higher `fy` (the
      // filing year), falling back to the later period end within tolerance.
      if (
        best == null ||
        (e.fy ?? 0) > (best.fy ?? 0) ||
        ((e.fy ?? 0) === (best.fy ?? 0) && Date.parse(e.end!) > Date.parse(best.end!))
      ) {
        best = e;
      }
    }
  }
  return best && typeof best.val === "number" ? best.val / USD_BILLION : null;
}

const REVENUE_TAGS = ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues"];
/** Cost-of-revenue tags, same newest-filing-wins rule as revenue. */
const COGS_TAGS = ["CostOfGoodsAndServicesSold", "CostOfRevenue"];

/** The us-gaap tags this provider anchors on — this mapper's own instance of the
 *  ANCHOR-discovery rule (`financial-period.ts`'s module header). Deliberately NOT
 *  the recovery ladder's completeness test — see that module. */
const US_GAAP_ANCHOR_TAGS: Array<{ tags: string[]; kind: "instant" | "duration" }> = [
  { tags: REVENUE_TAGS, kind: "duration" },
  { tags: ["OperatingIncomeLoss"], kind: "duration" },
  { tags: ["NetIncomeLoss"], kind: "duration" },
  { tags: ["NetCashProvidedByUsedInOperatingActivities"], kind: "duration" },
  { tags: ["Assets"], kind: "instant" },
  { tags: ["StockholdersEquity"], kind: "instant" },
  { tags: ["CashAndCashEquivalentsAtCarryingValue"], kind: "instant" },
  { tags: ["LongTermDebtNoncurrent", "LongTermDebtCurrent", "LongTermDebt"], kind: "instant" },
];

/** Every annual period end any core figure reports, across all three
 *  statements. Built ONCE per response and used for both the single-period
 *  statements and the multi-period rows — deriving it twice is how per-tag
 *  sorting comes back under a new name. */
function anchorCandidates(
  facts: Record<string, Fact>,
  anchorTags: Array<{ tags: string[]; kind: "instant" | "duration" }>,
): string[] {
  const ends: string[] = [];
  for (const spec of anchorTags) ends.push(...annualEndsFor(facts, spec.tags, spec.kind));
  return ends;
}

/**
 * Map a raw `companyfacts` response into the three canonical statement
 * payloads, every figure read at ONE anchor period end. A figure the anchor
 * does not carry is `null`; one absent figure never blanks its statement.
 * Monetary values are normalized to USD billions to match the statement
 * schemas and fixtures.
 *
 * `date` (the requested analysis date) is retained only as the legacy `asOf`
 * fallback for a response with no annual period at all. `periodEnd` is NEVER
 * given that fallback — an empty period is the honest answer there.
 */
export function mapEdgarCompanyFacts(
  resp: EdgarCompanyFacts,
  ticker: string,
  date: string,
) {
  const g = resp.facts?.["us-gaap"] ?? {};
  const anchor = chooseAnchorPeriodEnd(anchorCandidates(g, US_GAAP_ANCHOR_TAGS));

  const at = (tags: string[], kind: "instant" | "duration") =>
    valueAtB(g, tags, kind, anchor);

  // Total debt: prefer summing current + noncurrent long-term debt AT the
  // anchor; fall back to the combined LongTermDebt tag when a filer reports
  // only that. Both legs read at the same period, so the sum cannot mix years.
  const ltNoncurrent = at(["LongTermDebtNoncurrent"], "instant");
  const ltCurrent = at(["LongTermDebtCurrent"], "instant");
  let totalDebt: number | null;
  if (ltNoncurrent != null || ltCurrent != null) {
    totalDebt = (ltNoncurrent ?? 0) + (ltCurrent ?? 0);
  } else {
    totalDebt = at(["LongTermDebt"], "instant");
  }

  // FCF = operating − capex (EDGAR reports capex as a positive outflow).
  const operating = at(["NetCashProvidedByUsedInOperatingActivities"], "duration");
  const capex = at(["PaymentsToAcquirePropertyPlantAndEquipment"], "duration");
  const freeCashFlow = operating != null && capex != null ? operating - capex : null;

  const asOf = anchor ?? date;

  return {
    incomeStatement: {
      source: "edgar" as const,
      ticker,
      asOf,
      periodEnd: anchor,
      revenue: at(REVENUE_TAGS, "duration"),
      grossProfit: at(["GrossProfit"], "duration"),
      operatingIncome: at(["OperatingIncomeLoss"], "duration"),
      netIncome: at(["NetIncomeLoss"], "duration"),
      // EDGAR's YoY comes from the multi-period path, which pairs periods
      // through `consecutivePeriodPair`. Left null here — Yahoo supplies YoY
      // when it answers, and the desk treats a null growth field as unobserved.
      yoyRevenueGrowth: null,
      unit: "USD billions",
    },
    balanceSheet: {
      source: "edgar" as const,
      ticker,
      asOf,
      periodEnd: anchor,
      totalAssets: at(["Assets"], "instant"),
      totalLiabilities: at(["Liabilities"], "instant"),
      totalEquity: at(["StockholdersEquity"], "instant"),
      cashAndEquivalents: at(["CashAndCashEquivalentsAtCarryingValue"], "instant"),
      totalDebt,
      unit: "USD billions",
    },
    cashflow: {
      source: "edgar" as const,
      ticker,
      asOf,
      periodEnd: anchor,
      operating,
      investing: at(["NetCashProvidedByUsedInInvestingActivities"], "duration"),
      financing: at(["NetCashProvidedByUsedInFinancingActivities"], "duration"),
      freeCashFlow,
      unit: "USD billions",
    },
  };
}

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

/** The IFRS tags behind the anchor-discovery fields. */
const IFRS_ANCHOR_TAGS: Array<{ tags: string[]; kind: "instant" | "duration" }> = [
  { tags: ["Revenue"], kind: "duration" },
  { tags: ["ProfitLossFromOperatingActivities"], kind: "duration" },
  { tags: ["ProfitLoss"], kind: "duration" },
  { tags: ["CashFlowsFromUsedInOperatingActivities"], kind: "duration" },
  { tags: ["Assets"], kind: "instant" },
  { tags: ["Equity"], kind: "instant" },
];

/** Assemble annual `FinancialPeriod`s from one taxonomy's facts, keyed on the
 *  PERIOD END — the same index the single-period statements use. */
function buildPeriods(
  facts: Record<string, Fact>,
  tagMap: StatementTagMap,
  anchorTags: Array<{ tags: string[]; kind: "instant" | "duration" }>,
  maxPeriods: number,
): FinancialPeriod[] {
  // Distinct annual period ends any core figure reports, newest first. Built
  // from the SAME candidate pool the anchor comes from, so the two paths cannot
  // disagree about which periods exist.
  const ends = [...new Set(anchorCandidates(facts, anchorTags))]
    .filter((e) => !Number.isNaN(Date.parse(e)))
    .sort((a, b) => Date.parse(b) - Date.parse(a));

  // Collapse ends that describe the same period (a provider reporting the same
  // fiscal year days apart) so one period never yields two rows.
  const periodEnds: string[] = [];
  for (const e of ends) {
    if (!periodEnds.some((kept) => samePeriod(kept, e))) periodEnds.push(e);
  }

  return periodEnds.slice(0, maxPeriods).map((end) => {
    const at = (spec: FieldSpec) => valueAtB(facts, spec.tags, spec.kind, end);
    return {
      endDate: end,
      totalAssets: at(tagMap.totalAssets),
      totalCurrentAssets: at(tagMap.totalCurrentAssets),
      totalCurrentLiabilities: at(tagMap.totalCurrentLiabilities),
      totalLiabilities: at(tagMap.totalLiabilities),
      retainedEarnings: at(tagMap.retainedEarnings),
      totalEquity: at(tagMap.totalEquity),
      totalRevenue: at(tagMap.totalRevenue),
      costOfRevenue: at(tagMap.costOfRevenue),
      grossProfit: at(tagMap.grossProfit),
      operatingIncome: at(tagMap.operatingIncome),
      netIncome: at(tagMap.netIncome),
      cfo: at(tagMap.cfo),
      capitalExpenditures: at(tagMap.capitalExpenditures),
    };
  });
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
 *
 * Rows are keyed on the period END, so a fiscal-year label that covers two
 * different period ends can no longer collapse them into one row.
 */
export function mapEdgarFinancialsHistory(
  resp: EdgarCompanyFacts,
  maxPeriods = 4,
): FinancialPeriod[] {
  const usGaap = buildPeriods(
    resp.facts?.["us-gaap"] ?? {},
    US_GAAP_HISTORY_TAGS,
    US_GAAP_ANCHOR_TAGS,
    maxPeriods,
  );
  if (usGaap.length > 0) return usGaap;
  return buildPeriods(
    resp.facts?.["ifrs-full"] ?? {},
    IFRS_HISTORY_TAGS,
    IFRS_ANCHOR_TAGS,
    maxPeriods,
  );
}
