/**
 * `YahooDataSource` — live data via `yahoo-finance2` v3.
 *
 * Implements prices + fundamentals. `yahoo-finance2` is loaded dynamically so
 * `pnpm install` can complete in environments that prune optional deps; if the
 * provider is never picked, the import never resolves.
 *
 * Unsupported tools throw `ProviderUnsupportedError` so `MultiSourceDataSource`
 * can fall through to the next provider (typically the fixture source) without
 * treating "not implemented" as a request-level error.
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
  ) => Promise<Record<string, Record<string, unknown> | undefined>>;
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

export class YahooDataSource implements DataSource {
  readonly mode = "live" as const;
  readonly provider = "yahoo" as const;

  async get_price_history(
    input: ToolInput<"get_price_history">,
  ): Promise<ToolOutput<"get_price_history">> {
    const yahoo = await getYahoo();
    const period2 = new Date(input.date);
    const period1 = new Date(period2);
    // Pull ~45 calendar days so we end up with ~30 trading bars after weekends.
    period1.setUTCDate(period1.getUTCDate() - 45);
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
    const summary = await yahoo.quoteSummary(input.ticker, {
      modules: ["summaryDetail", "financialData", "defaultKeyStatistics"],
    });
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

  // The remaining tools are provider-unsupported. `MultiSourceDataSource`
  // catches these and tries the next provider in the chain.
  async get_balance_sheet(
    _input: ToolInput<"get_balance_sheet">,
  ): Promise<ToolOutput<"get_balance_sheet">> {
    throw new ProviderUnsupportedError("yahoo", "get_balance_sheet");
  }
  async get_income_statement(
    _input: ToolInput<"get_income_statement">,
  ): Promise<ToolOutput<"get_income_statement">> {
    throw new ProviderUnsupportedError("yahoo", "get_income_statement");
  }
  async get_cashflow(
    _input: ToolInput<"get_cashflow">,
  ): Promise<ToolOutput<"get_cashflow">> {
    throw new ProviderUnsupportedError("yahoo", "get_cashflow");
  }
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
