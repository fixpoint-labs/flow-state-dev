/**
 * Unit tests for the process-wide TTL cache (`getOrFetch`). Covers:
 *   - cache miss → fetcher runs, value returns
 *   - cache hit → fetcher is not called again
 *   - parallel callers dedupe to one fetcher invocation
 *   - stable cache key derivation
 *   - TTL expiry triggers a re-fetch
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  _resetCache,
  cacheKey,
  getOrFetch,
} from "../src/flows/trading-desk/lib/cache";

afterEach(() => {
  _resetCache();
  vi.useRealTimers();
});

describe("getOrFetch", () => {
  it("invokes the fetcher on a cold key and returns its value", async () => {
    const fetcher = vi.fn(async () => "value-1");
    const result = await getOrFetch("test_tool", { ticker: "NVDA", date: "2026-05-06" }, fetcher);
    expect(result).toBe("value-1");
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("returns the cached value without re-invoking the fetcher", async () => {
    const fetcher = vi.fn(async () => "value-1");
    await getOrFetch("test_tool", { ticker: "NVDA", date: "2026-05-06" }, fetcher);
    fetcher.mockClear();
    const result = await getOrFetch("test_tool", { ticker: "NVDA", date: "2026-05-06" }, fetcher);
    expect(result).toBe("value-1");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("dedupes parallel callers to one fetcher invocation", async () => {
    let resolveFetch!: (v: string) => void;
    const fetcher = vi.fn(
      () => new Promise<string>((r) => { resolveFetch = r; }),
    );
    const args = { ticker: "AAPL", date: "2026-05-06" };
    const p1 = getOrFetch("test_tool", args, fetcher);
    const p2 = getOrFetch("test_tool", args, fetcher);
    resolveFetch("value-shared");
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe("value-shared");
    expect(r2).toBe("value-shared");
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("different args produce different cache entries", async () => {
    const fetcher = vi.fn(async () => "fetched");
    await getOrFetch("test_tool", { ticker: "NVDA", date: "2026-05-06" }, fetcher);
    await getOrFetch("test_tool", { ticker: "AAPL", date: "2026-05-06" }, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("expires the cached entry after the TTL window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-06T00:00:00Z"));
    const fetcher = vi.fn(async () => "fresh");
    await getOrFetch("test_tool", { ticker: "NVDA", date: "2026-05-06" }, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    // Within TTL — still cached.
    vi.setSystemTime(new Date("2026-05-06T00:01:30Z"));
    await getOrFetch("test_tool", { ticker: "NVDA", date: "2026-05-06" }, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    // Past TTL — re-fetch.
    vi.setSystemTime(new Date("2026-05-06T00:03:00Z"));
    await getOrFetch("test_tool", { ticker: "NVDA", date: "2026-05-06" }, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("builds a deterministic cache key from tool + args", () => {
    expect(cacheKey("get_fundamentals", { ticker: "NVDA", date: "2026-05-06" })).toBe(
      'get_fundamentals:{"ticker":"NVDA","date":"2026-05-06"}',
    );
    expect(cacheKey("get_price_history", { ticker: "NVDA", date: "2026-05-06", range: "1y" })).toBe(
      'get_price_history:{"ticker":"NVDA","date":"2026-05-06","range":"1y"}',
    );
  });
});
