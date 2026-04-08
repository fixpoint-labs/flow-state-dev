import type { CrawlProviderAdapter, CrawlProviderName } from "../types";
import { firecrawlCrawlAdapter } from "./firecrawl";
import { builtinCrawlAdapter } from "./builtin";

const adapterRegistry: Record<CrawlProviderName, CrawlProviderAdapter> = {
  firecrawl: firecrawlCrawlAdapter,
  builtin: builtinCrawlAdapter,
};

export function getAdapter(name: CrawlProviderName): CrawlProviderAdapter {
  return adapterRegistry[name];
}

export { firecrawlCrawlAdapter, builtinCrawlAdapter };
