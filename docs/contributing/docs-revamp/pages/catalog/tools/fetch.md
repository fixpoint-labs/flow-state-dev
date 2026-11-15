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

```ts title="src/flows/research/tools/read-page.ts"
import { builtinFetch, firecrawlFetch, jinaFetch } from "@flow-state-dev/tools";

export const readWithFirecrawl = firecrawlFetch({ keys: { firecrawl: "fc-key-here" } });
export const readWithJina = jinaFetch();
export const readOffline = builtinFetch();
```

`firecrawlFetch` throws when it runs if it finds no key. `builtinFetch` never calls an outside service. The [Tools reference](../../reference/tools.md) has the rest of each constructor's behavior.

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

The built-in provider fetches public addresses only, so an intranet page needs your own handler. Redirects, retries and the remaining error shapes are in the [Tools reference](../../reference/tools.md).

To branch on a failure, read `details` where you catch the error:

```ts title="src/lib/fetch-errors.ts"
import { FlowError } from "@flow-state-dev/core";

/** True when the page is gone for good, so retrying or fetching it again is pointless. */
export function isPageGone(error: unknown): boolean {
  return error instanceof FlowError && error.details?.httpStatus === 404;
}
```

See [Error handling](/docs/advanced/error-handling) for the full error contract and how a block consumes `details`.

## Next steps

- [Crawl tool](./crawl.md): read many pages of one site.
- [Tools overview](./index.md): all available tools.
- [Tools reference](../../reference/tools.md): providers, options, output fields and every error shape.
