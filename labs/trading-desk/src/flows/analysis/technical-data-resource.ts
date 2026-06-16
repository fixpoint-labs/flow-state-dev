/**
 * Session-scoped "technical" slice of the analysis data spine.
 *
 * Holds the subject's technical payloads — derived indicators
 * (`compute_indicators`) and the raw daily price bars (`get_price_history`) for
 * the canonical summary range — as the stable per-session copy. The technical
 * analyst's tools write each field via `getOrPatchState`; the valuation tap
 * reads `indicators`, and `store-price-history` reads `priceBars` instead of a
 * warm process cache. See `financials-data-resource.ts` for the pattern.
 *
 * `priceBars` holds ONLY the subject's series at the summary range
 * (`SUMMARY_PRICE_RANGE`). Other ranges — the 1-year window `compute_indicators`
 * / `get_factor_ranks` pull internally, and any peer/benchmark series — stay on
 * the args-keyed process cache (`cache.ts`); a single named field can't hold
 * them. Server-side only; fields optional (absent = not fetched yet).
 */
import { defineResource } from "@flow-state-dev/core";
import { z } from "zod";
import { toolOutputSchemas } from "./tools/schemas";

/**
 * The price-history range the Summary chart + `store-price-history` consume —
 * the default `get_price_history` range the technical analyst fetches. Only this
 * range is mirrored to the spine; other ranges stay on the process cache.
 */
export const SUMMARY_PRICE_RANGE = "1mo";

export const technicalDataStateSchema = z.object({
  indicators: toolOutputSchemas.compute_indicators.optional(),
  priceBars: toolOutputSchemas.get_price_history.optional(),
});

export type TechnicalDataState = z.infer<typeof technicalDataStateSchema>;

export const technicalDataResource = defineResource({
  scope: "session",
  ref: "technicalData",
  stateSchema: technicalDataStateSchema,
  default: {},
});
