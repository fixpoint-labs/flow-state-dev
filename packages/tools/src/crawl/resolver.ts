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
  if (config.allowedHosts !== undefined) {
    // Firecrawl follows redirects on its own servers, where no hop can be
    // checked, so an allowlist is only kept by the built-in provider.
    if (config.provider !== undefined && config.provider !== "builtin") {
      throw new Error(
        `Crawl provider "${config.provider}" cannot enforce allowedHosts; ` +
          `use the builtin provider or remove allowedHosts`
      );
    }
    return { adapter: getAdapter("builtin") };
  }

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
