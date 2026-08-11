/**
 * Pre-Phase-1 tap: resolve the subject's business identity once, before the
 * analyst bench fans out (FIX-779).
 *
 * The eight `discover_*_context` tools validate their web-search results
 * against the company they are supposed to be about. That check needs a
 * trusted name, and it needs it BEFORE the fan-out — the profile analyst's
 * `get_company_profile` runs inside the same `.parallel` as every discovery
 * tool, so reading the profile from inside a discovery tool would be a race
 * (sometimes validated, sometimes not, on a real-money surface).
 *
 * So the identity is resolved here and written to the SAME session spine field
 * `get_company_profile` writes (`profileData.companyProfile`, via
 * `getOrPatchState`). That makes this a warm-up, not an extra fetch: the
 * profile analyst's later call reads this copy back instead of fetching again,
 * and record mode still captures the payload from the tool. Both writers share
 * one loader (`loadCompanyProfile`) so the stored payload is identical either
 * way.
 *
 * Gated on `costPreset === "full"` at the call site: discovery is skipped
 * entirely on `fast`, so there is nothing to validate and nothing to warm.
 *
 * Fails soft. A provider outage or a missing fixture leaves the spine field
 * absent, the discovery payloads tag themselves `entityCheck: "unchecked"`,
 * and `get_company_profile` retries inside the fan-out exactly as before. An
 * unresolved identity must never stop a run or drop discovery results — the
 * check degrades to honest "unverified", never to a false negative.
 */
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { profileDataResource } from "./profile-data-resource";
import { sessionStateSchema } from "./state";
import { loadCompanyProfile } from "./tools/data/get_company_profile";
import { pickMode } from "./tools/schemas";

export const resolveSubjectEntity = handler({
  name: "resolve-subject-entity",
  inputSchema: z.unknown(),
  outputSchema: z.void(),
  sessionStateSchema,
  resources: { profileData: profileDataResource },
  execute: async (_input, ctx) => {
    const { ticker, date } = ctx.session.state;
    try {
      await ctx.resources.profileData.getOrPatchState("companyProfile", () =>
        loadCompanyProfile({ ticker, date }, pickMode(ctx)),
      );
    } catch {
      // Fail soft — see the file header.
    }
  },
});
