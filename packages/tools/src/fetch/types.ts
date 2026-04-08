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
    }
  ): Promise<FetchResult>;
}
