/**
 * Yahoo Finance helpers via `yahoo-finance2` v3. Each function returns a
 * payload normalized to the canonical tool output schema. The Yahoo client
 * is loaded dynamically so `pnpm install` can complete in environments that
 * prune the optional dep, and instantiated once per process.
 *
 * Tools using these helpers: get_fundamentals, get_price_history,
 * get_balance_sheet, get_income_statement, get_cashflow.
 */
import type { ToolInput, ToolOutput } from "../phase-1/tools/schemas";

type YahooClient = {
  chart: (
    ticker: string,
    opts: { period1: Date; period2: Date; interval: string },
  ) => Promise<{ quotes?: Array<Record<string, unknown>> }>;
  quoteSummary: (
    ticker: string,
    opts: { modules: string[] },
  ) => Promise<Record<string, unknown | undefined>>;
};

// Two layers of caching:
//   - `cachedClient` holds the fully-constructed instance for subsequent calls.
//   - `clientPromise` holds the in-flight construction so concurrent first
//     callers share one `await import()` + `new` cycle.
let cachedClient: YahooClient | null = null;
let clientPromise: Promise<YahooClient> | null = null;
async function getYahoo(): Promise<YahooClient> {
  if (cachedClient !== null) return cachedClient;
  if (clientPromise !== null) return clientPromise;
  clientPromise = (async () => {
    const mod = (await import("yahoo-finance2")) as unknown as {
      default: new () => YahooClient;
    };
    cachedClient = new mod.default();
    return cachedClient;
  })();
  return clientPromise;
}

/** Map canonical range strings to a calendar-day lookback window. */
function rangeToLookbackDays(range: string | undefined): number {
  switch (range) {
    case "1mo": return 45;
    case "3mo": return 100;
    case "6mo": return 200;
    case "1y": return 380;
    case "2y": return 750;
    default: return 45;
  }
}

export async function fetchYahooChart(
  input: ToolInput<"get_price_history">,
): Promise<ToolOutput<"get_price_history">> {
  const yahoo = await getYahoo();
  const period2 = new Date(input.date);
  const period1 = new Date(period2);
  period1.setUTCDate(period1.getUTCDate() - rangeToLookbackDays(input.range));
  const result = await yahoo.chart(input.ticker, {
    period1,
    period2,
    interval: "1d",
  });
  const bars = (result.quotes ?? [])
    .filter((q) => q.open != null && q.close != null)
    .map((q) => ({
      date: (q.date instanceof Date ? q.date : new Date(q.date as string))
        .toISOString()
        .slice(0, 10),
      open: Number(q.open ?? 0),
      high: Number(q.high ?? 0),
      low: Number(q.low ?? 0),
      close: Number(q.close ?? 0),
      volume: Number(q.volume ?? 0),
    }));
  return {
    source: "yahoo",
    ticker: input.ticker,
    range: input.range ?? "1mo",
    bars,
  };
}

export async function fetchYahooFundamentals(
  input: ToolInput<"get_fundamentals">,
): Promise<ToolOutput<"get_fundamentals">> {
  const yahoo = await getYahoo();
  const summary = (await yahoo.quoteSummary(input.ticker, {
    modules: ["summaryDetail", "financialData", "defaultKeyStatistics"],
  })) as Record<string, Record<string, unknown> | undefined>;
  const detail = summary.summaryDetail ?? {};
  const fin = summary.financialData ?? {};
  const stats = summary.defaultKeyStatistics ?? {};
  return {
    source: "yahoo",
    ticker: input.ticker,
    asOf: input.date,
    marketCap: numberFrom(detail.marketCap),
    forwardPE:
      nullableNumberFrom(stats.forwardPE) ?? nullableNumberFrom(detail.forwardPE),
    trailingPE: nullableNumberFrom(detail.trailingPE),
    priceToSales: numberFrom(detail.priceToSalesTrailing12Months),
    returnOnEquity: numberFrom(fin.returnOnEquity),
    operatingMargin: numberFrom(fin.operatingMargins),
    grossMargin: numberFrom(fin.grossMargins),
  };
}

export async function fetchYahooBalanceSheet(
  input: ToolInput<"get_balance_sheet">,
): Promise<ToolOutput<"get_balance_sheet">> {
  const yahoo = await getYahoo();
  const summary = (await yahoo.quoteSummary(input.ticker, {
    modules: ["balanceSheetHistory"],
  })) as { balanceSheetHistory?: { balanceSheetStatements?: Array<Record<string, unknown>> } };
  const stmt = summary.balanceSheetHistory?.balanceSheetStatements?.[0] ?? {};
  // Yahoo returns absolute dollars; schema is "USD billions".
  const toB = (raw: unknown) => numberFrom(raw) / 1e9;
  const totalAssets = toB(stmt.totalAssets);
  const totalLiabilities = toB(stmt.totalLiab);
  return {
    source: "yahoo",
    ticker: input.ticker,
    asOf: asOfFromStatement(stmt) ?? input.date,
    totalAssets,
    totalLiabilities,
    totalEquity: toB(stmt.totalStockholderEquity) || totalAssets - totalLiabilities,
    cashAndEquivalents: toB(stmt.cash),
    totalDebt: toB(stmt.shortLongTermDebt) + toB(stmt.longTermDebt),
    unit: "USD billions",
  };
}

export async function fetchYahooIncomeStatement(
  input: ToolInput<"get_income_statement">,
): Promise<ToolOutput<"get_income_statement">> {
  const yahoo = await getYahoo();
  const summary = (await yahoo.quoteSummary(input.ticker, {
    modules: ["incomeStatementHistory"],
  })) as {
    incomeStatementHistory?: { incomeStatementHistory?: Array<Record<string, unknown>> };
  };
  const history = summary.incomeStatementHistory?.incomeStatementHistory ?? [];
  const latest = history[0] ?? {};
  const prior = history[1] ?? {};
  const toB = (raw: unknown) => numberFrom(raw) / 1e9;
  const latestRev = numberFrom(latest.totalRevenue);
  const priorRev = numberFrom(prior.totalRevenue);
  const yoy = priorRev > 0 ? (latestRev - priorRev) / priorRev : 0;
  return {
    source: "yahoo",
    ticker: input.ticker,
    asOf: asOfFromStatement(latest) ?? input.date,
    revenue: toB(latest.totalRevenue),
    grossProfit: toB(latest.grossProfit),
    operatingIncome: toB(latest.operatingIncome),
    netIncome: toB(latest.netIncome),
    yoyRevenueGrowth: yoy,
    unit: "USD billions",
  };
}

export async function fetchYahooCashflow(
  input: ToolInput<"get_cashflow">,
): Promise<ToolOutput<"get_cashflow">> {
  const yahoo = await getYahoo();
  const summary = (await yahoo.quoteSummary(input.ticker, {
    modules: ["cashflowStatementHistory"],
  })) as {
    cashflowStatementHistory?: { cashflowStatements?: Array<Record<string, unknown>> };
  };
  const stmt = summary.cashflowStatementHistory?.cashflowStatements?.[0] ?? {};
  const toB = (raw: unknown) => numberFrom(raw) / 1e9;
  const operating = toB(stmt.totalCashFromOperatingActivities);
  // Yahoo reports capex as a negative number; FCF = operating + capex.
  const capex = toB(stmt.capitalExpenditures);
  return {
    source: "yahoo",
    ticker: input.ticker,
    asOf: asOfFromStatement(stmt) ?? input.date,
    operating,
    investing: toB(stmt.totalCashflowsFromInvestingActivities),
    financing: toB(stmt.totalCashFromFinancingActivities),
    freeCashFlow: operating + capex,
    unit: "USD billions",
  };
}

/**
 * Business-identity profile from Yahoo `quoteSummary` with the
 * `assetProfile` and `summaryDetail` modules. Yahoo is the preferred
 * source for `sector` and `businessDescription` (Finnhub provides
 * neither). Throws on any failure so the tool handler can fall through
 * to `emptyPayload`.
 */
export async function fetchYahooCompanyProfile(
  input: ToolInput<"get_company_profile">,
): Promise<ToolOutput<"get_company_profile">> {
  const yahoo = await getYahoo();
  // `assetProfile` carries sector/industry/business-description; `summaryDetail`
  // carries marketCap/currency; `quoteType` is the canonical home for the
  // company's display name and exchange — `assetProfile` does not include
  // `longName`/`shortName`, so the name has to come from `quoteType`.
  const summary = (await yahoo.quoteSummary(input.ticker, {
    modules: ["assetProfile", "summaryDetail", "quoteType"],
  })) as Record<string, Record<string, unknown> | undefined>;
  const profile = summary.assetProfile ?? {};
  const detail = summary.summaryDetail ?? {};
  const qt = summary.quoteType ?? {};
  const name = stringFrom(qt.longName) ?? stringFrom(qt.shortName);
  if (name === null) {
    throw new Error(`Yahoo quoteSummary returned no profile for ${input.ticker}`);
  }
  const marketCap = numberFrom(detail.marketCap);
  const employees = numberFrom(profile.fullTimeEmployees);
  return {
    source: "yahoo",
    ticker: input.ticker,
    asOf: input.date,
    name,
    sector: stringFrom(profile.sector),
    industry: stringFrom(profile.industry),
    country: stringFrom(profile.country),
    exchange: stringFrom(qt.exchange),
    currency: stringFrom(detail.currency),
    businessDescription: stringFrom(profile.longBusinessSummary),
    marketCapUsd: marketCap > 0 ? marketCap : null,
    employees: employees > 0 ? employees : null,
    ipoDate: null,
    website: stringFrom(profile.website),
    websiteMetaDescription: null,
    searchSnippets: null,
  };
}

function stringFrom(raw: unknown): string | null {
  if (typeof raw === "string") return raw.length > 0 ? raw : null;
  return null;
}

/** Yahoo nests numeric values under `{ raw }` for some modules; unwrap both shapes. */
function numberFrom(raw: unknown): number {
  if (raw == null) return 0;
  if (typeof raw === "number") return raw;
  if (typeof raw === "object" && "raw" in raw) {
    const v = (raw as { raw?: unknown }).raw;
    return typeof v === "number" ? v : 0;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

/** Nullable variant of `numberFrom` for P/E fields: a zero or missing P/E is
 *  non-physical for a going concern, so it maps to `null` rather than `0`.
 *  Don't generalize to ROE/margins — there `0` is a real value (FIX-692). */
function nullableNumberFrom(raw: unknown): number | null {
  const n = numberFrom(raw);
  return Number.isFinite(n) && n !== 0 ? n : null;
}

/** Statement period end-date — Yahoo emits a Date or `{ raw: epochSeconds }`. */
function asOfFromStatement(stmt: Record<string, unknown>): string | null {
  const end = stmt.endDate;
  if (end instanceof Date) return end.toISOString().slice(0, 10);
  if (typeof end === "object" && end !== null && "raw" in end) {
    const raw = (end as { raw?: unknown }).raw;
    if (typeof raw === "number") return new Date(raw * 1000).toISOString().slice(0, 10);
  }
  if (typeof end === "string") return end.slice(0, 10);
  return null;
}
