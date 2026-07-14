/**
 * Tests for the `get_macro_news` handler and its `fetchFinnhubMacroNews`
 * provider (FIX-704 follow-up). Macro news is the Macro Analyst's always-on
 * secondary source: a deterministic, market-wide headline pull that runs on
 * every cost preset, so the macro memo has a real read even when FRED is down.
 *
 * Covers: the fixture branch (loads the ticker-agnostic `_macro` snapshot),
 * the no-key live fallback to an `unavailable` payload, the general + forex
 * field mapping with dedupe + 12-item cap, and the best-effort forex lane
 * (general alone still returns when forex fails). Uses `testBlock` for the
 * handler (per AGENTS.md rule 4).
 */
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineFlow } from "@flow-state-dev/core";
import { testBlock } from "@flow-state-dev/testing";
import { get_macro_news } from "../src/flows/analysis/tools/data/get_macro_news";
import { fetchFinnhubMacroNews } from "../src/providers/finnhub";
import { _resetCache } from "../src/lib/cache";
import { sessionStateSchema } from "../src/flows/analysis/state";

const fixtureFlow = defineFlow({
  kind: "trading-desk-macro-news-test",
  actions: {
    run: { block: get_macro_news },
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

describe("get_macro_news handler", () => {
  it("loads the ticker-agnostic fixture in fixture mode", async () => {
    const result = await testBlock(get_macro_news, {
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
    const result = await testBlock(get_macro_news, {
      input: { date: "2026-05-06" },
      flow: fixtureFlow,
      session: sessionFor("live"),
    });
    expect(result.error).toBeNull();
    expect(result.output.source).toBe("unavailable");
    expect(result.output.items).toEqual([]);
  });
});

describe("fetchFinnhubMacroNews provider", () => {
  beforeEach(() => {
    process.env.FINNHUB_API_KEY = "test-key";
  });

  /** Route by `category` query param so general and forex return distinct sets. */
  function mockByCategory(
    general: unknown[],
    forex: unknown[] | { fail: true },
  ) {
    return vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("category=forex")) {
        if (!Array.isArray(forex)) return new Response("forex down", { status: 500 });
        return new Response(JSON.stringify(forex), { status: 200 });
      }
      return new Response(JSON.stringify(general), { status: 200 });
    });
  }

  it("merges general + forex, maps fields, stamps finnhub with no ticker", async () => {
    mockByCategory(
      [
        {
          datetime: 1746489600,
          headline: "Fed holds rates steady",
          source: "Reuters",
          url: "https://example.com/fed",
          category: "general",
          summary: "Third consecutive hold.",
        },
      ],
      [
        {
          datetime: 1746403200,
          headline: "Dollar firms as yields hold",
          source: "Bloomberg",
          url: "https://example.com/dxy",
          // no summary
        },
      ],
    );
    const out = await fetchFinnhubMacroNews({ date: "2026-05-06" });
    expect(out.source).toBe("finnhub");
    expect("ticker" in out).toBe(false);
    expect(out.items).toHaveLength(2);
    // Sorted newest-first by datetime.
    expect(out.items[0].headline).toBe("Fed holds rates steady");
    expect(out.items[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Missing summary maps to null, not undefined.
    expect(out.items[1].summary).toBeNull();
  });

  it("returns the general feed when the forex lane fails (best-effort)", async () => {
    mockByCategory(
      [
        {
          datetime: 1746489600,
          headline: "Tariff review widens",
          source: "Politico",
          url: "https://example.com/tariffs",
        },
      ],
      { fail: true },
    );
    const out = await fetchFinnhubMacroNews({ date: "2026-05-06" });
    expect(out.source).toBe("finnhub");
    expect(out.items).toHaveLength(1);
    expect(out.items[0].headline).toBe("Tariff review widens");
  });

  it("strips Finnhub redirect URLs and preserves real URLs (FIX-644)", async () => {
    mockByCategory(
      [
        {
          datetime: 1746489600,
          headline: "Real macro headline",
          source: "Reuters",
          url: "https://www.reuters.com/macro/rates",
          summary: "Rates hold.",
        },
        {
          datetime: 1746403200,
          headline: "Redirect macro headline",
          source: "Bloomberg",
          url: "https://finnhub.io/api/news?id=deadbeef",
          summary: "Still useful.",
        },
      ],
      [],
    );
    const out = await fetchFinnhubMacroNews({ date: "2026-05-06" });
    expect(out.items).toHaveLength(2);
    expect(out.items[0].url).toBe("https://www.reuters.com/macro/rates");
    expect(out.items[1].url).toBeUndefined();
    expect(out.items[1].headline).toBe("Redirect macro headline");
    expect(out.items[1].summary).toBe("Still useful.");
  });

  it("does not collapse distinct redirect-URL items during dedupe (FIX-644)", async () => {
    mockByCategory(
      [
        {
          datetime: 1746489600,
          headline: "Redirect A",
          source: "Wire",
          url: "https://finnhub.io/api/news?id=aaa",
          summary: "Summary A.",
        },
        {
          datetime: 1746403200,
          headline: "Redirect B",
          source: "Wire",
          url: "https://finnhub.io/api/news?id=bbb",
          summary: "Summary B.",
        },
      ],
      [],
    );
    const out = await fetchFinnhubMacroNews({ date: "2026-05-06" });
    expect(out.items).toHaveLength(2);
    expect(out.items[0].url).toBeUndefined();
    expect(out.items[1].url).toBeUndefined();
    expect(out.items[0].headline).toBe("Redirect A");
    expect(out.items[1].headline).toBe("Redirect B");
  });

  it("dedupes by url and caps the merged feed at 12 items", async () => {
    const dup = {
      datetime: 1746489600,
      headline: "Same story",
      source: "Wire",
      url: "https://example.com/dup",
    };
    const many = Array.from({ length: 18 }, (_, i) => ({
      datetime: 1746489600 - i * 86400,
      headline: `Headline ${i}`,
      source: "Wire",
      url: `https://example.com/${i}`,
    }));
    mockByCategory([dup, ...many], [dup]); // dup appears in both feeds
    const out = await fetchFinnhubMacroNews({ date: "2026-05-06" });
    expect(out.items).toHaveLength(12);
    // The duplicate url appears at most once.
    const dupCount = out.items.filter((i) => i.url === "https://example.com/dup").length;
    expect(dupCount).toBe(1);
  });
});
