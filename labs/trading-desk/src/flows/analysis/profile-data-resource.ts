/**
 * Session-scoped "profile" slice of the analysis data spine.
 *
 * Holds the subject's business-identity profile (`get_company_profile`) — name,
 * sector, industry, scale — as the stable per-session copy. The profile tool
 * writes it once via `getOrPatchState`; the valuation tap reads `sector` from
 * it instead of a warm process cache. See `financials-data-resource.ts` for the
 * pattern. Server-side only; field optional (absent = not fetched yet).
 */
import { defineResource } from "@flow-state-dev/core";
import { z } from "zod";
import { toolOutputSchemas } from "./tools/schemas";

export const profileDataStateSchema = z.object({
  companyProfile: toolOutputSchemas.get_company_profile.optional(),
});

export type ProfileDataState = z.infer<typeof profileDataStateSchema>;

export const profileDataResource = defineResource({
  scope: "session",
  ref: "profileData",
  stateSchema: profileDataStateSchema,
  default: {},
});
