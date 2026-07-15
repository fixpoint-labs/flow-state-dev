/**
 * Unit tests for the two-tier Polymarket tool (FIX-681).
 *
 * Covers normalization, sort order, filtering of closed/inactive markets, the
 * outcomePrices → probability fallback chain, topN capping, deterministic
 * `coverageQuality` classification, the sector → backdrop-theme map, and
 * backdrop dedupe across themes.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  computeCoverageQuality,
  fetchPolymarketTop,
  themesForSector,
} from "../flows/analysis/tools/data/get_prediction_markets";

/** Mock `fetch` so each Polymarket query (`?q=`) gets its own payload. Queries
 *  not in the map fall back to an empty event list. */
function mockFetchByQuery(
  byQuery: Record<string, unknown>,
  fallback: unknown = { events: [] },
) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input: unknown) => {
    const url =
      input instanceof URL
        ? input
        : new URL(typeof input === "string" ? input : (input as Request).url);
    const q = url.searchParams.get("q") ?? "";
    return new Response(JSON.stringify(byQuery[q] ?? fallback), { status: 200 });
  });
}

/** Single payload for every query (used by ticker-only tests). */
function mockFetch(payload: unknown) {
  return vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 }));
}

function events(markets: unknown[]) {
  return { events: [{ title: "E", markets }] };
}

function rawMarket(slug: string, liquidity: number, volume = 1000) {
  return {
    question: `Q-${slug}`,
    slug,
    outcomePrices: '["0.5","0.5"]',
    volume: String(volume),
    liquidity: String(liquidity),
    endDate: "2026-06-01",
    active: true,
    closed: false,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchPolymarketTop — ticker markets", () => {
  it("flattens markets across events and sorts by liquidity desc", async () => {
    mockFetch({
      events: [
        {
          title: "Event A",
          markets: [
            {
              question: "Q-low-liq",
              slug: "q-low-liq",
              outcomePrices: '["0.30","0.70"]',
              volume: "1000",
              liquidity: "500",
              endDate: "2026-06-01",
              active: true,
              closed: false,
            },
          ],
        },
        {
          title: "Event B",
          markets: [
            {
              question: "Q-high-liq",
              slug: "q-high-liq",
              outcomePrices: '["0.60","0.40"]',
              volume: "200",
              liquidity: "9000",
              endDate: "2026-06-15",
              active: true,
              closed: false,
            },
          ],
        },
      ],
    });
    const out = await fetchPolymarketTop({ ticker: "NVDA", date: "2026-05-06" });
    expect(out.source).toBe("polymarket");
    expect(out.tickerMarkets.map((m) => m.slug)).toEqual(["q-high-liq", "q-low-liq"]);
    expect(out.tickerMarkets[0]!.yesProbability).toBeCloseTo(0.6, 5);
    expect(out.tickerMarkets[0]!.eventTitle).toBe("Event B");
  });

  it("filters closed and inactive markets", async () => {
    mockFetch({
      events: [
        {
          title: "Event",
          markets: [
            { question: "Q-keep", slug: "k", outcomePrices: '["0.5","0.5"]', volume: "1", liquidity: "1", endDate: "2026", active: true, closed: false },
            { question: "Q-closed", slug: "c", outcomePrices: '["0.5","0.5"]', volume: "1", liquidity: "1", endDate: "2026", active: true, closed: true },
            { question: "Q-inactive", slug: "i", outcomePrices: '["0.5","0.5"]', volume: "1", liquidity: "1", endDate: "2026", active: false, closed: false },
          ],
        },
      ],
    });
    const out = await fetchPolymarketTop({ ticker: "NVDA", date: "2026-05-06" });
    expect(out.tickerMarkets.map((m) => m.slug)).toEqual(["k"]);
  });

  it("falls back to lastTradePrice when outcomePrices is missing", async () => {
    mockFetch({
      events: [
        {
          title: "Event",
          markets: [
            { question: "Q", slug: "q", lastTradePrice: 0.42, volume: "100", liquidity: "100", endDate: "2026", active: true, closed: false },
          ],
        },
      ],
    });
    const out = await fetchPolymarketTop({ ticker: "NVDA", date: "2026-05-06" });
    expect(out.tickerMarkets[0]!.yesProbability).toBeCloseTo(0.42, 5);
  });

  it("caps ticker results at topN", async () => {
    const markets = Array.from({ length: 25 }, (_, i) => rawMarket(`q${i}`, i));
    mockFetch({ events: [{ title: "E", markets }] });
    const out = await fetchPolymarketTop({ ticker: "NVDA", date: "2026-05-06" }, [], 5);
    expect(out.tickerMarkets).toHaveLength(5);
    expect(out.tickerMarkets[0]!.slug).toBe("q24"); // highest liquidity first
  });

  it("throws on HTTP error so the tool can return emptyPayload", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("rate limited", { status: 429 }),
    );
    await expect(
      fetchPolymarketTop({ ticker: "NVDA", date: "2026-05-06" }),
    ).rejects.toThrow(/HTTP 429/);
  });
});

describe("coverageQuality classification", () => {
  it("is rich with ≥3 ticker markets and ≥$100k aggregate liquidity", async () => {
    mockFetch(events(Array.from({ length: 5 }, (_, i) => rawMarket(`q${i}`, 40_000))));
    const out = await fetchPolymarketTop({ ticker: "NVDA", date: "2026-05-06" });
    expect(out.tickerMarkets).toHaveLength(5);
    expect(out.coverageQuality).toBe("rich"); // 5 markets, $200k
  });

  it("is thin with markets present but below the liquidity floor", async () => {
    mockFetch(events([rawMarket("a", 15_000), rawMarket("b", 15_000)]));
    const out = await fetchPolymarketTop({ ticker: "PENNY", date: "2026-05-06" });
    expect(out.tickerMarkets).toHaveLength(2);
    expect(out.coverageQuality).toBe("thin"); // 2 markets, $30k
  });

  it("is absent with zero ticker markets, while backdrop still populates", async () => {
    mockFetchByQuery({
      OBSCURE: { events: [] },
      "AI capex": events([rawMarket("ai-capex-1", 240_000)]),
    });
    const out = await fetchPolymarketTop({ ticker: "OBSCURE", date: "2026-05-06" }, [
      "AI capex",
    ]);
    expect(out.tickerMarkets).toHaveLength(0);
    expect(out.coverageQuality).toBe("absent");
    expect(out.backdropMarkets.map((m) => m.slug)).toEqual(["ai-capex-1"]);
    expect(out.backdropTheme).toBe("AI capex");
  });

  it("computeCoverageQuality is a pure function of the ticker markets", () => {
    const mkt = (slug: string, liquidityUsd: number) => ({
      question: slug,
      eventTitle: null,
      yesProbability: 0.5,
      volumeUsd: 0,
      liquidityUsd,
      endDate: "2026",
      slug,
    });
    expect(computeCoverageQuality([])).toBe("absent");
    expect(computeCoverageQuality([mkt("a", 200_000)])).toBe("thin"); // 1 market
    expect(
      computeCoverageQuality([mkt("a", 40_000), mkt("b", 40_000), mkt("c", 40_000)]),
    ).toBe("rich");
    expect(
      computeCoverageQuality([mkt("a", 1_000), mkt("b", 1_000), mkt("c", 1_000)]),
    ).toBe("thin"); // 3 markets but only $3k
  });
});

describe("backdrop markets", () => {
  it("merges and dedupes by slug across themes, excluding ticker slugs", async () => {
    mockFetchByQuery({
      NVDA: events([rawMarket("shared", 500_000)]),
      "AI capex": events([rawMarket("ai-1", 300_000), rawMarket("shared", 9_000)]),
      "data center": events([rawMarket("ai-1", 300_000), rawMarket("dc-1", 120_000)]),
    });
    const out = await fetchPolymarketTop({ ticker: "NVDA", date: "2026-05-06" }, [
      "AI capex",
      "data center",
    ]);
    const slugs = out.backdropMarkets.map((m) => m.slug);
    // `shared` belongs to the ticker tier and is excluded; `ai-1` appears in
    // both themes but only once; `dc-1` is unique.
    expect(slugs).toEqual(["ai-1", "dc-1"]); // sorted by liquidity desc
    expect(slugs).not.toContain("shared");
  });
});

describe("themesForSector", () => {
  it("maps a known sector to its themes", () => {
    expect(themesForSector("Technology")[0]).toBe("AI capex");
    expect(themesForSector("Financial Services")[0]).toBe("Fed cuts 2026");
  });

  it("falls back to default macro themes for unknown or null sectors", () => {
    expect(themesForSector(null)).toEqual(themesForSector("Nonexistent Sector"));
    expect(themesForSector(null)[0]).toBe("S&P 500 2026");
  });
});
