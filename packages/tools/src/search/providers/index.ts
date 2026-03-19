import type { SearchProviderAdapter, SearchProviderName } from "../types";
import { tavilyAdapter } from "./tavily";
import { exaAdapter } from "./exa";
import { serperAdapter } from "./serper";
import { braveAdapter } from "./brave";

const adapterRegistry: Record<SearchProviderName, SearchProviderAdapter> = {
  tavily: tavilyAdapter,
  exa: exaAdapter,
  serper: serperAdapter,
  brave: braveAdapter,
};

export function getAdapter(name: SearchProviderName): SearchProviderAdapter {
  return adapterRegistry[name];
}

export { tavilyAdapter, exaAdapter, serperAdapter, braveAdapter };
