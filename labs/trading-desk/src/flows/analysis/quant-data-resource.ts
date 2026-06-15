/**
 * Session-scoped "quant" slice of the analysis data spine.
 *
 * Holds the subject's quant-composite payloads — Altman/Piotroski composites
 * (`get_quant_composites`) and cross-sectional factor ranks (`get_factor_ranks`)
 * — as the stable per-session copy the run used. The quant analyst's tools write
 * each field once via `getOrPatchState`; the valuation tap reads that copy
 * instead of a warm process cache. See `financials-data-resource.ts` for the
 * pattern. Server-side only; fields optional (absent = not fetched yet).
 *
 * Note: `get_factor_ranks` internally fetches PEER fundamentals/prices through
 * the process cache — those multi-ticker fetches stay on `cache.ts`; only the
 * subject-scoped tool OUTPUT lands here.
 */
import { defineResource } from "@flow-state-dev/core";
import { z } from "zod";
import { toolOutputSchemas } from "./tools/schemas";

export const quantDataStateSchema = z.object({
  quantComposites: toolOutputSchemas.get_quant_composites.optional(),
  factorRanks: toolOutputSchemas.get_factor_ranks.optional(),
});

export type QuantDataState = z.infer<typeof quantDataStateSchema>;

export const quantDataResource = defineResource({
  scope: "session",
  ref: "quantData",
  stateSchema: quantDataStateSchema,
  default: {},
});
