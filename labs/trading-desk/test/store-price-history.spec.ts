/**
 * Tests for the price-history tap (Slice 3, spec 06 §4; FIX-758 spine migration;
 * FIX-782 observable misses).
 *
 * Intent encoded:
 *   1. The tap reads the subject's price bars off the `technicalData` spine —
 *      the technical analyst's `get_price_history` wrote them there in Phase 1 —
 *      and patches the `priceHistory` resource, thinning each bar to
 *      { date, close } and echoing the provenance `source`. This is what lets
 *      the Summary draw a real series with zero re-run.
 *   2. When the spine field is absent the tap leaves the resource null — never
 *      fetching, never substituting fixture data (BP-020) — AND says why. A
 *      chart that vanishes must be diagnosable from the run's trace; the silent
 *      `return` is what made the filed miss corpus unexplainable after the fact.
 *   3. Only the SUBJECT's series at the summary range may become the chart, so a
 *      peer or off-range probe can never be persisted mislabeled as the
 *      subject's price history (real-money provenance gate). These two are the
 *      regression guard on the tempting "just widen the spine gate so the tap
 *      always finds something" fix, which would hand a caller another ticker's —
 *      or another range's — bars.
 *   4. A miss and a genuine provider gap are DIFFERENT states: an "unavailable"
 *      fetch yields an empty bars array, which is persisted with its provenance
 *      rather than warned about or dropped.
 *
 * Driven through `testFlow` against an in-memory store, then the persisted
 * single-resource state is read back via `stores.resourceState.getAll`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import { createInMemoryStores, toBareStates } from "@flow-state-dev/engine";
import { testFlow } from "@flow-state-dev/testing";
import { storePriceHistory } from "../flows/analysis/store-price-history";
import { get_price_history } from "../flows/analysis/tools/data/get_price_history";
import { priceHistoryResource } from "../flows/analysis/price-history-resource";
import {
  technicalDataResource,
  SUMMARY_PRICE_RANGE,
} from "../flows/analysis/technical-data-resource";
import { sessionStateSchema } from "../flows/analysis/state";

/**
 * Test-only writer: plant a payload directly on the technical spine, standing
 * in for a Phase 1 fetch whose provider came back empty. `bars` is optional
 * ONLY so a test can attempt the malformed write the tap deliberately does not
 * guard against (see the boundary test below).
 */
const seedSpineBars = handler({
  name: "seed-spine-bars",
  inputSchema: z.object({
    source: z.string(),
    ticker: z.string(),
    range: z.string(),
    bars: z.array(z.object({ date: z.string(), close: z.number() })).optional(),
  }),
  outputSchema: z.void(),
  resources: { technicalData: technicalDataResource },
  execute: async (input, ctx) => {
    await ctx.resources.technicalData.patchState({
      priceBars: input as NonNullable<
        Parameters<typeof ctx.resources.technicalData.patchState>[0]
      >["priceBars"],
    });
  },
});

const priceFlow = defineFlow({
  kind: "trading-desk-price-history-test",
  actions: {
    fetchPrices: { block: get_price_history },
    storePrices: { block: storePriceHistory },
    seedSpine: { block: seedSpineBars },
  },
  session: { stateSchema: sessionStateSchema },
  resources: {
    priceHistory: priceHistoryResource,
    technicalData: technicalDataResource,
  },
})({ id: "test" });

afterEach(() => {
  vi.restoreAllMocks();
});

/** Capture the tap's stderr reason lines without printing them in test output. */
function captureWarnings(): { lines: () => string[] } {
  const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
  return { lines: () => spy.mock.calls.map((c) => String(c[0])) };
}

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
  const resources = toBareStates(await stores.resourceState.getAll("session", sessionId));
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

  it("spine miss: leaves the resource null — no fetch, no substitution — and reports the reason", async () => {
    const stores = createInMemoryStores();
    const sessionId = "prices-spine-miss";
    const warnings = captureWarnings();

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

    // ...and it is NOT silent: the run's trace carries the subject and the
    // reason, so a chartless report is diagnosable without re-running it.
    const lines = warnings.lines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("store-price-history");
    expect(lines[0]).toContain("NVDA");
    expect(lines[0]).toContain("priceBars");
  });

  it("peer probe: another ticker's fetch never becomes the subject's chart", async () => {
    const stores = createInMemoryStores();
    const sessionId = "prices-peer-probe";
    const warnings = captureWarnings();

    // A peer/benchmark probe during a NVDA session. `toSpine` is false, so this
    // lands on the args-keyed process cache and the spine stays empty.
    const fetched = await testFlow({
      flow: priceFlow,
      action: "fetchPrices",
      userId: "test-user",
      sessionId,
      stores,
      input: { ticker: "AAPL", date: "2026-05-06" },
      seed: { session: { state: baseState } },
    });
    expect(fetched.error).toBeUndefined();

    const result = await testFlow({
      flow: priceFlow,
      action: "storePrices",
      userId: "test-user",
      sessionId,
      stores,
      input: {},
    });
    expect(result.error).toBeUndefined();

    // The real-money gate: rather than persist AAPL's bars under NVDA's ticker,
    // the tap persists NOTHING and says so.
    const slice = await readSlice(stores, sessionId);
    expect(slice == null).toBe(true);
    const lines = warnings.lines();
    expect(lines).toHaveLength(1);
    // The reason names the SUBJECT, never the peer that was probed — a line
    // reading "AAPL" would be the mislabel this gate exists to prevent.
    expect(lines[0]).toContain("NVDA");
    expect(lines[0]).not.toContain("AAPL");
  });

  it("off-range probe: a non-summary range never becomes the subject's chart", async () => {
    const stores = createInMemoryStores();
    const sessionId = "prices-off-range";
    const warnings = captureWarnings();

    // The subject, but at the 1-year window the indicator/factor tools pull.
    // Only SUMMARY_PRICE_RANGE reaches the spine — one named field cannot hold
    // two ranges, and serving this one as the chart would mislabel it.
    const fetched = await testFlow({
      flow: priceFlow,
      action: "fetchPrices",
      userId: "test-user",
      sessionId,
      stores,
      input: { ticker: "NVDA", date: "2026-05-06", range: "1y" },
      seed: { session: { state: baseState } },
    });
    expect(fetched.error).toBeUndefined();

    const result = await testFlow({
      flow: priceFlow,
      action: "storePrices",
      userId: "test-user",
      sessionId,
      stores,
      input: {},
    });
    expect(result.error).toBeUndefined();

    const slice = await readSlice(stores, sessionId);
    expect(slice == null).toBe(true);
    const lines = warnings.lines();
    expect(lines).toHaveLength(1);
    // The reason names the range the chart actually needs (1mo), so a reader
    // can tell this from "the analyst never ran" — the 1y probe did run.
    expect(lines[0]).toContain(SUMMARY_PRICE_RANGE);
  });

  it("provider gap: an empty-bars slice is persisted with its provenance, not warned away", async () => {
    const stores = createInMemoryStores();
    const sessionId = "prices-provider-gap";
    const warnings = captureWarnings();

    // The analyst DID fetch; the provider had nothing. That is a genuine data
    // gap, not a persistence miss — it must survive to the report so the chart
    // can degrade to ChartEmpty with honest provenance.
    const seeded = await testFlow({
      flow: priceFlow,
      action: "seedSpine",
      userId: "test-user",
      sessionId,
      stores,
      input: { source: "unavailable", ticker: "NVDA", range: "1mo", bars: [] },
      seed: { session: { state: { ...baseState, dataSource: "live" as const } } },
    });
    expect(seeded.error).toBeUndefined();

    const result = await testFlow({
      flow: priceFlow,
      action: "storePrices",
      userId: "test-user",
      sessionId,
      stores,
      input: {},
    });
    expect(result.error).toBeUndefined();

    const slice = await readSlice(stores, sessionId);
    expect(slice).toBeTruthy();
    expect(slice?.source).toBe("unavailable");
    expect(slice?.bars).toEqual([]);
    // A real gap is already self-describing via `source` — no miss warning.
    expect(warnings.lines()).toHaveLength(0);
  });

  it("spine boundary: a bars-less payload never reaches the spine, so present always means usable", async () => {
    const stores = createInMemoryStores();
    const sessionId = "prices-barsless";
    const warnings = captureWarnings();

    // Why this test exists: the tap checks only for an ABSENT `priceBars`, with
    // no second guard for a present-but-bars-less payload. That is safe only
    // because the spine's own schema requires `bars` — the resource boundary
    // drops such a patch outright. Pinning it here means loosening that schema
    // fails loudly instead of turning the tap's `payload.bars.map` into a
    // mid-run TypeError.
    const seeded = await testFlow({
      flow: priceFlow,
      action: "seedSpine",
      userId: "test-user",
      sessionId,
      stores,
      input: { source: "yahoo", ticker: "NVDA", range: "1mo" },
      seed: { session: { state: { ...baseState, dataSource: "live" as const } } },
    });
    expect(seeded.error).toBeUndefined();

    // The malformed payload was rejected at the boundary — the spine is empty.
    const spine = toBareStates(await stores.resourceState.getAll("session", sessionId));
    expect(spine["technicalData"]).toBeUndefined();

    // So the tap sees a plain absence and degrades exactly as it does on a miss.
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
    expect(await readSlice(stores, sessionId)).toBeUndefined();
    expect(warnings.lines()).toHaveLength(1);
  });
});
