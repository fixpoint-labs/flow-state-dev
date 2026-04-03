import type {
  FetchConfig,
  FetchProviderAdapter,
  FetchProviderName,
} from "./types";
import { getAdapter } from "./providers";
import { detectApiKey } from "../_internal/env";

export const ENV_VAR_MAP: Partial<Record<FetchProviderName, string>> = {
  firecrawl: "FIRECRAWL_API_KEY",
  jina: "JINA_API_KEY",
};

export function resolveProvider(config: FetchConfig): {
  adapter: FetchProviderAdapter;
  apiKey?: string;
} {
  if (config.provider) {
    if (config.provider === "builtin") {
      return { adapter: getAdapter("builtin") };
    }
    const apiKey = resolveKey(config.provider, config);
    if (!apiKey && config.provider !== "jina") {
      throw new Error(
        `Fetch provider "${config.provider}" requested but no API key found. ` +
          `Set ${ENV_VAR_MAP[config.provider]} or pass it via config.keys.${config.provider}`
      );
    }
    return { adapter: getAdapter(config.provider), apiKey };
  }

  // Auto-select: Firecrawl → Jina (with key) → Jina (no key) → Built-in
  const firecrawlKey = resolveKey("firecrawl", config);
  if (firecrawlKey) {
    return { adapter: getAdapter("firecrawl"), apiKey: firecrawlKey };
  }

  const jinaKey = resolveKey("jina", config);
  if (jinaKey) {
    return { adapter: getAdapter("jina"), apiKey: jinaKey };
  }

  // Jina works without a key at 20 RPM — use it as fallback before built-in
  // Skip if explicitly no Jina desired (user can force builtin via config.provider)
  return { adapter: getAdapter("builtin") };
}

function resolveKey(
  name: FetchProviderName,
  config: FetchConfig
): string | undefined {
  const configKey =
    name === "firecrawl"
      ? config.keys?.firecrawl
      : name === "jina"
        ? config.keys?.jina
        : undefined;
  return configKey ?? (ENV_VAR_MAP[name] ? detectApiKey(ENV_VAR_MAP[name]!) : undefined);
}
