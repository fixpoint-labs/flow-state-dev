/**
 * Top Polymarket prediction markets matching the ticker.
 *
 * Polymarket is the only live provider for this tool — used by no other
 * tool — so the Gamma API plumbing lives inline. We flatten markets across
 * events from the `public-search` endpoint, drop closed/inactive markets,
 * sort by liquidity (depth of conviction), and return the top 10. The
 * analyst decides which markets are relevant from the question text; we
 * don't try to classify "bullish vs. bearish" here.
 */
import { handler } from "@flow-state-dev/core";
import { getOrFetch } from "../../services/cache";
import { loadFixture } from "../../services/fixtures";
import { emptyPayload } from "./empty-payloads";
import {
  pickMode,
  toolInputSchemas,
  toolOutputSchemas,
  type ToolInput,
  type ToolOutput,
} from "./schemas";

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

type RawEvent = { title?: string; markets?: RawMarket[] };

type SearchResponse = { events?: RawEvent[] };

/** Yes-side probability — prefer `outcomePrices[0]` (current bid-ask consensus)
 *  over `lastTradePrice` (which can be a stale single fill). */
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

export async function fetchPolymarketTop(
  input: ToolInput<"get_prediction_markets">,
  topN = DEFAULT_TOP_N,
): Promise<ToolOutput<"get_prediction_markets">> {
  const url = new URL(POLY_SEARCH);
  url.searchParams.set("q", input.ticker);
  // Pull a fat upstream batch so we have headroom to filter and sort.
  url.searchParams.set("limit_per_type", "50");
  url.searchParams.set("events_status", "active");
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Polymarket: HTTP ${res.status} ${body.slice(0, 120)}`);
  }
  const data = (await res.json()) as SearchResponse;

  const flat: ToolOutput<"get_prediction_markets">["markets"] = [];
  for (const event of data.events ?? []) {
    for (const m of event.markets ?? []) {
      if (m.active === false || m.closed === true) continue;
      if (!m.question || !m.slug || !m.endDate) continue;
      flat.push({
        question: m.question,
        eventTitle: event.title ?? null,
        yesProbability: yesProb(m),
        volumeUsd: numberFrom(m.volume),
        liquidityUsd: numberFrom(m.liquidity),
        endDate: m.endDate,
        slug: m.slug,
      });
    }
  }

  // Sort by liquidity (depth of conviction) desc; volume as tiebreak. End-date
  // proximity isn't a great primary sort because very-short-dated markets with
  // tiny liquidity would crowd out the richer signals.
  flat.sort((a, b) =>
    b.liquidityUsd !== a.liquidityUsd
      ? b.liquidityUsd - a.liquidityUsd
      : b.volumeUsd - a.volumeUsd,
  );

  return {
    source: "polymarket",
    ticker: input.ticker,
    asOf: input.date,
    markets: flat.slice(0, topN),
  };
}

export const get_prediction_markets = handler({
  name: "get_prediction_markets",
  description:
    "Top 10 active Polymarket prediction markets matching the ticker. Each market has a yes-side probability (0..1), liquidity, end date, and question text — real money is staked, so it's a high-signal alternative to social-media sentiment.",
  inputSchema: toolInputSchemas.get_prediction_markets,
  outputSchema: toolOutputSchemas.get_prediction_markets,
  execute: async (input, ctx) => {
    if (pickMode(ctx) === "fixture") return loadFixture("get_prediction_markets", input);
    return getOrFetch("get_prediction_markets", input, async () => {
      try {
        return await fetchPolymarketTop(input);
      } catch {
        return emptyPayload("get_prediction_markets", input);
      }
    });
  },
});
