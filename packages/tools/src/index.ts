import { search } from "./search";
import { fetch } from "./fetch";
import { crawl } from "./crawl";

export const tools = { search, fetch, crawl } as const;

export { search } from "./search";
export {
  tavilySearch,
  exaSearch,
  perplexitySearch,
  serperSearch,
  braveSearch,
  perplexitySonarSearch,
} from "./search";

export { fetch } from "./fetch";
export {
  firecrawlFetch,
  jinaFetch,
  builtinFetch,
} from "./fetch";

export { crawl } from "./crawl";
export {
  firecrawlCrawl,
  builtinCrawl,
} from "./crawl";

export type {
  SearchConfig,
  SearchResult,
  SearchOutput,
  SearchProviderName,
  SearchInput,
} from "./search";
export {
  searchInputSchema,
  searchOutputSchema,
  searchResultSchema,
  searchProviders,
} from "./search";

export type {
  FetchConfig,
  FetchResult,
  FetchProviderName,
  FetchInput,
} from "./fetch";
export { fetchInputSchema, fetchResultSchema, fetchProviders } from "./fetch";

export type {
  CrawlConfig,
  CrawlResult,
  CrawlProviderName,
  CrawlInput,
} from "./crawl";
export { crawlInputSchema, crawlResultSchema, crawlProviders } from "./crawl";
