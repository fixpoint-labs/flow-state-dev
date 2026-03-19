import { search } from "./search";

export const tools = { search } as const;

export { search } from "./search";
export {
  tavilySearch,
  exaSearch,
  serperSearch,
  braveSearch,
} from "./search";

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
