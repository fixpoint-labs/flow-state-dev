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
