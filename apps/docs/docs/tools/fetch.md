---
sidebar_position: 2
---

# Fetch

`@flow-state-dev/tools` — Fetch a single web page and return its content as clean, LLM-ready markdown.

## Why this exists

Agents need to read web pages. Documentation, articles, user-shared links, search results worth reading in full. The raw HTML is noisy and wastes context tokens. `tools.fetch` handles the fetching, content extraction, and HTML-to-markdown conversion so you don't have to.

Three providers, auto-selected by what's available:

| Provider | How it works | JS rendering | Anti-bot | Env var |
|----------|-------------|--------------|----------|---------|
| Firecrawl | Managed API, best quality | Yes | Yes | `FIRECRAWL_API_KEY` |
| Jina Reader | HTTP API via `r.jina.ai` | Yes (ReaderLM) | Partial | `JINA_API_KEY` (optional) |
| Built-in | Node.js fetch + Readability + Turndown | No | No | None needed |

The built-in fallback always works. No API keys, no external services. It handles static HTML well — documentation sites, blog posts, articles. For JS-rendered SPAs or pages behind anti-bot protection, you'll want Firecrawl or Jina.

## Basic usage

```ts
import { generator } from "@flow-state-dev/core";
import { tools } from "@flow-state-dev/tools";

const reader = generator({
  name: "reader",
  model: "anthropic/claude-sonnet-4-6",
  prompt: "Read URLs the user provides and summarize them.",
  tools: [tools.fetch()],
});
```

The LLM calls `fetch` with a URL and gets back markdown content, a title, and metadata.

## Configuration

```ts
tools.fetch({
  // Force a specific provider instead of auto-detection
  provider: "firecrawl",  // "firecrawl" | "jina" | "builtin"

  // Enable JS rendering (Firecrawl and Jina only)
  waitForJS: true,

  // Explicit API keys (overrides env vars)
  keys: {
    firecrawl: "fc-...",
    jina: "jina_...",
  },
})
```

All options are optional. With no config, the tool auto-detects providers from environment variables and falls back to built-in.

## Provider resolution

The tool checks for available providers in this order:

```
FIRECRAWL_API_KEY set?  →  Firecrawl (deterministic, JS rendering, anti-bot)
JINA_API_KEY set?       →  Jina Reader (deterministic, ReaderLM markdown)
Always                  →  Built-in (static HTML only, but always works)
```

Unlike `tools.search()`, fetch never throws "no provider available". The built-in fallback covers the zero-config case.

## Output shape

Every provider returns the same normalized result:

```ts
{
  url: "https://example.com/article",
  title: "Article Title",
  markdown: "# Article Title\n\nClean markdown content...",
  metadata: {
    statusCode: 200,
    contentType: "text/html",
    description: "Meta description if available",
    publishedDate: "2026-01-15",
    wordCount: 1247,
  },
  source: "firecrawl"  // which provider was used
}
```

## How the built-in fallback works

The built-in provider uses a three-step pipeline:

1. **Fetch** — standard `fetch()` with a browser-like User-Agent
2. **Extract** — `@mozilla/readability` strips navigation, ads, sidebars, and boilerplate, keeping just the article content (same library behind Firefox Reader View)
3. **Convert** — `turndown` converts the cleaned HTML to markdown with ATX-style headings and fenced code blocks

This is the same pipeline Jina Reader uses internally. The difference is Jina also handles JavaScript-rendered pages via their ReaderLM model.

## Direct provider constructors

If you want to skip auto-detection and lock to a specific provider:

```ts
import { firecrawlFetch, jinaFetch, builtinFetch } from "@flow-state-dev/tools";

// Always use Firecrawl (throws if no API key)
const fetch = firecrawlFetch({ keys: { firecrawl: "fc-..." } });

// Always use Jina (works without key at 20 RPM)
const fetch = jinaFetch();

// Always use built-in (never calls external services)
const fetch = builtinFetch();
```

## Composing with search

A natural pattern: search first, then fetch the best results for full content.

```ts
const researcher = generator({
  name: "researcher",
  model: "anthropic/claude-sonnet-4-6",
  prompt: "Search for information, then read the most relevant pages to give thorough answers.",
  tools: [tools.search(), tools.fetch()],
});
```

The LLM will call `search`, scan the snippets, then `fetch` the pages that look most useful. You don't need to wire this up — the LLM figures out the workflow.

## Error handling

When a fetch fails, the tool throws a `FlowError` carrying structured detail so you can tell a bot wall from a connection reset without reading raw traces. The detail lives on `error.details`:

- `errorType` — the failure category: `"http"`, `"network"`, `"timeout"`, `"abort"`, `"parse"`, or `"unknown"`.
- `httpStatus` / `httpStatusText` — the status for a non-2xx HTTP response. A 403 reads differently from a 500.
- `responseBody` — a truncated copy of the response body, useful when an API returns an error message in the body.
- `cause` — the underlying transport error (e.g. a buried `ECONNRESET`), preserved so the chain survives to the DevTool.

The thrown error also sets `retryable`: a 5xx, a network failure, or a timeout is retryable; a 4xx, an abort, or a parse failure is not. A generator's built-in retry reads this, so transient server failures are backed off for you without any extra wiring.

| Scenario | Behavior | Retryable |
|----------|----------|-----------|
| URL returns 404 (page gone) | Throws with `httpStatus: 404`, `errorType: "http"` | No |
| URL returns 5xx | Throws with `httpStatus`, `responseBody` | Yes |
| Bot wall (403) | Throws with `httpStatus: 403` and the wall's response body | No |
| Connection reset / DNS failure | Throws with `errorType: "network"`, `cause` preserved | Yes |
| Request times out | Throws with `errorType: "timeout"` | Yes |
| URL redirects | Follows redirects automatically (standard fetch behavior) | — |
| Page has no readable content | Returns best-effort markdown, no error | — |
| Firecrawl API error | Throws with the Firecrawl error message | No (fails fast — no status to judge) |

To branch on the failure yourself, read `error.details` in a rescue or catch:

```ts
try {
  await fetchTool.run({ url }, ctx);
} catch (error) {
  if (error instanceof FlowError && error.details?.httpStatus === 404) {
    // permanent — don't retry, pick a different source
  }
}
```

See [Error handling](/docs/advanced/error-handling) for the full error contract and how to consume `details` in a block.

## Next steps

- [Crawl tool](/docs/tools/crawl) — for multi-page site crawling
- [Tools overview](/docs/tools/overview) — all available tools
