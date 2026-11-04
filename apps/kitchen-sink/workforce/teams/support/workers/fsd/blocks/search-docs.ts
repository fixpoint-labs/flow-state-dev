/**
 * `search-docs`: web search held to the framework's published docs, for
 * `support.fsd` alone (this folder registers it for that worker; its
 * `tools:` line grants it).
 *
 * The tools package's own `search`, limited to the docs site's domain and
 * renamed so the model reads what it searches. The provider comes from the
 * environment, as it does for the chat agent's search; with no key the call
 * fails.
 */
import { search } from "@flow-state-dev/tools/search";

/** Where the framework's docs are published (`apps/docs`). */
const DOCS_DOMAIN = "flow-state.dev";

export default search({ includeDomains: [DOCS_DOMAIN] }).as({
  name: "search-docs",
  description:
    "Search the flow-state-dev framework's documentation (flow-state.dev). Returns titles, URLs, and snippets from matching docs pages.",
});
