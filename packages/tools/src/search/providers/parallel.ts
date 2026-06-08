/**
 * Parallel.ai Search API adapter.
 *
 * POSTs to https://api.parallel.ai/v1/search, normalizing the per-result
 * `excerpts[]` array to the framework's snippet/content fields. Auth is the
 * `x-api-key` header (not Bearer — unlike every other provider here). No SDK
 * dependency — one HTTP POST.
 *
 * Parallel's /v1/search `mode` accepts only "advanced" or "basic". The
 * normalized `tier` drives it (fast → "basic", balanced/deep → "advanced"); a
 * `searchMode` override replaces it verbatim. Domain filters map to
 * `source_policy` and are only sent when provided.
 */

import type { SearchProviderAdapter, SearchOutput, SearchTier } from "../types";

const PARALLEL_SEARCH_ENDPOINT = "https://api.parallel.ai/v1/search";

const TIER_TO_MODE: Record<SearchTier, "basic" | "advanced"> = {
  fast: "basic",
  balanced: "advanced",
  deep: "advanced",
};

export const parallelAdapter: SearchProviderAdapter = {
  name: "parallel",
  capabilities: { tiers: ["fast", "balanced", "deep"] },
  async search(query, options): Promise<SearchOutput> {
    // searchMode (provider-native passthrough) wins over the tier mapping.
    const mode = options.searchMode ?? TIER_TO_MODE[options.tier ?? "balanced"];
    const sourcePolicy: Record<string, string[]> = {};
    if (options.includeDomains?.length)
      sourcePolicy.include_domains = options.includeDomains;
    if (options.excludeDomains?.length)
      sourcePolicy.exclude_domains = options.excludeDomains;

    // `options.topic` is intentionally not forwarded: Parallel's /v1/search has
    // no topic/category filter. The objective string is the only intent channel.
    const response = await globalThis.fetch(PARALLEL_SEARCH_ENDPOINT, {
      method: "POST",
      headers: {
        "x-api-key": options.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        objective: query,
        search_queries: [query],
        mode,
        advanced_settings: {
          max_results: options.maxResults,
          excerpt_settings: {
            // Parallel truncates softly; size the response off the shared depth knob.
            max_chars_per_result:
              options.searchDepth === "advanced" ? 6000 : 1500,
          },
        },
        ...(Object.keys(sourcePolicy).length
          ? { source_policy: sourcePolicy }
          : {}),
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `Parallel Search API error: ${response.status} ${response.statusText}` +
          (body ? ` — ${body}` : "")
      );
    }

    const data = (await response.json()) as {
      results?: Array<{
        url?: string;
        title?: string;
        publish_date?: string | null;
        excerpts?: string[];
      }>;
    };

    const results = (data.results ?? [])
      .slice(0, options.maxResults)
      .map((r) => ({
        title: r.title ?? "",
        url: r.url ?? "",
        snippet:
          Array.isArray(r.excerpts) && r.excerpts.length > 0
            ? r.excerpts[0]
            : "",
        content:
          Array.isArray(r.excerpts) && r.excerpts.length > 1
            ? r.excerpts.join("\n\n")
            : undefined,
        publishedDate: r.publish_date ?? undefined,
        source: "parallel" as const,
      }));

    return { query, results };
  },
};
