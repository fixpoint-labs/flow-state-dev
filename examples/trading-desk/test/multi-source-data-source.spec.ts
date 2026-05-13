/**
 * Unit tests for `MultiSourceDataSource` — covers the provider-chain fallback
 * behavior: provider-unsupported errors fall through, transient errors fall
 * through, the fixture floor always answers.
 */
import { describe, expect, it, vi } from "vitest";
import path from "node:path";
import { FixtureDataSource } from "../src/flows/trading-desk/blocks/tools/fixture-data-source";
import { MultiSourceDataSource } from "../src/flows/trading-desk/blocks/tools/multi-source-data-source";
import { ProviderUnsupportedError } from "../src/flows/trading-desk/blocks/tools/yahoo-data-source";
import type {
  DataSource,
  ToolInput,
  ToolOutput,
} from "../src/flows/trading-desk/blocks/tools/data-source";

const FIXTURE_ROOT = path.resolve(__dirname, "..", "fixtures");

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

  it("lands on the fixture floor when all live providers fail", async () => {
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
    const fixture = new FixtureDataSource({ rootDir: FIXTURE_ROOT });
    const chain = new MultiSourceDataSource([finnhub, yahoo, fixture]);
    const result = await chain.get_fundamentals({ ticker: "NVDA", date: "2026-05-06" });
    expect(result.source).toBe("fixture");
    expect(result.ticker).toBe("NVDA");
  });

  it("aggregates error messages when every provider fails", async () => {
    const bad1 = stubProvider("finnhub", {
      get_fundamentals: vi.fn(async () => {
        throw new Error("err-1");
      }),
    });
    const bad2 = stubProvider("yahoo", {
      get_fundamentals: vi.fn(async () => {
        throw new Error("err-2");
      }),
    });
    const chain = new MultiSourceDataSource([bad1, bad2]);
    await expect(
      chain.get_fundamentals({ ticker: "NVDA", date: "2026-05-06" }),
    ).rejects.toThrow(/finnhub: err-1.*yahoo: err-2/);
  });
});
