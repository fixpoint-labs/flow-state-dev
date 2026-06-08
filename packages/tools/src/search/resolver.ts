import type {
  SearchConfig,
  SearchProviderAdapter,
  SearchProviderName,
} from "./types";
import { getAdapter } from "./providers";
import { detectApiKey } from "../_internal/env";

const providerPriority: SearchProviderName[] = [
  "parallel",
  "tavily",
  "exa",
  "perplexity",
  "serper",
  "brave",
  "perplexity-sonar",
];

export const ENV_VAR_MAP: Record<SearchProviderName, string> = {
  tavily: "TAVILY_API_KEY",
  exa: "EXA_API_KEY",
  perplexity: "PERPLEXITY_API_KEY",
  serper: "SERPER_API_KEY",
  brave: "BRAVE_SEARCH_API_KEY",
  parallel: "PARALLEL_API_KEY",
  "perplexity-sonar": "PERPLEXITY_API_KEY",
};

export function resolveProvider(config: SearchConfig): {
  adapter: SearchProviderAdapter;
  apiKey: string;
} {
  if (config.provider) {
    const apiKey = resolveKey(config.provider, config);
    if (!apiKey) {
      throw new Error(
        `Search provider "${config.provider}" requested but no API key found. ` +
          `Set ${ENV_VAR_MAP[config.provider]} or pass it via config.keys.${config.provider}`
      );
    }
    return { adapter: getAdapter(config.provider), apiKey };
  }

  // Capability-aware auto-selection: among keyed providers, prefer (by priority)
  // one that meaningfully supports the requested tier. `balanced` is supported
  // by every provider, so the default reproduces plain key-presence selection.
  const requestedTier = config.tier ?? "balanced";
  for (const name of providerPriority) {
    const apiKey = resolveKey(name, config);
    if (apiKey && getAdapter(name).capabilities.tiers.includes(requestedTier)) {
      return { adapter: getAdapter(name), apiKey };
    }
  }

  // Fallback: no tier-capable provider has a key. Honor any keyed provider
  // (best-effort — it clamps/ignores the tier) so resolution still succeeds.
  for (const name of providerPriority) {
    const apiKey = resolveKey(name, config);
    if (apiKey) {
      return { adapter: getAdapter(name), apiKey };
    }
  }

  throw new Error(
    "No search provider available. Configure at least one of: " +
      providerPriority.map((p) => ENV_VAR_MAP[p]).join(", ") +
      " — or pass keys explicitly via search({ keys: { tavily: '...' } })"
  );
}

function resolveKey(
  name: SearchProviderName,
  config: SearchConfig
): string | undefined {
  return config.keys?.[name] ?? detectApiKey(ENV_VAR_MAP[name]);
}
