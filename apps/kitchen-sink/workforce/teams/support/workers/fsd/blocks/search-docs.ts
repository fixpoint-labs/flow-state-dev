/**
 * `search-docs`: web search held to the framework's published docs, for
 * `support.fsd` alone (this folder registers it for that worker; its
 * `tools:` line grants it).
 *
 * The tools package's own `search`, limited to the docs site's domain and
 * renamed so the model reads what it searches. The provider comes from the
 * environment, as it does for the chat agent's search; with no key the call
 * fails. Brave and Perplexity Sonar ignore the domain filter, so when one of
 * them is the provider the call is refused rather than run on the open web.
 */
import { handler, router } from "@flow-state-dev/core";
import { resolveProvider, search, searchInputSchema, searchOutputSchema } from "@flow-state-dev/tools/search";
import { z } from "zod";

/** Where the framework's docs are published (`apps/docs`). */
const DOCS_DOMAIN = "flow-state.dev";

/** Providers whose adapters drop `includeDomains`. */
const UNFILTERED_PROVIDERS = new Set(["brave", "perplexity-sonar"]);

const searchConfig = { includeDomains: [DOCS_DOMAIN] };

const searchSite = search(searchConfig).as({ name: "search-docs-site" });

const refusalSchema = z.object({ refused: z.string() });

/** The provider a search would use, or null when none is keyed (the search then reports that itself). */
function providerName(): string | null {
  try {
    return resolveProvider(searchConfig).adapter.name;
  } catch {
    return null;
  }
}

const refuse = handler({
  name: "search-docs-refused",
  inputSchema: searchInputSchema,
  outputSchema: refusalSchema,
  execute: () => ({
    refused: `Not searched: the configured search provider (${providerName()}) cannot limit results to ${DOCS_DOMAIN}, so this tool will not search the open web. Answer from what you know, and say the docs could not be searched.`,
  }),
});

export default router({
  name: "search-docs",
  description:
    "Search the flow-state-dev framework's documentation (flow-state.dev). Returns titles, URLs, and snippets from matching docs pages.",
  inputSchema: searchInputSchema,
  outputSchema: z.union([searchOutputSchema, refusalSchema]),
  routes: [searchSite, refuse],
  execute: () => {
    const name = providerName();
    return name !== null && UNFILTERED_PROVIDERS.has(name) ? refuse : searchSite;
  },
});
