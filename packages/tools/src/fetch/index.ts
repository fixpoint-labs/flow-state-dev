import { handler } from "@flow-state-dev/core";
import {
  fetchInputSchema,
  fetchResultSchema,
  type FetchConfig,
  type FetchInput,
  type FetchResult,
} from "./types";
import { resolveProvider } from "./resolver";

/**
 * Creates a fetch tool for use in generator blocks.
 * Auto-detects the best available fetch provider from env vars.
 * Always works — falls back to built-in fetch + readability.
 *
 * Provider priority: Firecrawl → Jina Reader → Built-in
 */
export function fetch(config: FetchConfig = {}) {
  return handler({
    name: "fetch",
    description:
      "Fetch a web page and return its content as markdown. " +
      "Use this to read the full content of a URL found via search or provided by the user.",
    inputSchema: fetchInputSchema,
    outputSchema: fetchResultSchema,
    execute: async (input: FetchInput): Promise<FetchResult> => {
      const { adapter, apiKey } = resolveProvider(config);
      return adapter.fetch(input.url, {
        waitForJS: config.waitForJS ?? false,
        apiKey,
      });
    },
  });
}

// Direct provider tools — locked to a specific provider
export function firecrawlFetch(config: Omit<FetchConfig, "provider"> = {}) {
  return fetch({ ...config, provider: "firecrawl" });
}

export function jinaFetch(config: Omit<FetchConfig, "provider"> = {}) {
  return fetch({ ...config, provider: "jina" });
}

export function builtinFetch(config: Omit<FetchConfig, "provider"> = {}) {
  return fetch({ ...config, provider: "builtin" });
}

// Re-export types
export type {
  FetchConfig,
  FetchResult,
  FetchProviderName,
  FetchProviderAdapter,
  FetchInput,
} from "./types";
export { fetchInputSchema, fetchResultSchema, fetchProviders } from "./types";
