---
title: Fetch
type: catalog
description: One page as clean Markdown.
---

# Fetch

Part of `@flow-state-dev/tools`. `tools.fetch` gives a generator a tool that reads one web page and returns it as clean Markdown.

## Why this exists

Agents need to read web pages: documentation, articles, links a user pastes, search results worth reading in full. Raw HTML is noisy and wastes context tokens. `tools.fetch` fetches the page, pulls out the content and converts it to Markdown, so the model reads the article and not the navigation around it.

It works with no API keys. A built-in provider reads static HTML, and two hosted providers, Firecrawl and Jina Reader, cover pages that need JavaScript rendering or sit behind bot protection.

## Install it

```bash
pnpm add @flow-state-dev/tools
```

Firecrawl also needs its optional package, `pnpm add @mendable/firecrawl-js`. The other providers need nothing extra.

## Basic usage

```ts title="src/flows/research/blocks/reader.ts"
import { generator } from "@flow-state-dev/core";
import { tools } from "@flow-state-dev/tools";

export const reader = generator({
  name: "reader",
  model: "openai/gpt-6-luna",
  prompt: "Read the URLs the user provides and summarize them.",
  tools: [tools.fetch()],
});
```

The model calls `fetch` with one input, a `url`, and gets back the page as Markdown with a title and metadata.

`tools.fetch` picks a provider from the API keys it finds: Firecrawl if `FIRECRAWL_API_KEY` is set, else Jina Reader if `JINA_API_KEY` is set, else the built-in provider. It never fails for lack of a provider. The built-in provider keeps the main article and drops navigation, ads and sidebars. It runs no JavaScript, so a single-page app or a page behind bot protection needs Firecrawl or Jina. The [Tools reference](../../reference/tools.md) lists each provider's key, options and limits.

## Choose a provider

To override the auto-selection, pass a `provider`. `waitForJS` makes Firecrawl wait for the page to render, and `keys` passes API keys in code instead of reading the environment variables.

```ts title="src/flows/research/tools/read-page.ts"
import { tools } from "@flow-state-dev/tools";

export const readPage = tools.fetch({
  provider: "firecrawl",
  waitForJS: true,
  keys: { firecrawl: "fc-key-here" },
});
```

All options are optional. Pass `readPage` to a generator's `tools` list in place of `tools.fetch()`.

To lock a block to one provider, use its constructor. Each takes the same config as `tools.fetch` minus `provider`.

```ts title="src/flows/research/tools/read-with-firecrawl.ts"
import { firecrawlFetch } from "@flow-state-dev/tools";

export const readWithFirecrawl = firecrawlFetch({ keys: { firecrawl: "fc-key-here" } });
```

`jinaFetch()` works the same way, and runs without a key when you call it directly.

```ts title="src/flows/research/tools/read-direct.ts"
import { builtinFetch } from "@flow-state-dev/tools";

export const readDirect = builtinFetch();
```

Naming a provider, with `provider` or its constructor, turns off the fallback. If the model calls `tools.fetch({ provider: "firecrawl" })` on a host with no Firecrawl key, the call throws a plain `Error`: `Fetch provider "firecrawl" requested but no API key found. Set FIRECRAWL_API_KEY or pass it via config.keys.firecrawl`. It is not a `FlowError` and has no `details` or `retryable`, unlike a failed page fetch. Without `@mendable/firecrawl-js` installed, Firecrawl throws an error naming the package to install. `builtinFetch` fetches the page itself and never sends it to a hosted provider. The [Tools reference](../../reference/tools.md) has the rest of each constructor's behavior.

## What comes back

Every provider returns the same shape. `source` names the provider that served the page.

```json
{
  "url": "https://example.com/article",
  "title": "Article Title",
  "markdown": "# Article Title\n\nClean markdown content...",
  "metadata": {
    "statusCode": 200,
    "contentType": "text/html",
    "wordCount": 1247
  },
  "source": "firecrawl"
}
```

`metadata.description` appears when Firecrawl or Jina supplies it. A page with no readable content comes back as best-effort Markdown, not an error. The [Tools reference](../../reference/tools.md) lists each field.

## Combine it with search

Search returns titles, URLs and snippets. Fetch reads one URL in full. Give a generator both tools and it can search, then fetch the pages worth reading. No extra wiring is needed.

```ts title="src/flows/research/blocks/researcher.ts"
import { generator } from "@flow-state-dev/core";
import { tools } from "@flow-state-dev/tools";

export const researcher = generator({
  name: "researcher",
  model: "openai/gpt-6-luna",
  prompt: "Search for information, then read the most relevant pages to give thorough answers.",
  tools: [tools.search(), tools.fetch()],
});
```

Search needs a provider key and fetch does not, so this generator reads pages with zero keys but searches only once one is set.

## When a fetch fails

A failed fetch throws a `FlowError`. It never comes back as a result. The error's `details` field says what went wrong, and `retryable` says whether trying again can help.

| Failure | `details` | Retryable |
| --- | --- | --- |
| Page gone (404) | `errorType: "http"`, `httpStatus: 404` | No |
| Server error (5xx) | `errorType: "http"`, `httpStatus`, `responseBody` | Yes |
| Bot wall (403) | `errorType: "http"`, `httpStatus: 403`, the wall's `responseBody` | No |
| Connection reset, DNS failure or timeout | `errorType: "network"` or `"timeout"`, with the original error as `cause` | Yes |
| Private or non-HTTP address (built-in provider) | `errorType: "blocked"` | No |

The built-in provider fetches public addresses only. Before any request is sent, it refuses loopback, private and link-local addresses, cloud metadata such as `169.254.169.254` included, and `localhost`. It checks every redirect the same way, so a public page that redirects to `127.0.0.1` is refused and nothing reaches that address. Firecrawl and Jina skip this check, because the vendor fetches the page. To read an intranet page on purpose, use your own handler. Redirects, retries and the remaining error shapes are in the [Tools reference](../../reference/tools.md).

To branch on a failure, read `details` where you catch the error:

```ts title="src/lib/fetch-errors.ts"
import { FlowError } from "@flow-state-dev/core";

/** True when the page is gone for good, so retrying is pointless. */
export function isPageGone(error: unknown): boolean {
  return error instanceof FlowError && error.details?.httpStatus === 404;
}
```

See [Errors](../../reference/errors.md) for the full error contract and how a block consumes `details`.

## Limit what it reads

Fetch reads whatever URL the model passes it, whether or not it came from a search result, and returns the whole page into the model's context. To stop the model asking for other sites, put the tool behind a router that checks the host of the URL it asks for and answers anything else with a refusal the model reads, so nothing is requested:

```ts title="src/flows/research/tools/fetch-docs-page.ts"
import { handler, router } from "@flow-state-dev/core";
import type { BlockDefinition } from "@flow-state-dev/core/types";
import { fetchInputSchema, fetchResultSchema, tools } from "@flow-state-dev/tools";
import { z, type ZodTypeAny } from "zod";

const DOCS_HOST = "docs.example.com";
const refusalSchema = z.object({ refused: z.string() });
type Route = BlockDefinition<typeof fetchInputSchema, ZodTypeAny>;

function isDocsUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return (url.protocol === "https:" || url.protocol === "http:") && url.hostname === DOCS_HOST;
  } catch {
    return false;
  }
}

const readPage: Route = tools.fetch().as({ name: "fetch-docs-page" });

const refuse: Route = handler({
  name: "fetch-refused",
  inputSchema: fetchInputSchema,
  outputSchema: refusalSchema,
  execute: (input) => ({ refused: `Not fetched: ${input.url} is not on ${DOCS_HOST}.` }),
});

export const fetchDocsPage = router<typeof fetchInputSchema, ZodTypeAny>({
  name: "fetch",
  description: `Fetch a page of ${DOCS_HOST} as markdown. A URL on any other site is refused.`,
  inputSchema: fetchInputSchema,
  outputSchema: z.union([fetchResultSchema, refusalSchema]),
  routes: [readPage, refuse],
  execute: (input) => (isDocsUrl(input.url) ? readPage : refuse),
});
```

Give `fetchDocsPage` to the generator in place of `tools.fetch()`.

The router checks the URL the model asks for, not where the request ends up. The built-in provider follows a redirect to any public host, and the result's `url` is the address it ended at. If a page that redirects off the site must not reach the model, check that `url` as well.

## Next steps

- [Crawl tool](./crawl.md): read many pages of one site.
- [Tools overview](./index.md): all available tools.
- [Tools reference](../../reference/tools.md): providers, options, output fields and every error shape.
