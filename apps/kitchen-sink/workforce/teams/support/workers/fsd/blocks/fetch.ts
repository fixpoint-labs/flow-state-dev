/**
 * `fetch`: read one page of the framework's docs by its URL, for `support.fsd`
 * alone (this folder registers it for that worker; its `tools:` line grants it).
 *
 * A post can steer the model to any URL, and on a deployed Kitchen Sink a post
 * is anyone's. So this is the tools package's `fetch` behind a host check: a
 * URL on flow-state.dev or one of its subdomains, over http or https, is
 * fetched; anything else gets a refusal the model reads, and nothing is
 * requested. It needs no key: with no provider configured it falls back to a
 * plain fetch.
 */
import { handler, router } from "@flow-state-dev/core";
import { fetch, fetchInputSchema, fetchResultSchema } from "@flow-state-dev/tools/fetch";
import type { BlockDefinition } from "@flow-state-dev/core/types";
import { z, type ZodTypeAny } from "zod";

/** The one site this worker may read: the framework's published docs. */
const DOCS_HOST = "flow-state.dev";

const refusalSchema = z.object({ refused: z.string() });

/** True for an http(s) URL whose host is flow-state.dev or a subdomain of it. */
function isDocsUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  return url.hostname === DOCS_HOST || url.hostname.endsWith(`.${DOCS_HOST}`);
}

// The two routes answer different shapes (the page, or the refusal), so the
// routes are typed with an open output and the router declares the union.
type Route = BlockDefinition<typeof fetchInputSchema, ZodTypeAny>;

const readPage: Route = fetch().as({ name: "fetch-docs-page" });

const refuse: Route = handler({
  name: "fetch-refused",
  inputSchema: fetchInputSchema,
  outputSchema: refusalSchema,
  execute: (input) => ({
    refused: `Not fetched: ${input.url} is not on ${DOCS_HOST}. This tool reads only the framework's docs at https://${DOCS_HOST}.`,
  }),
});

export default router<typeof fetchInputSchema, ZodTypeAny>({
  name: "fetch",
  description:
    "Fetch a page of the flow-state-dev docs (https://flow-state.dev) and return its content as markdown. Any other site is refused.",
  inputSchema: fetchInputSchema,
  outputSchema: z.union([fetchResultSchema, refusalSchema]),
  routes: [readPage, refuse],
  execute: (input) => (isDocsUrl(input.url) ? readPage : refuse),
});
