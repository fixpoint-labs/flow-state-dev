/**
 * Unit tests for the `getOrFetch` cache helper. Covers:
 *   - cache miss → fetcher runs, resource is written, payload returns
 *   - cache hit  → fetcher does not run, resource payload is returned
 *   - parallel callers within one process dedupe to a single fetch
 */
import { describe, expect, it, vi } from "vitest";
import { getOrFetch, cacheKey } from "../src/flows/trading-desk/blocks/tools/cache";
import type { ToolOutput } from "../src/flows/trading-desk/blocks/tools/data-source";

type StoredResource = {
  state: { payload: unknown };
  patchState: (patch: Record<string, unknown>) => Promise<void>;
};

function makeCtx(sessionId = "sess-1") {
  const store = new Map<string, StoredResource>();
  const ctx = {
    session: { identity: { id: sessionId } },
    resources: {
      marketdata: {
        getOptional: (key: string) => store.get(key),
        create: vi.fn(async (key: string, state: Record<string, unknown>) => {
          store.set(key, {
            state: { payload: state.payload },
            patchState: async () => undefined,
          });
        }),
      },
    },
  };
  return { ctx, store };
}

function fundPayload(source: "fixture" | "yahoo" | "finnhub" = "yahoo"): ToolOutput<"get_fundamentals"> {
  return {
    source,
    ticker: "NVDA",
    asOf: "2026-05-06",
    marketCap: 1,
    forwardPE: 1,
    priceToSales: 1,
    returnOnEquity: 1,
    operatingMargin: 1,
    grossMargin: 1,
  };
}

describe("getOrFetch", () => {
  it("builds a deterministic cache key per (tool, ticker, date)", () => {
    expect(cacheKey("get_fundamentals", { ticker: "NVDA", date: "2026-05-06" })).toBe(
      "marketdata/get_fundamentals/NVDA/2026-05-06",
    );
    expect(
      cacheKey("get_price_history", { ticker: "NVDA", date: "2026-05-06", range: "3mo" }),
    ).toBe("marketdata/get_price_history/NVDA/2026-05-06/3mo");
    expect(cacheKey("get_macro_indicators", { date: "2026-05-06" } as never)).toBe(
      "marketdata/get_macro_indicators/_macro/2026-05-06",
    );
  });

  it("invokes the fetcher on miss and writes the resource", async () => {
    const { ctx } = makeCtx();
    const fetcher = vi.fn(async () => fundPayload("yahoo"));
    const result = await getOrFetch(
      ctx,
      "get_fundamentals",
      { ticker: "NVDA", date: "2026-05-06" },
      fetcher,
    );
    expect(result.source).toBe("yahoo");
    expect(fetcher).toHaveBeenCalledOnce();
    expect(ctx.resources.marketdata.create).toHaveBeenCalledOnce();
    const [, payload] = ctx.resources.marketdata.create.mock.calls[0]!;
    expect(payload.provider).toBe("yahoo");
    expect(payload.tool).toBe("get_fundamentals");
  });

  it("returns the cached payload without re-invoking the fetcher", async () => {
    const { ctx } = makeCtx();
    const fetcher = vi.fn(async () => fundPayload("yahoo"));
    await getOrFetch(ctx, "get_fundamentals", { ticker: "NVDA", date: "2026-05-06" }, fetcher);
    fetcher.mockClear();
    const result = await getOrFetch(
      ctx,
      "get_fundamentals",
      { ticker: "NVDA", date: "2026-05-06" },
      fetcher,
    );
    expect(result.source).toBe("yahoo");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("dedupes parallel callers to one fetcher invocation", async () => {
    // Use a fresh session id so the in-process dedup map keys don't collide
    // with prior tests.
    const { ctx } = makeCtx("sess-parallel");
    let resolveFetch!: (v: ToolOutput<"get_fundamentals">) => void;
    const fetcher = vi.fn(
      () =>
        new Promise<ToolOutput<"get_fundamentals">>((r) => {
          resolveFetch = r;
        }),
    );
    const p1 = getOrFetch(ctx, "get_fundamentals", { ticker: "NVDA", date: "2026-05-06" }, fetcher);
    const p2 = getOrFetch(ctx, "get_fundamentals", { ticker: "NVDA", date: "2026-05-06" }, fetcher);
    // Both should share the same in-flight promise — fetcher fires exactly once.
    resolveFetch(fundPayload("finnhub"));
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.source).toBe("finnhub");
    expect(r2.source).toBe("finnhub");
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
