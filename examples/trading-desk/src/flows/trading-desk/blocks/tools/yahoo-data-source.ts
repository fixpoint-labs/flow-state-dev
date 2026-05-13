/**
 * `YahooDataSource` — live data via `yahoo-finance2` v3.
 *
 * Implements prices, fundamentals, and the three financial statements (balance
 * sheet, income statement, cash flow). `yahoo-finance2` is loaded dynamically
 * so `pnpm install` can complete in environments that prune optional deps;
 * if the provider is never picked, the import never resolves.
 *
 * Unsupported tools throw `ProviderUnsupportedError` so `MultiSourceDataSource`
 * can fall through to the next provider without treating "not implemented" as
 * a request-level error.
 */
import {
  type DataSource,
  type ToolInput,
  type ToolOutput,
} from "./data-source";

export class ProviderUnsupportedError extends Error {
  constructor(provider: string, tool: string) {
    super(`Provider ${provider} does not implement ${tool}`);
    this.name = "ProviderUnsupportedError";
  }
}

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

let cachedClient: YahooClient | null = null;
async function getYahoo(): Promise<YahooClient> {
  if (cachedClient !== null) return cachedClient;
  const mod = (await import("yahoo-finance2")) as unknown as {
    default: new () => YahooClient;
  };
  const Ctor = mod.default;
  cachedClient = new Ctor();
  return cachedClient;
}

/**
 * Map the canonical range strings used by `get_price_history` to a lookback
 * window expressed in calendar days. Yahoo's `chart` endpoint accepts a
 * `period1`/`period2` pair; we resolve `period1` by subtracting these days
 * from the requested as-of date. Adds 10% slack to compensate for weekends.
 */
function rangeToLookbackDays(range: string | undefined): number {
  switch (range) {
    case "1mo":
      return 45;
    case "3mo":
      return 100;
    case "6mo":
      return 200;
    case "1y":
      return 380;
    case "2y":
      return 750;
    default:
      return 45;
  }
}

export class YahooDataSource implements DataSource {
  readonly mode = "live" as const;
  readonly provider = "yahoo" as const;

  async get_price_history(
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

  async get_fundamentals(
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
      forwardPE: numberFrom(stats.forwardPE) || numberFrom(detail.forwardPE),
      priceToSales: numberFrom(detail.priceToSalesTrailing12Months),
      returnOnEquity: numberFrom(fin.returnOnEquity),
      operatingMargin: numberFrom(fin.operatingMargins),
      grossMargin: numberFrom(fin.grossMargins),
    };
  }

  async get_balance_sheet(
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
      totalDebt:
        toB(stmt.shortLongTermDebt) + toB(stmt.longTermDebt),
      unit: "USD billions",
    };
  }

  async get_income_statement(
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

  async get_cashflow(
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

  // Indicators are derived from price bars, not fetched. The compute_indicators
  // handler resolves them locally in live mode; this provider doesn't implement
  // them so a misrouted call falls through to "unavailable" instead of silently
  // returning zeros from a phantom upstream.
  async compute_indicators(
    _input: ToolInput<"compute_indicators">,
  ): Promise<ToolOutput<"compute_indicators">> {
    throw new ProviderUnsupportedError("yahoo", "compute_indicators");
  }
  async search_news(
    _input: ToolInput<"search_news">,
  ): Promise<ToolOutput<"search_news">> {
    throw new ProviderUnsupportedError("yahoo", "search_news");
  }
  async get_macro_indicators(
    _input: ToolInput<"get_macro_indicators">,
  ): Promise<ToolOutput<"get_macro_indicators">> {
    throw new ProviderUnsupportedError("yahoo", "get_macro_indicators");
  }
  async get_social_sentiment(
    _input: ToolInput<"get_social_sentiment">,
  ): Promise<ToolOutput<"get_social_sentiment">> {
    throw new ProviderUnsupportedError("yahoo", "get_social_sentiment");
  }
  async get_reddit_mentions(
    _input: ToolInput<"get_reddit_mentions">,
  ): Promise<ToolOutput<"get_reddit_mentions">> {
    throw new ProviderUnsupportedError("yahoo", "get_reddit_mentions");
  }
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

/** Statement period end-date — Yahoo emits a Date or a `{ raw: epochSeconds }` shape. */
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
