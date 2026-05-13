/**
 * Unit tests for `MultiSourceDataSource` — covers the provider-chain behavior:
 * provider-unsupported errors fall through, transient errors fall through, and
 * total failure produces an `"unavailable"` empty payload (never fixture data
 * in live mode).
 */
import { describe, expect, it, vi } from "vitest";
import { MultiSourceDataSource } from "../src/flows/trading-desk/blocks/tools/multi-source-data-source";
import { ProviderUnsupportedError } from "../src/flows/trading-desk/blocks/tools/yahoo-data-source";
import type {
  DataSource,
  ToolInput,
  ToolOutput,
} from "../src/flows/trading-desk/blocks/tools/data-source";

function fundamentalsPayload(source: "fixture" | "yahoo" | "finnhub", ticker = "NVDA"): ToolOutput<"get_fundamentals"> {
  return {
    source,
    ticker,
    asOf: "2026-05-06",
    marketCap: 1_000_000_000,
    forwardPE: 30,
    priceToSales: 12,
    returnOnEquity: 0.5,
    operatingMargin: 0.4,
    grossMargin: 0.7,
  };
}

function stubProvider(name: "finnhub" | "yahoo", impl: Partial<DataSource>): DataSource {
  // Cast through a partial; only the methods exercised in the test need to be real.
  return { mode: "live" as const, provider: name, ...impl } as unknown as DataSource;
}

describe("MultiSourceDataSource", () => {
  it("returns the first provider's payload when it succeeds", async () => {
    const finnhub = stubProvider("finnhub", {
      get_fundamentals: vi.fn(async () => fundamentalsPayload("finnhub")),
    });
    const yahoo = stubProvider("yahoo", {
      get_fundamentals: vi.fn(async () => fundamentalsPayload("yahoo")),
    });
    const chain = new MultiSourceDataSource([finnhub, yahoo]);
    const result = await chain.get_fundamentals({ ticker: "NVDA", date: "2026-05-06" });
    expect(result.source).toBe("finnhub");
    expect(yahoo.get_fundamentals).not.toHaveBeenCalled();
  });

  it("falls through ProviderUnsupportedError to the next provider", async () => {
    const finnhub = stubProvider("finnhub", {
      get_fundamentals: vi.fn(async () => {
        throw new ProviderUnsupportedError("finnhub", "get_fundamentals");
      }),
    });
    const yahoo = stubProvider("yahoo", {
      get_fundamentals: vi.fn(async () => fundamentalsPayload("yahoo")),
    });
    const chain = new MultiSourceDataSource([finnhub, yahoo]);
    const result = await chain.get_fundamentals({ ticker: "NVDA", date: "2026-05-06" });
    expect(result.source).toBe("yahoo");
    expect(finnhub.get_fundamentals).toHaveBeenCalledOnce();
    expect(yahoo.get_fundamentals).toHaveBeenCalledOnce();
  });

  it("falls through arbitrary errors (e.g. 429) to the next provider", async () => {
    const finnhub = stubProvider("finnhub", {
      get_fundamentals: vi.fn(async () => {
        throw new Error("HTTP 429 Too Many Requests");
      }),
    });
    const yahoo = stubProvider("yahoo", {
      get_fundamentals: vi.fn(async () => fundamentalsPayload("yahoo")),
    });
    const chain = new MultiSourceDataSource([finnhub, yahoo]);
    const result = await chain.get_fundamentals({ ticker: "NVDA", date: "2026-05-06" });
    expect(result.source).toBe("yahoo");
  });

  it("returns an empty `unavailable` payload when every live provider fails", async () => {
    const finnhub = stubProvider("finnhub", {
      get_fundamentals: vi.fn(async () => {
        throw new Error("rate limit");
      }),
    });
    const yahoo = stubProvider("yahoo", {
      get_fundamentals: vi.fn(async () => {
        throw new Error("parse error");
      }),
    });
    const chain = new MultiSourceDataSource([finnhub, yahoo]);
    const result = await chain.get_fundamentals({ ticker: "NVDA", date: "2026-05-06" });
    expect(result.source).toBe("unavailable");
    expect(result.ticker).toBe("NVDA");
    // All numeric fields are zero — analyst gets explicit "no data" signal.
    expect(result.marketCap).toBe(0);
    expect(result.forwardPE).toBe(0);
  });

  it("returns an empty `unavailable` payload for array-shaped tools too", async () => {
    const yahoo = stubProvider("yahoo", {
      get_price_history: vi.fn(async () => {
        throw new Error("upstream down");
      }),
    });
    const chain = new MultiSourceDataSource([yahoo]);
    const result = await chain.get_price_history({
      ticker: "NVDA",
      date: "2026-05-06",
      range: "1mo",
    });
    expect(result.source).toBe("unavailable");
    expect(result.bars).toEqual([]);
  });
});
