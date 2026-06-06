/**
 * Tests for the price-history tap (Slice 3, spec 06 §4).
 *
 * Intent encoded:
 *   1. In fixture mode the tap patches the `priceHistory` resource from the
 *      pinned fixture, thinning each bar to { date, close } and echoing the
 *      provenance `source` tag. This is what lets the Summary draw a real
 *      series with zero re-run.
 *   2. On a live cache MISS the tap leaves the resource null — it never fetches
 *      (no extra network), never substitutes fixture data (BP-020), so the
 *      Summary degrades to trade-levels-only rather than showing a fake line.
 *
 * Driven through `testFlow` against an in-memory store, then the persisted
 * single-resource state is read back via `stores.resourceState.getAll` (the
 * same inspection path the past-reports spine test uses).
 */
import { describe, expect, it } from "vitest";
import { defineFlow } from "@flow-state-dev/core";
import { createInMemoryStores } from "@flow-state-dev/server";
import { testFlow } from "@flow-state-dev/testing";
import { storePriceHistory } from "../src/flows/analysis/store-price-history";
import { priceHistoryResource } from "../src/flows/analysis/price-history-resource";
import { sessionStateSchema } from "../src/flows/analysis/state";
import { _resetCache } from "../src/flows/analysis/tools/runtime/cache";

const priceFlow = defineFlow({
  kind: "trading-desk-price-history-test",
  actions: {
    storePrices: { block: storePriceHistory },
  },
  session: { stateSchema: sessionStateSchema },
  resources: {
    priceHistory: priceHistoryResource,
  },
})({ id: "test" });

const baseState = {
  ticker: "NVDA",
  date: "2026-05-06",
  costPreset: "fast" as const,
  dataSource: "fixture" as const,
  activePhase: "phase-1" as const,
  maxDebateRounds: 1,
  memoStatus: {},
  runComplete: false,
};

type StoredSlice = {
  ticker?: string;
  range?: string;
  source?: string;
  bars?: Array<{ date: string; close: number }>;
};

async function readSlice(
  stores: ReturnType<typeof createInMemoryStores>,
  sessionId: string,
): Promise<StoredSlice | null | undefined> {
  const resources = await stores.resourceState.getAll("session", sessionId);
  return resources["priceHistory"] as StoredSlice | null | undefined;
}

describe("storePriceHistory tap", () => {
  it("fixture mode: patches a thinned { date, close } series + provenance source", async () => {
    _resetCache();
    const stores = createInMemoryStores();
    const sessionId = "prices-fixture";

    const result = await testFlow({
      flow: priceFlow,
      action: "storePrices",
      userId: "test-user",
      sessionId,
      stores,
      input: {},
      seed: { session: { state: baseState } },
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe("completed");

    const slice = await readSlice(stores, sessionId);
    expect(slice).toBeTruthy();
    expect(slice?.ticker).toBe("NVDA");
    // Fixture loader stamps source: "fixture".
    expect(slice?.source).toBe("fixture");
    expect(Array.isArray(slice?.bars)).toBe(true);
    expect((slice?.bars?.length ?? 0)).toBeGreaterThan(1);
    // Each bar is thinned to exactly date + close — no OHLCV leakage.
    const first = slice?.bars?.[0];
    expect(first).toBeDefined();
    expect(Object.keys(first ?? {}).sort()).toEqual(["close", "date"]);
    expect(typeof first?.close).toBe("number");
    expect(typeof first?.date).toBe("string");
  });

  it("live mode cache miss: leaves the resource null — no fetch, no substitution", async () => {
    _resetCache();
    const stores = createInMemoryStores();
    const sessionId = "prices-live-miss";

    const result = await testFlow({
      flow: priceFlow,
      action: "storePrices",
      userId: "test-user",
      sessionId,
      stores,
      input: {},
      seed: {
        session: { state: { ...baseState, dataSource: "live" as const } },
      },
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe("completed");

    // Cold cache in live mode → the tap's fetcher throws → resource stays null.
    const slice = await readSlice(stores, sessionId);
    expect(slice == null).toBe(true);
  });
});
