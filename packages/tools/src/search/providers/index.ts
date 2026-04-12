import type { SearchProviderAdapter, SearchProviderName } from "../types";
import { tavilyAdapter } from "./tavily";
import { exaAdapter } from "./exa";
import { perplexityAdapter } from "./perplexity";
import { serperAdapter } from "./serper";
import { braveAdapter } from "./brave";
import { perplexitySonarAdapter } from "./perplexity-sonar";

const adapterRegistry: Record<SearchProviderName, SearchProviderAdapter> = {
  tavily: tavilyAdapter,
  exa: exaAdapter,
  perplexity: perplexityAdapter,
  serper: serperAdapter,
  brave: braveAdapter,
  "perplexity-sonar": perplexitySonarAdapter,
};

export function getAdapter(name: SearchProviderName): SearchProviderAdapter {
  return adapterRegistry[name];
}

export {
  tavilyAdapter,
  exaAdapter,
  perplexityAdapter,
  serperAdapter,
  braveAdapter,
  perplexitySonarAdapter,
};
