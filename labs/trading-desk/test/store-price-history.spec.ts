/**
 * Tests for the price-history tap (Slice 3, spec 06 §4; FIX-758 spine migration).
 *
 * Intent encoded:
 *   1. The tap reads the subject's price bars off the `technicalData` spine —
 *      the technical analyst's `get_price_history` wrote them there in Phase 1 —
 *      and patches the `priceHistory` resource, thinning each bar to
 *      { date, close } and echoing the provenance `source`. This is what lets
 *      the Summary draw a real series with zero re-run.
 *   2. When the spine field is absent (the analyst never populated it) the tap
 *      leaves the resource null — it never fetches (no extra network), never
 *      substitutes fixture data (BP-020), so the Summary degrades to
 *      trade-levels-only rather than showing a fake line.
 *
 * Driven through `testFlow` against an in-memory store, then the persisted
 * single-resource state is read back via `stores.resourceState.getAll`.
 */
import { describe, expect, it } from "vitest";
import { defineFlow } from "@flow-state-dev/core";
import { createInMemoryStores, toStates } from "@flow-state-dev/engine";
import { testFlow } from "@flow-state-dev/testing";
import { storePriceHistory } from "../flows/analysis/store-price-history";
import { get_price_history } from "../flows/analysis/tools/data/get_price_history";
import { priceHistoryResource } from "../flows/analysis/price-history-resource";
import { technicalDataResource } from "../flows/analysis/technical-data-resource";
import { sessionStateSchema } from "../flows/analysis/state";

const priceFlow = defineFlow({
  kind: "trading-desk-price-history-test",
  actions: {
    fetchPrices: { block: get_price_history },
    storePrices: { block: storePriceHistory },
  },
  session: { stateSchema: sessionStateSchema },
  resources: {
    priceHistory: priceHistoryResource,
    technicalData: technicalDataResource,
  },
})({ id: "test" });

const baseState = {
  ticker: "NVDA",
  date: "2026-05-06",
  costPreset: "fast" as const,
  dataSource: "fixture" as const,
  activePhase: "phase-1" as const,
  maxDebateRounds: 1,
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
  const resources = toStates(await stores.resourceState.getAll("session", sessionId));
  return resources["priceHistory"] as StoredSlice | null | undefined;
}

describe("storePriceHistory tap", () => {
  it("fixture mode: reads the spine's price bars, patches a thinned { date, close } series + provenance source", async () => {
    const stores = createInMemoryStores();
    const sessionId = "prices-fixture";

    // Phase 1: the technical analyst's get_price_history populates the spine.
    const fetched = await testFlow({
      flow: priceFlow,
      action: "fetchPrices",
      userId: "test-user",
      sessionId,
      stores,
      input: { ticker: "NVDA", date: "2026-05-06" },
      seed: { session: { state: baseState } },
    });
    expect(fetched.error).toBeUndefined();

    // Post-Phase-1 tap reads the spine and thins it.
    const result = await testFlow({
      flow: priceFlow,
      action: "storePrices",
      userId: "test-user",
      sessionId,
      stores,
      input: {},
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

  it("spine miss: leaves the resource null — no fetch, no substitution", async () => {
    const stores = createInMemoryStores();
    const sessionId = "prices-spine-miss";

    // No fetchPrices ran, so technicalData.priceBars is absent.
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

    // Spine field absent → the tap leaves the resource null.
    const slice = await readSlice(stores, sessionId);
    expect(slice == null).toBe(true);
  });
});
