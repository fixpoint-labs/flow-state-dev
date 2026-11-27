import { z } from "zod";

// --- Provider enum ---

export const fetchProviders = ["firecrawl", "jina", "builtin"] as const;
export type FetchProviderName = (typeof fetchProviders)[number];

// --- Normalized output ---

export const fetchResultSchema = z.object({
  url: z.string(),
  title: z.string(),
  markdown: z.string(),
  metadata: z.object({
    statusCode: z.number(),
    contentType: z.string(),
    description: z.string().optional(),
    publishedDate: z.string().optional(),
    wordCount: z.number(),
  }),
  source: z.enum(fetchProviders),
});

export type FetchResult = z.infer<typeof fetchResultSchema>;

// --- Tool input schema ---

export const fetchInputSchema = z.object({
  url: z.string().describe("The URL of the web page to fetch"),
});

export type FetchInput = z.infer<typeof fetchInputSchema>;

// --- Configuration ---

export interface FetchConfig {
  /** Override auto-selection. Use a specific provider. */
  provider?: FetchProviderName;
  /** Enable JS rendering when available (Firecrawl, Jina). Default: false. */
  waitForJS?: boolean;
  /**
   * Hostnames the tool may read from, matched exactly (`example.com` does not
   * allow `www.example.com`). Checked on the URL the model asks for and on every
   * redirect hop. Only the built-in provider can check redirect hops, so setting
   * this selects it, and naming a hosted provider with it throws. Unset: any
   * public host; an empty list allows none.
   */
  allowedHosts?: string[];
  /** Explicit API keys. If omitted, auto-detect from env vars. */
  keys?: {
    firecrawl?: string;
    jina?: string;
  };
}

// --- Provider adapter interface ---

export interface FetchProviderAdapter {
  name: FetchProviderName;
  fetch(
    url: string,
    options: {
      waitForJS: boolean;
      apiKey?: string;
      /** The run's signal; aborting it aborts the request. */
      signal?: AbortSignal;
      /** See {@link FetchConfig.allowedHosts}. */
      allowedHosts?: string[];
    }
  ): Promise<FetchResult>;
}
