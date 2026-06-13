/**
 * Tests for the `search_news` handler and its `fetchFinnhubCompanyNews`
 * provider. Company news is ticker-scoped (14-day window) and feeds the
 * News Analyst. Covers: the fixture branch (loads NVDA snapshot), the
 * no-key live fallback to `unavailable`, field mapping + 12-item cap,
 * and the Finnhub-redirect URL strip (FIX-644 regression).
 */
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineFlow } from "@flow-state-dev/core";
import { testBlock } from "@flow-state-dev/testing";
import { search_news } from "../src/flows/analysis/tools/data/search_news";
import { fetchFinnhubCompanyNews } from "../src/flows/analysis/tools/providers/finnhub";
import { sessionStateSchema } from "../src/flows/analysis/state";

const fixtureFlow = defineFlow({
  kind: "trading-desk-search-news-test",
  actions: {
    run: { block: search_news },
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
});
afterEach(() => {
  process.chdir(originalCwd);
  vi.restoreAllMocks();
  delete process.env.FINNHUB_API_KEY;
});

describe("search_news handler", () => {
  it("loads the NVDA fixture in fixture mode", async () => {
    const result = await testBlock(search_news, {
      input: { ticker: "NVDA", date: "2026-05-06" },
      flow: fixtureFlow,
      session: sessionFor("fixture"),
    });
    expect(result.error).toBeNull();
    expect(result.output.source).toBe("fixture");
    expect(result.output.ticker).toBe("NVDA");
    expect(result.output.items.length).toBeGreaterThan(0);
    expect(result.output.items[0]).toHaveProperty("headline");
  });

  it("falls back to an unavailable payload in live mode with no API key", async () => {
    delete process.env.FINNHUB_API_KEY;
    const result = await testBlock(search_news, {
      input: { ticker: "NVDA", date: "2026-05-06" },
      flow: fixtureFlow,
      session: sessionFor("live"),
    });
    expect(result.error).toBeNull();
    expect(result.output.source).toBe("unavailable");
    expect(result.output.items).toEqual([]);
  });
});

describe("fetchFinnhubCompanyNews provider", () => {
  function mockFetch(payload: unknown, status = 200) {
    return vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response(JSON.stringify(payload), { status }),
    );
  }

  beforeEach(() => {
    process.env.FINNHUB_API_KEY = "test-key";
  });

  it("maps the company-news feed and stamps source finnhub with ticker", async () => {
    mockFetch([
      {
        datetime: 1746489600,
        headline: "NVDA beats Q1 estimates",
        source: "Reuters",
        url: "https://example.com/nvda-q1",
        category: "company",
        summary: "Revenue up 40% YoY.",
      },
      {
        datetime: 1746403200,
        headline: "AI chip demand surges",
        source: "Bloomberg",
      },
    ]);
    const out = await fetchFinnhubCompanyNews({ ticker: "NVDA", date: "2026-05-06" });
    expect(out.source).toBe("finnhub");
    expect(out.ticker).toBe("NVDA");
    expect(out.asOf).toBe("2026-05-06");
    expect(out.items).toHaveLength(2);
    expect(out.items[0].headline).toBe("NVDA beats Q1 estimates");
    expect(out.items[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(out.items[1].summary).toBeNull();
  });

  it("caps the feed at 12 items for prompt budget", async () => {
    const many = Array.from({ length: 18 }, (_, i) => ({
      datetime: 1746489600 - i * 86400,
      headline: `Headline ${i}`,
      source: "Wire",
    }));
    mockFetch(many);
    const out = await fetchFinnhubCompanyNews({ ticker: "NVDA", date: "2026-05-06" });
    expect(out.items).toHaveLength(12);
  });

  it("strips Finnhub redirect URLs, preserves real URLs, keeps the item (FIX-644)", async () => {
    mockFetch([
      {
        datetime: 1746489600,
        headline: "Real article",
        source: "Reuters",
        url: "https://www.reuters.com/article/nvda-earnings",
        summary: "Solid quarter.",
      },
      {
        datetime: 1746403200,
        headline: "Redirect article",
        source: "MarketWatch",
        url: "https://finnhub.io/api/news?id=c72df46c477a58b979f60ca8b0497915152d26683bc08c149c4986168b0f80ed",
        summary: "Summary still useful.",
      },
      {
        datetime: 1746316800,
        headline: "Empty URL article",
        source: "Wire",
        url: "",
        summary: "No URL at all.",
      },
    ]);
    const out = await fetchFinnhubCompanyNews({ ticker: "NVDA", date: "2026-05-06" });
    expect(out.items).toHaveLength(3);
    // Real URL preserved.
    expect(out.items[0].url).toBe("https://www.reuters.com/article/nvda-earnings");
    // Finnhub redirect URL stripped to undefined.
    expect(out.items[1].url).toBeUndefined();
    // Item is retained — headline and summary still present.
    expect(out.items[1].headline).toBe("Redirect article");
    expect(out.items[1].summary).toBe("Summary still useful.");
    // Empty-string URL also stripped to undefined.
    expect(out.items[2].url).toBeUndefined();
  });

  it("strips www.finnhub.io redirect URLs too", async () => {
    mockFetch([
      {
        datetime: 1746489600,
        headline: "WWW redirect",
        source: "Wire",
        url: "https://www.finnhub.io/api/news?id=abc123",
      },
    ]);
    const out = await fetchFinnhubCompanyNews({ ticker: "NVDA", date: "2026-05-06" });
    expect(out.items[0].url).toBeUndefined();
    expect(out.items[0].headline).toBe("WWW redirect");
  });
});
