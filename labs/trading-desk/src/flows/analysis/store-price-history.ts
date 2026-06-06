/**
 * Post-Phase-1 tap: persists a thinned price-history slice to the session-scoped
 * `priceHistoryResource` for the Summary page's price overlay.
 *
 * Reads the SAME warm tool cache (`getOrFetch`) the Phase 1 technical analyst's
 * `get_price_history` populated — no extra network call in live mode, no
 * `block.run()` (BP-011). In fixture mode reads directly from `loadFixture`.
 * Modeled on `computeAndStoreSpine` (compute-spine.ts).
 *
 * It is a `.tap()`: no output, no `return input` (BP-012/BP-014). On any miss
 * (cache cold, fixture absent, payload missing bars) it leaves the resource
 * `null` so the Summary's price panel degrades to a trade-levels-only view —
 * it never substitutes or invents a series (BP-020 / real-money provenance gate).
 */
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { getOrFetch } from "./tools/runtime/cache";
import { loadFixture } from "./tools/runtime/fixtures";
import {
  priceHistoryResource,
  type PriceHistorySlice,
} from "./resources/price-history";
import { sessionStateSchema } from "./state";

export const storePriceHistory = handler({
  name: "store-price-history",
  inputSchema: z.unknown(),
  outputSchema: z.void(),
  sessionStateSchema,
  resources: { priceHistory: priceHistoryResource },
  execute: async (_input, ctx) => {
    const { ticker, date, dataSource } = ctx.session.state;
    const args = { ticker, date };
    type RawPayload = {
      source?: string;
      range?: string;
      bars?: Array<{ date: string; close: number }>;
    };
    let payload: RawPayload | null = null;
    try {
      const raw =
        dataSource === "fixture"
          ? await loadFixture("get_price_history", args)
          : await getOrFetch("get_price_history", args, async () => {
              throw new Error("cache miss — expected warm cache after Phase 1");
            });
      payload = raw as RawPayload;
    } catch {
      payload = null;
    }
    // Leave the resource null on any miss — the chart degrades cleanly.
    if (payload === null || payload.bars === undefined) return;
    const slice: PriceHistorySlice = {
      ticker,
      range: payload.range ?? "",
      source: payload.source ?? "unavailable",
      bars: payload.bars.map((b) => ({ date: b.date, close: b.close })),
    };
    await ctx.resources.priceHistory.patchState(slice);
  },
});
