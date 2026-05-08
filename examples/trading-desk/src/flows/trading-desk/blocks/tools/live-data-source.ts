/**
 * `LiveDataSource` — live data via `yahoo-finance2` for prices + fundamentals,
 * with the rest delegating to the fixture source. The Phase 1 minimum bar
 * is "prices + fundamentals via Yahoo (no key)"; news + social-sentiment
 * stay fixture-only and ship a follow-on.
 *
 * `yahoo-finance2` is loaded dynamically so `pnpm install` can complete
 * without forcing the dependency on every consumer; if the live toggle is
 * never flipped, the import never resolves.
 */
import {
  type DataSource,
  type ToolInput,
  type ToolOutput,
} from "./data-source";
import type { FixtureDataSource } from "./fixture-data-source";

type YahooModule = typeof import("yahoo-finance2");

async function loadYahoo(): Promise<YahooModule["default"]> {
  // Cast through `unknown` because the dynamic import isn't statically
  // typed when the dependency is optional.
  const mod = (await import("yahoo-finance2")) as unknown as { default: YahooModule["default"] };
  return mod.default;
}

export class LiveDataSource implements DataSource {
  readonly mode = "live" as const;
  readonly #fallback: FixtureDataSource;

  constructor(fallback: FixtureDataSource) {
    this.#fallback = fallback;
  }

  // --- Live wiring --------------------------------------------------------

  async get_price_history(
    input: ToolInput<"get_price_history">,
  ): Promise<ToolOutput<"get_price_history">> {
    const yahoo = await loadYahoo();
    // Pull ~30 trading days ending at the requested date.
    const period2 = new Date(input.date);
    const period1 = new Date(period2);
    period1.setUTCDate(period1.getUTCDate() - 45);
    const result = await yahoo.chart(input.ticker, {
      period1,
      period2,
      interval: "1d",
    });
    const bars = (result.quotes ?? [])
      .filter((q) => q.open != null && q.close != null)
      .map((q) => ({
        date: (q.date instanceof Date ? q.date : new Date(q.date)).toISOString().slice(0, 10),
        open: Number(q.open ?? 0),
        high: Number(q.high ?? 0),
        low: Number(q.low ?? 0),
        close: Number(q.close ?? 0),
        volume: Number(q.volume ?? 0),
      }));
    return {
      source: "live",
      ticker: input.ticker,
      range: input.range ?? "1mo",
      bars,
    };
  }

  async get_fundamentals(
    input: ToolInput<"get_fundamentals">,
  ): Promise<ToolOutput<"get_fundamentals">> {
    const yahoo = await loadYahoo();
    const summary = (await yahoo.quoteSummary(input.ticker, {
      modules: ["summaryDetail", "financialData", "defaultKeyStatistics"],
    })) as Record<string, Record<string, unknown> | undefined>;
    const detail = summary.summaryDetail ?? {};
    const fin = summary.financialData ?? {};
    const stats = summary.defaultKeyStatistics ?? {};
    return {
      source: "live",
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

  // --- Fixture fallback (news + sentiment + statements + macro) ----------

  async get_balance_sheet(input: ToolInput<"get_balance_sheet">) {
    return this.#fallback.get_balance_sheet(input);
  }
  async get_income_statement(input: ToolInput<"get_income_statement">) {
    return this.#fallback.get_income_statement(input);
  }
  async get_cashflow(input: ToolInput<"get_cashflow">) {
    return this.#fallback.get_cashflow(input);
  }
  async compute_indicators(input: ToolInput<"compute_indicators">) {
    return this.#fallback.compute_indicators(input);
  }
  async search_news(input: ToolInput<"search_news">) {
    return this.#fallback.search_news(input);
  }
  async get_macro_indicators(input: ToolInput<"get_macro_indicators">) {
    return this.#fallback.get_macro_indicators(input);
  }
  async get_social_sentiment(input: ToolInput<"get_social_sentiment">) {
    return this.#fallback.get_social_sentiment(input);
  }
  async get_reddit_mentions(input: ToolInput<"get_reddit_mentions">) {
    return this.#fallback.get_reddit_mentions(input);
  }
}

function numberFrom(raw: unknown): number {
  if (raw == null) return 0;
  if (typeof raw === "number") return raw;
  if (typeof raw === "object" && raw !== null && "raw" in raw) {
    const v = (raw as { raw?: unknown }).raw;
    return typeof v === "number" ? v : 0;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}
