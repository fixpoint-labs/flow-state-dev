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
 * substitutes or invents a series (BP-020 / real-money provenance gate) — and
 * it WARNS with the reason, so a missing chart is diagnosable from the run's
 * trace instead of being inferred from its absence.
 *
 * A miss and a genuine provider gap are different states and stay so: an
 * "unavailable" fetch still yields a bars array (empty), so it is PERSISTED
 * with its `source` provenance and the chart degrades via `ChartEmpty`. Only a
 * spine that was never written reaches the warn path.
 */
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import {
  priceHistoryResource,
  type PriceHistorySlice,
} from "./price-history-resource";
import { technicalDataResource, SUMMARY_PRICE_RANGE } from "./technical-data-resource";
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
    // Leave the resource null on any miss — the chart degrades cleanly — but say
    // WHY on the way out. The bare `return` here made a run whose chart silently
    // vanished indistinguishable, after the fact, from a run whose provider
    // genuinely had no bars; the reason line is what makes the two tellable
    // apart in a trace (`fsdev run` captures stderr) without re-running.
    if (payload === undefined || payload.bars === undefined) {
      const reason =
        payload === undefined
          ? `no \`priceBars\` on the session technical spine — the technical analyst's get_price_history never wrote it (its step errored, or it fetched a ticker/range other than ${ticker} at ${SUMMARY_PRICE_RANGE})`
          : "the spine's `priceBars` payload carries no `bars` array";
      console.warn(
        `[trading-desk] store-price-history: no price series persisted for ${ticker} — ${reason}. Summary falls back to trade levels.`,
      );
      return;
    }
    const slice: PriceHistorySlice = {
      ticker,
      range: payload.range ?? "",
      source: payload.source ?? "unavailable",
      bars: payload.bars.map((b) => ({ date: b.date, close: b.close })),
    };
    await ctx.resources.priceHistory.patchState(slice);
  },
});
