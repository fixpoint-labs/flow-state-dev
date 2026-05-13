/**
 * `PolymarketDataSource` — prediction-market data via Polymarket's public
 * Gamma API. No key required.
 *
 * The endpoint we hit (`/public-search`) returns events keyed by free-text
 * query. We flatten the per-event `markets` arrays into one list, drop closed
 * or inactive markets, sort by liquidity (proxy for signal depth), and return
 * the top N. The analyst decides which markets are relevant — we don't try
 * to classify "bullish vs. bearish" here because the question text is
 * idiosyncratic and the LLM is better at parsing intent than a heuristic.
 *
 * Implements `get_prediction_markets` only; every other tool throws so the
 * chain walks past it.
 */
import {
  type DataSource,
  type ToolInput,
  type ToolOutput,
} from "./data-source";
import { ProviderUnsupportedError } from "./yahoo-data-source";

const POLY_SEARCH = "https://gamma-api.polymarket.com/public-search";

const DEFAULT_TOP_N = 10;

type RawMarket = {
  question?: string;
  slug?: string;
  outcomePrices?: string;
  outcomes?: string;
  lastTradePrice?: number;
  volume?: string | number;
  liquidity?: string | number;
  endDate?: string;
  active?: boolean;
  closed?: boolean;
};

type RawEvent = {
  title?: string;
  markets?: RawMarket[];
};

type SearchResponse = {
  events?: RawEvent[];
};

export class PolymarketDataSource implements DataSource {
  readonly mode = "live" as const;
  readonly provider = "polymarket" as const;
  readonly #topN: number;

  constructor(options: { topN?: number } = {}) {
    this.#topN = options.topN ?? DEFAULT_TOP_N;
  }

  async get_prediction_markets(
    input: ToolInput<"get_prediction_markets">,
  ): Promise<ToolOutput<"get_prediction_markets">> {
    const url = new URL(POLY_SEARCH);
    url.searchParams.set("q", input.ticker);
    // Ask for a fat upstream pull so we have headroom to filter and sort.
    url.searchParams.set("limit_per_type", "50");
    url.searchParams.set("events_status", "active");
    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `Polymarket search failed: HTTP ${res.status} ${body.slice(0, 120)}`,
      );
    }
    const data = (await res.json()) as SearchResponse;

    const flat: ToolOutput<"get_prediction_markets">["markets"] = [];
    for (const event of data.events ?? []) {
      for (const m of event.markets ?? []) {
        if (m.active === false || m.closed === true) continue;
        const probability = yesProb(m);
        const volumeUsd = numberFrom(m.volume);
        const liquidityUsd = numberFrom(m.liquidity);
        if (!m.question || !m.slug || !m.endDate) continue;
        flat.push({
          question: m.question,
          eventTitle: event.title ?? null,
          yesProbability: probability,
          volumeUsd,
          liquidityUsd,
          endDate: m.endDate,
          slug: m.slug,
        });
      }
    }

    // Sort by liquidity (depth of conviction) descending; secondary tiebreak
    // is volume. End-date proximity isn't a great primary sort because some
    // very-short-dated markets have tiny liquidity and would crowd out the
    // richer signals.
    flat.sort((a, b) => {
      if (b.liquidityUsd !== a.liquidityUsd) return b.liquidityUsd - a.liquidityUsd;
      return b.volumeUsd - a.volumeUsd;
    });

    return {
      source: "polymarket",
      ticker: input.ticker,
      asOf: input.date,
      markets: flat.slice(0, this.#topN),
    };
  }

  // Unsupported — fall through.
  async get_balance_sheet(
    _input: ToolInput<"get_balance_sheet">,
  ): Promise<ToolOutput<"get_balance_sheet">> {
    throw new ProviderUnsupportedError("polymarket", "get_balance_sheet");
  }
  async get_income_statement(
    _input: ToolInput<"get_income_statement">,
  ): Promise<ToolOutput<"get_income_statement">> {
    throw new ProviderUnsupportedError("polymarket", "get_income_statement");
  }
  async get_cashflow(
    _input: ToolInput<"get_cashflow">,
  ): Promise<ToolOutput<"get_cashflow">> {
    throw new ProviderUnsupportedError("polymarket", "get_cashflow");
  }
  async get_fundamentals(
    _input: ToolInput<"get_fundamentals">,
  ): Promise<ToolOutput<"get_fundamentals">> {
    throw new ProviderUnsupportedError("polymarket", "get_fundamentals");
  }
  async get_price_history(
    _input: ToolInput<"get_price_history">,
  ): Promise<ToolOutput<"get_price_history">> {
    throw new ProviderUnsupportedError("polymarket", "get_price_history");
  }
  async compute_indicators(
    _input: ToolInput<"compute_indicators">,
  ): Promise<ToolOutput<"compute_indicators">> {
    throw new ProviderUnsupportedError("polymarket", "compute_indicators");
  }
  async search_news(
    _input: ToolInput<"search_news">,
  ): Promise<ToolOutput<"search_news">> {
    throw new ProviderUnsupportedError("polymarket", "search_news");
  }
  async get_macro_indicators(
    _input: ToolInput<"get_macro_indicators">,
  ): Promise<ToolOutput<"get_macro_indicators">> {
    throw new ProviderUnsupportedError("polymarket", "get_macro_indicators");
  }
  async get_social_sentiment(
    _input: ToolInput<"get_social_sentiment">,
  ): Promise<ToolOutput<"get_social_sentiment">> {
    throw new ProviderUnsupportedError("polymarket", "get_social_sentiment");
  }
  async get_reddit_mentions(
    _input: ToolInput<"get_reddit_mentions">,
  ): Promise<ToolOutput<"get_reddit_mentions">> {
    throw new ProviderUnsupportedError("polymarket", "get_reddit_mentions");
  }
}

/** Extract the Yes-side probability. `outcomePrices` is a stringified JSON
 *  array (`'["0.13","0.87"]'`); fall back to `lastTradePrice` if it can't be
 *  parsed. Both express price ∈ [0, 1]. */
function yesProb(m: RawMarket): number {
  if (typeof m.outcomePrices === "string") {
    try {
      const parsed = JSON.parse(m.outcomePrices) as unknown;
      if (Array.isArray(parsed) && parsed.length > 0) {
        const yes = Number(parsed[0]);
        if (Number.isFinite(yes)) return yes;
      }
    } catch {
      // fall through
    }
  }
  return typeof m.lastTradePrice === "number" ? m.lastTradePrice : 0;
}

function numberFrom(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}
