/**
 * Business-identity profile (name, sector, industry, business description,
 * scale). Live: Finnhub `/stock/profile2` preferred, Yahoo `assetProfile`
 * fallback. Fixture: curated per-ticker JSON.
 *
 * Yahoo carries the long business description and sector; Finnhub does not.
 * Both providers are tried so a Yahoo outage still leaves identity grounded.
 */
import { handler } from "@flow-state-dev/core";
import { getOrFetch } from "../../services/cache";
import { fetchFinnhubCompanyProfile, hasFinnhubKey } from "../../services/finnhub";
import { loadFixture } from "../../services/fixtures";
import { fetchYahooCompanyProfile } from "../../services/yahoo";
import { emptyPayload } from "./empty-payloads";
import { pickMode, toolInputSchemas, toolOutputSchemas } from "./schemas";

export const get_company_profile = handler({
  name: "get_company_profile",
  description: "Business-identity profile (name, sector, industry, scale) for a ticker.",
  inputSchema: toolInputSchemas.get_company_profile,
  outputSchema: toolOutputSchemas.get_company_profile,
  execute: async (input, ctx) => {
    if (pickMode(ctx) === "fixture") return loadFixture("get_company_profile", input);
    return getOrFetch("get_company_profile", input, async () => {
      if (hasFinnhubKey()) {
        try { return await fetchFinnhubCompanyProfile(input); } catch {}
      }
      try { return await fetchYahooCompanyProfile(input); } catch {}
      return emptyPayload("get_company_profile", input);
    });
  },
});
