/**
 * Shared discovery helper for Phase 1 investigative analysts.
 *
 * Wraps the `@flow-state-dev/tools/search` resolver, formats the response
 * into the trading-desk `DiscoveryPayload` shape, numbers items so the
 * analyst LLM can reference them when populating citations, and tags
 * every item with the search provider that produced it.
 *
 * Provider auto-detection follows the resolver's priority order
 * (Tavily → Exa → Perplexity → Serper → Brave → Perplexity-Sonar); the
 * first provider with a configured env var wins. When no provider is
 * configured, `resolveProvider` throws — since this function is `async`,
 * that becomes a promise rejection and the caller's try/catch handles it
 * (the per-tool body returns `emptyPayload(...)` tagged `"unavailable"`,
 * per BP-020).
 *
 * Reference implementation for the same call pattern lives at
 * `lib/providers/web.ts:searchCompanyWeb` (used by the Company Profile
 * analyst's web-enrichment backstop).
 */
import { resolveProvider } from "@flow-state-dev/tools/search";
import {
  publisherIsSubject,
  subjectEntityFromProfile,
  textMentionsEntity,
  type SubjectEntity,
} from "../../lib/entity-identity";
import { emptyPayload, skippedDiscoveryPayload } from "../empty-payloads";
import { resolveToolPayload } from "./resolve";
import type {
  DiscoveryPayload,
  DiscoveryTool,
  ToolInput,
  ToolOutput,
} from "../schemas";

const MAX_ITEMS = 5;

/** Per-role query templates. Each one composes a generic web-search query
 *  appropriate to what the analyst is most likely to need investigative
 *  context for. Kept as a small inlined set rather than a strategy
 *  pattern — per-analyst tool files are the seam where provider-specific
 *  endpoints (SEC EDGAR, Finnhub extended news, etc.) can drop in later. */
export const FUNDAMENTALS_QUERY = (ticker: string): string =>
  `${ticker} earnings guidance management commentary business mix segment`;

export const SENTIMENT_QUERY = (ticker: string): string =>
  `${ticker} retail investor sentiment forum stocktwits seekingalpha`;

export const TECHNICAL_QUERY = (ticker: string): string =>
  `${ticker} technical analysis chart breakout support resistance`;

export const PROFILE_QUERY = (ticker: string): string =>
  `${ticker} recent strategic announcement product launch regulatory filing`;

export const MARKET_QUERY = (ticker: string): string =>
  `${ticker} sector outlook peer earnings rotation theme regulatory supply chain`;

export const MACRO_QUERY = (ticker: string): string =>
  `${ticker} macro economic outlook rates inflation geopolitical risk tariff trade policy central bank`;

export const QUANT_QUERY = (ticker: string): string =>
  `${ticker} factor momentum short interest options implied volatility quant signal beta`;

export const DISCLOSURE_QUERY = (ticker: string): string =>
  `${ticker} SEC filing earnings call transcript guidance consensus estimate analyst rating`;

export type DiscoverWebArgs = {
  ticker: string;
  date: string;
  queryTemplate: (ticker: string) => string;
};

/**
 * Run a single web-search call and shape the response into a
 * `DiscoveryPayload`. Returns `source: "web"` even when the search yields
 * zero results — the analyst-side handling for empty `items` is the same
 * as for `"skipped"`, so the distinction is preserved for the audit trail.
 */
export async function discoverWeb(args: DiscoverWebArgs): Promise<DiscoveryPayload> {
  const { adapter, apiKey } = resolveProvider({});
  const query = args.queryTemplate(args.ticker);
  const output = await adapter.search(query, {
    maxResults: MAX_ITEMS,
    searchDepth: "basic",
    topic: "general",
    apiKey,
  });
  return {
    source: "web",
    ticker: args.ticker,
    asOf: args.date,
    query,
    items: output.results.slice(0, MAX_ITEMS).map((r, i) => ({
      id: String(i + 1),
      url: r.url,
      title: r.title,
      // `searchResultSchema.snippet` is required upstream, but coerce any
      // falsy slip-through to empty string to keep our schema clean.
      snippet: r.snippet ?? "",
      publisher: extractDomain(r.url),
      provider: r.source,
    })),
    // Raw provider output — the entity check is applied on the way out of the
    // tool (see `runDiscovery`), so a recorded fixture keeps the unfiltered
    // search result and replay re-runs the check against the replayed profile.
    entityCheck: "unchecked",
    excluded: [],
  };
}

/** Best-effort domain extraction. Returns null on URL parse failure so
 *  malformed entries don't poison the analyst's view of the source list. */
function extractDomain(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Entity-identity validation (FIX-779)
// ---------------------------------------------------------------------------

/** The slice of block context this runtime reads. Loose by design — the tool
 *  handlers pass their own typed ctx and the fields are read defensively. */
type DiscoveryCtx = {
  session: { state: Record<string, unknown> };
  resources?: Record<string, unknown>;
};

/**
 * Resolve the run's subject entity from the session profile spine. Returns
 * `null` when the profile has not been resolved (the tap that warms it failed,
 * or the provider had nothing) — the caller must then leave the payload
 * `"unchecked"` rather than dropping items it cannot validate.
 */
export function readSubjectEntity(ctx: DiscoveryCtx): SubjectEntity | null {
  const ticker = ctx.session.state.ticker;
  if (typeof ticker !== "string" || ticker === "") return null;
  const profileData = ctx.resources?.profileData as
    | { state?: { companyProfile?: unknown } }
    | undefined;
  const profile = profileData?.state?.companyProfile as
    | { source?: unknown; name?: unknown; website?: unknown }
    | undefined;
  return subjectEntityFromProfile(ticker, profile ?? null);
}

/**
 * Drop discovery results that are not about the subject entity.
 *
 * The failure this closes: a resolvable ticker whose search results belong to
 * someone else (a ticker symbol colliding with another issuer's name fragment,
 * a thinly covered listing). Those snippets reached analyst prompts as evidence
 * with nothing structural to stop them.
 *
 * An excluded item keeps only its URL and a reason. The wrong-company title and
 * snippet are discarded rather than tagged, because a tag in the payload is
 * still prose in the prompt — the whole point is that the contaminating text
 * does not reach the model.
 *
 * Two escapes, both deliberate and both honest rather than silent:
 *   - `entityScoped: false` (macro / market-context discovery) asks about the
 *     environment around a name, so the subject is not expected to be named.
 *   - an unresolved subject leaves everything in place tagged `"unchecked"`;
 *     dropping every snippet because we could not identify the company would be
 *     a worse failure than the one this guards against.
 */
export function applyEntityCheck(
  payload: DiscoveryPayload,
  subject: SubjectEntity | null,
  entityScoped: boolean,
): DiscoveryPayload {
  if (!entityScoped) {
    return { ...payload, entityCheck: "not-applicable", excluded: [] };
  }
  if (subject === null) {
    return { ...payload, entityCheck: "unchecked", excluded: [] };
  }
  const items: DiscoveryPayload["items"] = [];
  const excluded: DiscoveryPayload["excluded"] = [];
  for (const item of payload.items) {
    const mentioned =
      publisherIsSubject(item.publisher, subject) ||
      textMentionsEntity(`${item.title} ${item.snippet} ${item.url}`, subject);
    if (mentioned) items.push({ ...item, id: String(items.length + 1) });
    else {
      excluded.push({
        url: item.url,
        reason: `entity-mismatch: names neither ${subject.ticker} nor ${subject.name}`,
      });
    }
  }
  return { ...payload, entityCheck: "verified", items, excluded };
}

/**
 * Whether each tool's query is about the company itself (entity-scoped, so a
 * result naming a different issuer is contamination) or about the environment
 * around it (macro conditions, sector rotation, peer earnings — where a good
 * result frequently never names the subject).
 *
 * A total map over `DiscoveryTool` rather than a per-call-site flag: this is a
 * fixed property of the query, and adding a ninth tool should be a compile
 * error here, not a silently-defaulted argument at one of nine call sites.
 */
const ENTITY_SCOPED: Record<DiscoveryTool, boolean> = {
  discover_fundamentals_context: true,
  discover_sentiment_context: true,
  discover_technical_context: true,
  discover_profile_context: true,
  discover_quant_context: true,
  discover_disclosure_context: true,
  // The environment around the name, not the name itself. Filtering on identity
  // here would delete exactly what these two were sent to fetch.
  discover_macro_context: false,
  discover_market_context: false,
};

/**
 * The shared body of all eight `discover_*_context` tools: the cost gate, the
 * fixture/live/record dispatch, and the entity check. The tools differ only in
 * name, description, and query template, so the body lives here once (BP-024)
 * — a guard copied eight times is a guard that drifts.
 *
 * The cost gate fires BEFORE the fixture branch deliberately: a fixture-mode
 * regression run on the `fast` preset should observe the same no-op
 * investigation a live run would, not a fixture load.
 *
 * Per BP-020 the live branch never falls back to fixture data — a search
 * provider failure tags the result `"unavailable"` so the analyst sees the gap
 * honestly. The entity check runs on the fixture branch too, so a replayed
 * corpus is validated exactly like a live search.
 */
export async function runDiscovery<T extends DiscoveryTool>(args: {
  tool: T;
  input: ToolInput<T>;
  ctx: DiscoveryCtx;
  queryTemplate: (ticker: string) => string;
}): Promise<ToolOutput<T>> {
  const { tool, input, ctx, queryTemplate } = args;
  const entityScoped = ENTITY_SCOPED[tool];
  if (ctx.session.state.costPreset !== "full") {
    return skippedDiscoveryPayload(tool, input);
  }
  const payload = await resolveToolPayload(tool, input, ctx, async () => {
    try {
      return (await discoverWeb({
        ticker: input.ticker,
        date: input.date,
        queryTemplate,
      })) as ToolOutput<T>;
    } catch {
      return emptyPayload(tool, input);
    }
  });
  // The subject is only read when it can be used — an environment-scoped tool
  // does not declare the profile resource at all.
  const subject = entityScoped ? readSubjectEntity(ctx) : null;
  return applyEntityCheck(
    payload as DiscoveryPayload,
    subject,
    entityScoped,
  ) as ToolOutput<T>;
}
