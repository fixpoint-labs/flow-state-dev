/**
 * Post-Phase-1 tap: persists a thinned price-history slice to the session-scoped
 * `priceHistoryResource` for the Summary page's price overlay.
 *
 * Reads the subject's raw price bars off the session `technicalData` spine — the
 * Phase 1 technical analyst's `get_price_history` wrote them there (at the
 * summary range) via `getOrPatchState`. No extra network call, no `block.run()`
 * (BP-011), no warm-cache dependency.
 *
 * It is a `.tap()`: no output, no `return input` (BP-012/BP-014). On any miss
 * (spine field absent, payload missing bars) it leaves the resource `null` so
 * the Summary's price panel degrades to a trade-levels-only view — it never
 * substitutes or invents a series (BP-020 / real-money provenance gate).
 */
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import {
  priceHistoryResource,
  type PriceHistorySlice,
} from "./price-history-resource";
import { technicalDataResource } from "./technical-data-resource";
import { sessionStateSchema } from "./state";

export const storePriceHistory = handler({
  name: "store-price-history",
  inputSchema: z.unknown(),
  outputSchema: z.void(),
  sessionStateSchema,
  resources: {
    priceHistory: priceHistoryResource,
    technicalData: technicalDataResource,
  },
  execute: async (_input, ctx) => {
    const { ticker } = ctx.session.state;
    const payload = ctx.resources.technicalData.state.priceBars as
      | { source?: string; range?: string; bars?: Array<{ date: string; close: number }> }
      | undefined;
    // Leave the resource null on any miss — the chart degrades cleanly.
    if (payload === undefined || payload.bars === undefined) return;
    const slice: PriceHistorySlice = {
      ticker,
      range: payload.range ?? "",
      source: payload.source ?? "unavailable",
      bars: payload.bars.map((b) => ({ date: b.date, close: b.close })),
    };
    await ctx.resources.priceHistory.patchState(slice);
  },
});
