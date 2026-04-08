import type { FetchProviderAdapter, FetchProviderName } from "../types";
import { firecrawlFetchAdapter } from "./firecrawl";
import { jinaFetchAdapter } from "./jina";
import { builtinFetchAdapter } from "./builtin";

const adapterRegistry: Record<FetchProviderName, FetchProviderAdapter> = {
  firecrawl: firecrawlFetchAdapter,
  jina: jinaFetchAdapter,
  builtin: builtinFetchAdapter,
};

export function getAdapter(name: FetchProviderName): FetchProviderAdapter {
  return adapterRegistry[name];
}

export { firecrawlFetchAdapter, jinaFetchAdapter, builtinFetchAdapter };
