/**
 * Tests for the `get_market_news` handler and its `fetchFinnhubMarketNews`
 * provider. Market news is market-wide (no `ticker` field) and feeds the
 * Market Analyst. Covers: the fixture branch (loads the ticker-agnostic
 * `_macro` snapshot), the no-key live fallback to an `unavailable` payload,
 * and the Finnhub `/news?category=general` field mapping + 12-item cap.
 * Uses `testBlock` for the handler (per AGENTS.md rule 4 — never reach into
 * `block.config.execute`).
 */
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineFlow } from "@flow-state-dev/core";
import { testBlock } from "@flow-state-dev/testing";
import { get_market_news } from "../flows/analysis/tools/data/get_market_news";
import { fetchFinnhubMarketNews } from "../lib/providers/finnhub";
import { _resetCache } from "../lib/cache";
import { sessionStateSchema } from "../flows/analysis/state";

const fixtureFlow = defineFlow({
  kind: "trading-desk-market-news-test",
  actions: {
    run: { block: get_market_news },
  },
  session: { stateSchema: sessionStateSchema },
})({ id: "test" });

function sessionFor(dataSource: "fixture" | "live") {
  return {
    state: {
      ticker: "NVDA",
      date: "2026-05-06",
      costPreset: "fast" as const,
      dataSource,
      activePhase: "idle" as const,
    },
  };
}

const originalCwd = process.cwd();
beforeEach(() => {
  process.chdir(path.resolve(__dirname, ".."));
  _resetCache();
});
afterEach(() => {
  process.chdir(originalCwd);
  vi.restoreAllMocks();
  delete process.env.FINNHUB_API_KEY;
});

describe("get_market_news handler", () => {
  it("loads the ticker-agnostic fixture in fixture mode", async () => {
    const result = await testBlock(get_market_news, {
      input: { date: "2026-05-06" },
      flow: fixtureFlow,
      session: sessionFor("fixture"),
    });
    expect(result.error).toBeNull();
    expect(result.output.source).toBe("fixture");
    // Market-wide: the payload carries no ticker.
    expect("ticker" in result.output).toBe(false);
    expect(result.output.items.length).toBeGreaterThan(0);
    expect(result.output.items[0]).toHaveProperty("headline");
  });

  it("falls back to an unavailable payload in live mode with no API key", async () => {
    delete process.env.FINNHUB_API_KEY;
    const result = await testBlock(get_market_news, {
      input: { date: "2026-05-06" },
      flow: fixtureFlow,
      session: sessionFor("live"),
    });
    expect(result.error).toBeNull();
    expect(result.output.source).toBe("unavailable");
    expect(result.output.items).toEqual([]);
  });
});

describe("fetchFinnhubMarketNews provider", () => {
  function mockFetch(payload: unknown, status = 200) {
    return vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response(JSON.stringify(payload), { status }),
    );
  }

  beforeEach(() => {
    process.env.FINNHUB_API_KEY = "test-key";
  });

  it("maps the general-news feed and stamps source finnhub with no ticker", async () => {
    mockFetch([
      {
        datetime: 1746489600, // 2026-05-06 (UTC)
        headline: "Semiconductor index extends rally",
        source: "Bloomberg",
        url: "https://example.com/semis",
        category: "sector",
        summary: "Breadth improves as AI orders broaden.",
      },
      {
        datetime: 1746403200,
        headline: "Cloud capex guidance lifted",
        source: "Reuters",
        // no url, no summary
      },
    ]);
    const out = await fetchFinnhubMarketNews({ date: "2026-05-06" });
    expect(out.source).toBe("finnhub");
    expect("ticker" in out).toBe(false);
    expect(out.asOf).toBe("2026-05-06");
    expect(out.items).toHaveLength(2);
    expect(out.items[0].headline).toBe("Semiconductor index extends rally");
    expect(out.items[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Missing summary maps to null, not undefined.
    expect(out.items[1].summary).toBeNull();
  });

  it("strips Finnhub redirect URLs and preserves real URLs (FIX-644)", async () => {
    mockFetch([
      {
        datetime: 1746489600,
        headline: "Real headline",
        source: "Reuters",
        url: "https://www.reuters.com/markets/fed-holds",
        summary: "Fed holds.",
      },
      {
        datetime: 1746403200,
        headline: "Redirect headline",
        source: "MarketWatch",
        url: "https://finnhub.io/api/news?id=abc123def456",
        summary: "Still useful summary.",
      },
    ]);
    const out = await fetchFinnhubMarketNews({ date: "2026-05-06" });
    expect(out.items).toHaveLength(2);
    expect(out.items[0].url).toBe("https://www.reuters.com/markets/fed-holds");
    expect(out.items[1].url).toBeUndefined();
    expect(out.items[1].headline).toBe("Redirect headline");
    expect(out.items[1].summary).toBe("Still useful summary.");
  });

  it("caps the feed at 12 items for prompt budget", async () => {
    const many = Array.from({ length: 18 }, (_, i) => ({
      datetime: 1746489600 - i * 86400,
      headline: `Headline ${i}`,
      source: "Wire",
    }));
    mockFetch(many);
    const out = await fetchFinnhubMarketNews({ date: "2026-05-06" });
    expect(out.items).toHaveLength(12);
  });
});
