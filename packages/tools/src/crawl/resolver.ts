import type {
  CrawlConfig,
  CrawlProviderAdapter,
  CrawlProviderName,
} from "./types";
import { getAdapter } from "./providers";
import { detectApiKey } from "../_internal/env";

export const ENV_VAR_MAP: Partial<Record<CrawlProviderName, string>> = {
  firecrawl: "FIRECRAWL_API_KEY",
};

export function resolveProvider(config: CrawlConfig): {
  adapter: CrawlProviderAdapter;
  apiKey?: string;
} {
  if (config.provider) {
    if (config.provider === "builtin") {
      return { adapter: getAdapter("builtin") };
    }
    const apiKey = resolveKey("firecrawl", config);
    if (!apiKey) {
      throw new Error(
        `Crawl provider "firecrawl" requested but no API key found. ` +
          `Set FIRECRAWL_API_KEY or pass it via config.keys.firecrawl`
      );
    }
    return { adapter: getAdapter("firecrawl"), apiKey };
  }

  const firecrawlKey = resolveKey("firecrawl", config);
  if (firecrawlKey) {
    return { adapter: getAdapter("firecrawl"), apiKey: firecrawlKey };
  }

  // Built-in BFS crawler always available
  return { adapter: getAdapter("builtin") };
}

function resolveKey(
  name: CrawlProviderName,
  config: CrawlConfig
): string | undefined {
  const configKey = name === "firecrawl" ? config.keys?.firecrawl : undefined;
  return configKey ?? (ENV_VAR_MAP[name] ? detectApiKey(ENV_VAR_MAP[name]!) : undefined);
}
