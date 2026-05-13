/**
 * `FinnhubDataSource` — live data via the Finnhub REST API.
 *
 * Activated when `FINNHUB_API_KEY` is set. Implements the tools available on
 * Finnhub's free tier: prices (`/stock/candle`), fundamentals (`/stock/metric`
 * + `/stock/profile2`), and news (`/company-news`). All outputs are normalized
 * to the canonical schemas defined in `data-source.ts` so analysts get
 * identical-shape data regardless of provider.
 *
 * Tools not covered by the free tier (statements, indicators, macro, sentiment)
 * throw `ProviderUnsupportedError` so `MultiSourceDataSource` falls through to
 * the next provider.
 */
import {
  type DataSource,
  type ToolInput,
  type ToolOutput,
} from "./data-source";
import { ProviderUnsupportedError } from "./yahoo-data-source";

const FINNHUB_BASE = "https://finnhub.io/api/v1";

export function getFinnhubKey(): string | undefined {
  const key = process.env.FINNHUB_API_KEY?.trim();
  return key && key.length > 0 ? key : undefined;
}

export class FinnhubDataSource implements DataSource {
  readonly mode = "live" as const;
  readonly provider = "finnhub" as const;
  readonly #key: string;

  constructor(key: string) {
    this.#key = key;
  }

  async #get<T>(path: string, params: Record<string, string | number>): Promise<T> {
    const url = new URL(`${FINNHUB_BASE}${path}`);
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, String(v));
    }
    url.searchParams.set("token", this.#key);
    const res = await fetch(url);
    if (!res.ok) {
      // Read body as text first so a plain-text "Too Many Requests" doesn't
      // explode in JSON.parse the way `yahoo-finance2` does. Caller gets a
      // structured Error that the multi-source chain can fall through on.
      const body = await res.text().catch(() => "");
      throw new Error(`Finnhub ${path} failed: HTTP ${res.status} ${body.slice(0, 120)}`);
    }
    return (await res.json()) as T;
  }

  async get_price_history(
    input: ToolInput<"get_price_history">,
  ): Promise<ToolOutput<"get_price_history">> {
    const to = Math.floor(new Date(input.date).getTime() / 1000);
    const from = to - 45 * 24 * 60 * 60;
    type Candle = {
      s: "ok" | "no_data" | string;
      t?: number[];
      o?: number[];
      h?: number[];
      l?: number[];
      c?: number[];
      v?: number[];
    };
    const data = await this.#get<Candle>("/stock/candle", {
      symbol: input.ticker,
      resolution: "D",
      from,
      to,
    });
    if (data.s !== "ok" || !data.t) {
      throw new ProviderUnsupportedError("finnhub", "get_price_history");
    }
    const bars = data.t.map((ts, i) => ({
      date: new Date(ts * 1000).toISOString().slice(0, 10),
      open: data.o?.[i] ?? 0,
      high: data.h?.[i] ?? 0,
      low: data.l?.[i] ?? 0,
      close: data.c?.[i] ?? 0,
      volume: data.v?.[i] ?? 0,
    }));
    return {
      source: "finnhub",
      ticker: input.ticker,
      range: input.range ?? "1mo",
      bars,
    };
  }

  async get_fundamentals(
    input: ToolInput<"get_fundamentals">,
  ): Promise<ToolOutput<"get_fundamentals">> {
    // Two parallel calls: profile for marketCap (in millions USD), metrics for ratios.
    type Profile = { marketCapitalization?: number };
    type Metric = {
      metric?: {
        peTTM?: number;
        peNormalizedAnnual?: number;
        psTTM?: number;
        roeTTM?: number;
        operatingMarginTTM?: number;
        grossMarginTTM?: number;
      };
    };
    const [profile, metric] = await Promise.all([
      this.#get<Profile>("/stock/profile2", { symbol: input.ticker }),
      this.#get<Metric>("/stock/metric", { symbol: input.ticker, metric: "all" }),
    ]);
    const m = metric.metric ?? {};
    // Finnhub returns ratios as percentages for margins/ROE (e.g. 25.3 = 25.3%).
    // Normalize to fractions to match the Yahoo + fixture shape (0.253).
    const pct = (v: number | undefined) => (typeof v === "number" ? v / 100 : 0);
    return {
      source: "finnhub",
      ticker: input.ticker,
      asOf: input.date,
      // Profile gives market cap in $M; canonicalize to absolute USD.
      marketCap: (profile.marketCapitalization ?? 0) * 1_000_000,
      forwardPE: m.peNormalizedAnnual ?? m.peTTM ?? 0,
      priceToSales: m.psTTM ?? 0,
      returnOnEquity: pct(m.roeTTM),
      operatingMargin: pct(m.operatingMarginTTM),
      grossMargin: pct(m.grossMarginTTM),
    };
  }

  async search_news(
    input: ToolInput<"search_news">,
  ): Promise<ToolOutput<"search_news">> {
    const to = input.date;
    const fromDate = new Date(input.date);
    fromDate.setUTCDate(fromDate.getUTCDate() - 14);
    const from = fromDate.toISOString().slice(0, 10);
    type Item = {
      datetime: number;
      headline: string;
      source: string;
      url?: string;
      category?: string;
    };
    const data = await this.#get<Item[]>("/company-news", {
      symbol: input.ticker,
      from,
      to,
    });
    const items = (data ?? []).slice(0, 12).map((n) => ({
      date: new Date(n.datetime * 1000).toISOString().slice(0, 10),
      headline: n.headline,
      source: n.source,
      url: n.url,
      category: n.category,
    }));
    return {
      source: "finnhub",
      ticker: input.ticker,
      asOf: input.date,
      items,
    };
  }

  // Tools not available on the free tier — fall through to the next provider.
  async get_balance_sheet(
    _input: ToolInput<"get_balance_sheet">,
  ): Promise<ToolOutput<"get_balance_sheet">> {
    throw new ProviderUnsupportedError("finnhub", "get_balance_sheet");
  }
  async get_income_statement(
    _input: ToolInput<"get_income_statement">,
  ): Promise<ToolOutput<"get_income_statement">> {
    throw new ProviderUnsupportedError("finnhub", "get_income_statement");
  }
  async get_cashflow(
    _input: ToolInput<"get_cashflow">,
  ): Promise<ToolOutput<"get_cashflow">> {
    throw new ProviderUnsupportedError("finnhub", "get_cashflow");
  }
  async compute_indicators(
    _input: ToolInput<"compute_indicators">,
  ): Promise<ToolOutput<"compute_indicators">> {
    throw new ProviderUnsupportedError("finnhub", "compute_indicators");
  }
  async get_macro_indicators(
    _input: ToolInput<"get_macro_indicators">,
  ): Promise<ToolOutput<"get_macro_indicators">> {
    throw new ProviderUnsupportedError("finnhub", "get_macro_indicators");
  }
  async get_social_sentiment(
    _input: ToolInput<"get_social_sentiment">,
  ): Promise<ToolOutput<"get_social_sentiment">> {
    throw new ProviderUnsupportedError("finnhub", "get_social_sentiment");
  }
  async get_reddit_mentions(
    _input: ToolInput<"get_reddit_mentions">,
  ): Promise<ToolOutput<"get_reddit_mentions">> {
    throw new ProviderUnsupportedError("finnhub", "get_reddit_mentions");
  }
  async get_prediction_markets(
    _input: ToolInput<"get_prediction_markets">,
  ): Promise<ToolOutput<"get_prediction_markets">> {
    throw new ProviderUnsupportedError("finnhub", "get_prediction_markets");
  }
}
