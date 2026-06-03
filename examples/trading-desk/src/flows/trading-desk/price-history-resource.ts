/**
 * Session-scoped resource holding a thinned price-history slice for the Summary
 * page's price overlay chart.
 *
 * Written once by the `storePriceHistory` tap after Phase 1 (it reads the warm
 * tool cache / fixture — no extra network call, never a generator output, so
 * BP-016 does not bind it). Read client-side via `useResource(session,
 * "priceHistory")`, mirroring how the app reads `valuationSpine`.
 *
 * Only `date` + `close` per bar are persisted — the overlay draws a line, not
 * candles — to keep the client payload lean. `source` carries the tool's
 * provenance tag so the UI can mark a `"unavailable"` slice as missing signal,
 * never a real series (real-money provenance gate). State is `.nullable()` with
 * `default: null`: null means "no series for this run" and the chart degrades to
 * a trade-levels view.
 *
 * Kept in its own leaf file importing only core + zod so the
 * capability↔resource graph stays cycle-free (BP-019).
 */
import { defineResource } from "@flow-state-dev/core";
import { z } from "zod";

/** Thinned daily close series + provenance, persisted for the price overlay. */
export const priceHistorySliceSchema = z.object({
  ticker: z.string(),
  range: z.string(),
  /** Provenance tag echoed from the tool ("fixture"|"finnhub"|"yahoo"|"unavailable"). */
  source: z.string(),
  bars: z.array(z.object({ date: z.string(), close: z.number() })),
});

export type PriceHistorySlice = z.infer<typeof priceHistorySliceSchema>;

export const priceHistoryResource = defineResource({
  scope: "session",
  ref: "priceHistory",
  stateSchema: priceHistorySliceSchema.nullable(),
  default: null,
  writable: true,
});
