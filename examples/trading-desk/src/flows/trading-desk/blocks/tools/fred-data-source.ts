/**
 * `FredDataSource` — macro indicators via the FRED API (St. Louis Fed).
 *
 * Activated when `FRED_API_KEY` is set. FRED is the canonical free source for
 * US macroeconomic series; the key is instant signup, no review. This provider
 * answers `get_macro_indicators` only — every other tool throws so the chain
 * walks past it.
 *
 * Series IDs:
 *   - `CPIAUCSL`   — CPI (all items, urban). YoY computed locally from the
 *                    last 13 monthly observations.
 *   - `UNRATE`     — civilian unemployment rate, monthly.
 *   - `DFF`        — daily federal funds effective rate.
 *   - `DGS10`      — 10-year treasury constant maturity rate, daily.
 *   - `DCOILWTICO` — WTI crude spot, daily.
 *
 * FRED returns string values; a missing observation comes through as `"."`
 * which we filter out before taking the latest.
 */
import {
  type DataSource,
  type ToolInput,
  type ToolOutput,
} from "./data-source";
import { ProviderUnsupportedError } from "./yahoo-data-source";

const FRED_BASE = "https://api.stlouisfed.org/fred/series/observations";

export function getFredKey(): string | undefined {
  const key = process.env.FRED_API_KEY?.trim();
  return key && key.length > 0 ? key : undefined;
}

type FredResponse = {
  observations?: Array<{ date: string; value: string }>;
};

export class FredDataSource implements DataSource {
  readonly mode = "live" as const;
  readonly provider = "fred" as const;
  readonly #key: string;

  constructor(key: string) {
    this.#key = key;
  }

  async #fetchSeries(seriesId: string, limit: number): Promise<number[]> {
    const url = new URL(FRED_BASE);
    url.searchParams.set("series_id", seriesId);
    url.searchParams.set("api_key", this.#key);
    url.searchParams.set("file_type", "json");
    url.searchParams.set("sort_order", "desc");
    url.searchParams.set("limit", String(limit));
    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`FRED ${seriesId} failed: HTTP ${res.status} ${body.slice(0, 120)}`);
    }
    const data = (await res.json()) as FredResponse;
    return (data.observations ?? [])
      .map((o) => o.value)
      .filter((v) => v !== "." && v !== "")
      .map((v) => Number(v))
      .filter((n) => Number.isFinite(n));
  }

  async get_macro_indicators(
    input: ToolInput<"get_macro_indicators">,
  ): Promise<ToolOutput<"get_macro_indicators">> {
    // CPI fetched with 13 obs so we can compute YoY locally. The rest take
    // the latest non-missing observation.
    const [cpiSeries, unrate, fedFunds, tenYear, wti] = await Promise.all([
      this.#fetchSeries("CPIAUCSL", 13),
      this.#fetchSeries("UNRATE", 1),
      this.#fetchSeries("DFF", 5),
      this.#fetchSeries("DGS10", 5),
      this.#fetchSeries("DCOILWTICO", 5),
    ]);
    const latestCpi = cpiSeries[0] ?? 0;
    const yearAgoCpi = cpiSeries[12] ?? cpiSeries[cpiSeries.length - 1] ?? latestCpi;
    const cpiYoy = yearAgoCpi > 0 ? (latestCpi - yearAgoCpi) / yearAgoCpi : 0;
    return {
      source: "fred",
      asOf: input.date,
      cpiYoy,
      unemployment: (unrate[0] ?? 0) / 100,
      fedFundsRate: (fedFunds[0] ?? 0) / 100,
      tenYearYield: (tenYear[0] ?? 0) / 100,
      oilWtiUsd: wti[0] ?? 0,
    };
  }

  async get_balance_sheet(
    _input: ToolInput<"get_balance_sheet">,
  ): Promise<ToolOutput<"get_balance_sheet">> {
    throw new ProviderUnsupportedError("fred", "get_balance_sheet");
  }
  async get_income_statement(
    _input: ToolInput<"get_income_statement">,
  ): Promise<ToolOutput<"get_income_statement">> {
    throw new ProviderUnsupportedError("fred", "get_income_statement");
  }
  async get_cashflow(
    _input: ToolInput<"get_cashflow">,
  ): Promise<ToolOutput<"get_cashflow">> {
    throw new ProviderUnsupportedError("fred", "get_cashflow");
  }
  async get_fundamentals(
    _input: ToolInput<"get_fundamentals">,
  ): Promise<ToolOutput<"get_fundamentals">> {
    throw new ProviderUnsupportedError("fred", "get_fundamentals");
  }
  async get_price_history(
    _input: ToolInput<"get_price_history">,
  ): Promise<ToolOutput<"get_price_history">> {
    throw new ProviderUnsupportedError("fred", "get_price_history");
  }
  async compute_indicators(
    _input: ToolInput<"compute_indicators">,
  ): Promise<ToolOutput<"compute_indicators">> {
    throw new ProviderUnsupportedError("fred", "compute_indicators");
  }
  async search_news(
    _input: ToolInput<"search_news">,
  ): Promise<ToolOutput<"search_news">> {
    throw new ProviderUnsupportedError("fred", "search_news");
  }
  async get_social_sentiment(
    _input: ToolInput<"get_social_sentiment">,
  ): Promise<ToolOutput<"get_social_sentiment">> {
    throw new ProviderUnsupportedError("fred", "get_social_sentiment");
  }
  async get_reddit_mentions(
    _input: ToolInput<"get_reddit_mentions">,
  ): Promise<ToolOutput<"get_reddit_mentions">> {
    throw new ProviderUnsupportedError("fred", "get_reddit_mentions");
  }
  async get_prediction_markets(
    _input: ToolInput<"get_prediction_markets">,
  ): Promise<ToolOutput<"get_prediction_markets">> {
    throw new ProviderUnsupportedError("fred", "get_prediction_markets");
  }
}
