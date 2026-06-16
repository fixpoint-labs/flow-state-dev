/**
 * Business-identity profile (name, sector, industry, business description,
 * scale). Live mode runs both Finnhub `/stock/profile2` and Yahoo
 * `quoteSummary` and merges them — Finnhub carries identity/scale + IPO,
 * Yahoo carries sector + the long business description neither carries the
 * other. After merging, two web-enrichment backstops fill the description
 * gap when both structured providers leave it null:
 *
 *   1. Fetch `<meta name="description">` from the resolved homepage URL.
 *   2. Web search the company name (provider auto-detected via
 *      `@flow-state-dev/tools/search`).
 *
 * Both enrichment steps fail soft — a missing search-provider key or an
 * unreachable homepage degrades to `null` for that field, never to a
 * thrown error. Fixture mode: curated per-ticker JSON.
 */
import { handler } from "@flow-state-dev/core";
import { fetchFinnhubCompanyProfile, hasFinnhubKey } from "../providers/finnhub";
import { loadFixture } from "../runtime/fixtures";
import { fetchWebsiteMetaDescription, searchCompanyWeb } from "../providers/web";
import { fetchYahooCompanyProfile } from "../providers/yahoo";
import { emptyPayload } from "../empty-payloads";
import { pickMode, toolInputSchemas, toolOutputSchemas } from "../schemas";
import type { ToolInput, ToolOutput } from "../schemas";
import { profileDataResource } from "../../profile-data-resource";
import { writeSubjectSpine } from "../runtime/spine-write-through";

export const get_company_profile = handler({
  name: "get_company_profile",
  description: "Business-identity profile (name, sector, industry, scale) for a ticker.",
  inputSchema: toolInputSchemas.get_company_profile,
  outputSchema: toolOutputSchemas.get_company_profile,
  resources: { profileData: profileDataResource },
  // Write-through to the session profile spine (see get_fundamentals).
  execute: async (input, ctx) => {
    const loadCompanyProfile = async () => {
      if (pickMode(ctx) === "fixture") return loadFixture("get_company_profile", input);
      const merged = await fetchAndMergeProviders(input);
      return enrichWithWeb(merged);
    };
    return writeSubjectSpine({
      toSpine: input.ticker === (ctx.session.state as { ticker?: string }).ticker,
      resource: ctx.resources.profileData,
      field: "companyProfile",
      tool: "get_company_profile",
      input,
      load: loadCompanyProfile,
    });
  },
});

/** Run Finnhub and Yahoo concurrently and merge their fields. Finnhub
 *  wins when both provide a value (more reliable identity/scale source);
 *  Yahoo fills in `sector` and `businessDescription` which Finnhub never
 *  carries. Returns the empty payload tagged `unavailable` when both fail. */
async function fetchAndMergeProviders(
  input: ToolInput<"get_company_profile">,
): Promise<ToolOutput<"get_company_profile">> {
  const [finResult, yhResult] = await Promise.allSettled([
    hasFinnhubKey()
      ? fetchFinnhubCompanyProfile(input)
      : Promise.reject<ToolOutput<"get_company_profile">>(new Error("no Finnhub key")),
    fetchYahooCompanyProfile(input),
  ]);
  const fin = finResult.status === "fulfilled" ? finResult.value : null;
  const yh = yhResult.status === "fulfilled" ? yhResult.value : null;
  if (fin === null && yh === null) return emptyPayload("get_company_profile", input);
  // Source tag reflects the primary identity contributor.
  const source = fin !== null ? "finnhub" : "yahoo";
  // Field-by-field merge: prefer Finnhub when it carries a value (more
  // reliable identity/scale source), fall back to Yahoo. The cast is safe
  // — every key narrows to that field's value-or-null type at runtime.
  const pick = <K extends keyof ToolOutput<"get_company_profile">>(
    key: K,
  ): ToolOutput<"get_company_profile">[K] => {
    const finVal = fin === null ? undefined : fin[key];
    const yhVal = yh === null ? undefined : yh[key];
    if (isPresent(finVal)) return finVal as ToolOutput<"get_company_profile">[K];
    if (isPresent(yhVal)) return yhVal as ToolOutput<"get_company_profile">[K];
    return null as ToolOutput<"get_company_profile">[K];
  };
  return {
    source,
    ticker: input.ticker,
    asOf: input.date,
    name: (fin?.name ?? yh?.name ?? "") as string,
    sector: pick("sector"),
    industry: pick("industry"),
    country: pick("country"),
    exchange: pick("exchange"),
    currency: pick("currency"),
    businessDescription: pick("businessDescription"),
    marketCapUsd: pick("marketCapUsd"),
    employees: pick("employees"),
    ipoDate: pick("ipoDate"),
    website: pick("website"),
    websiteMetaDescription: null,
    searchSnippets: null,
  };
}

function isPresent(v: unknown): boolean {
  return v !== null && v !== undefined && v !== "";
}

/** Add the two web-enrichment fields. Both run concurrently, both fail
 *  soft — missing keys, network errors, or sites that block scrapers all
 *  degrade to `null`. Skipped entirely on the `unavailable` payload (no
 *  ticker identity to enrich). */
async function enrichWithWeb(
  profile: ToolOutput<"get_company_profile">,
): Promise<ToolOutput<"get_company_profile">> {
  if (profile.source === "unavailable") return profile;
  const [metaResult, searchResult] = await Promise.allSettled([
    profile.website !== null
      ? fetchWebsiteMetaDescription(profile.website)
      : Promise.resolve<string | null>(null),
    profile.name !== ""
      ? searchCompanyWeb(`${profile.name} company business`)
      : Promise.resolve<Array<{ title: string; url: string; snippet: string }>>([]),
  ]);
  const websiteMetaDescription =
    metaResult.status === "fulfilled" ? metaResult.value : null;
  const searchSnippets =
    searchResult.status === "fulfilled" && searchResult.value.length > 0
      ? searchResult.value
      : null;
  return { ...profile, websiteMetaDescription, searchSnippets };
}
