/**
 * Unit tests for `fetchPolymarketTop` — covers normalization, sort order,
 * filtering of closed/inactive markets, the outcomePrices → probability
 * fallback chain, and topN capping.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchPolymarketTop } from "../src/flows/trading-desk/phase-1/tools/get_prediction_markets";

function mockFetch(payload: unknown) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify(payload), { status: 200 }),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchPolymarketTop", () => {
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
    expect(out.markets.map((m) => m.slug)).toEqual(["q-high-liq", "q-low-liq"]);
    expect(out.markets[0]!.yesProbability).toBeCloseTo(0.6, 5);
    expect(out.markets[0]!.eventTitle).toBe("Event B");
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
    expect(out.markets.map((m) => m.slug)).toEqual(["k"]);
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
    expect(out.markets[0]!.yesProbability).toBeCloseTo(0.42, 5);
  });

  it("caps results at topN", async () => {
    const markets = Array.from({ length: 25 }, (_, i) => ({
      question: `Q${i}`,
      slug: `q${i}`,
      outcomePrices: '["0.5","0.5"]',
      volume: String(i),
      liquidity: String(i),
      endDate: "2026",
      active: true,
      closed: false,
    }));
    mockFetch({ events: [{ title: "E", markets }] });
    const out = await fetchPolymarketTop({ ticker: "NVDA", date: "2026-05-06" }, 5);
    expect(out.markets).toHaveLength(5);
    expect(out.markets[0]!.slug).toBe("q24"); // highest liquidity first
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
