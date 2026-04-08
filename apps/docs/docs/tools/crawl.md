---
sidebar_position: 3
---

# Crawl

`@flow-state-dev/tools` — Crawl a website starting from a root URL, following links breadth-first, and return markdown for each page found.

## Why this exists

Sometimes you need more than a single page. Documentation sites, knowledge bases, competitor analysis, research across an entire domain. `tools.crawl` handles the mechanics: link discovery, BFS traversal, depth limits, page limits, URL filtering, and rate limiting.

Two providers:

| Provider | How it works | Depth control | Page limits | URL filtering | Env var |
|----------|-------------|---------------|-------------|---------------|---------|
| Firecrawl | Managed API (async crawl) | Yes | Yes | Regex patterns | `FIRECRAWL_API_KEY` |
| Built-in | Local BFS with fetch + Readability | Yes | Yes | Glob patterns | None needed |

The built-in crawler always works. It follows same-origin links using BFS, respects your depth and page limits, and rate-limits to 1 request per second to be polite. For production crawling at scale, Firecrawl handles JS rendering, anti-bot, and parallel crawling.

## Basic usage

```ts
import { generator } from "@flow-state-dev/core";
import { tools } from "@flow-state-dev/tools";

const docsCrawler = generator({
  name: "docs-crawler",
  model: "anthropic/claude-sonnet-4-6",
  prompt: "Crawl documentation sites and build a knowledge summary.",
  tools: [tools.crawl()],
});
```

The LLM provides a root URL and optionally specifies how many pages and how deep to crawl. The tool returns markdown content for every page found.

## Configuration

```ts
tools.crawl({
  // Force a specific provider
  provider: "firecrawl",  // "firecrawl" | "builtin"

  // Default limits (LLM can override per call)
  maxPages: 50,
  maxDepth: 3,

  // URL pattern filtering
  includePatterns: ["/docs/**", "/api/**"],
  excludePatterns: ["/docs/changelog/**", "/admin/**"],

  // JS rendering (Firecrawl only)
  waitForJS: true,

  // Explicit API keys
  keys: {
    firecrawl: "fc-...",
  },
})
```

### What the LLM controls vs. what you configure

Some parameters are set at **definition time** (your code), others at **call time** (the LLM decides):

| Parameter | Who sets it | Why |
|-----------|------------|-----|
| `maxPages` | Both — config sets default, LLM can override | Scope is a semantic decision. A research agent might want 50 pages, a fact-checker wants 5. |
| `maxDepth` | Both — config sets default, LLM can override | Same reasoning. |
| `includePatterns` | You (config only) | Safety boundary. You decide which parts of a site are fair game. |
| `excludePatterns` | You (config only) | Safety boundary. Keep admin, auth, and irrelevant sections out. |
| `waitForJS` | You (config only) | Infrastructure concern, not a semantic decision. |
| `provider` | You (config only) | Infrastructure concern. |

## Provider resolution

```
FIRECRAWL_API_KEY set?  →  Firecrawl (async crawl, JS rendering, parallel)
Always                  →  Built-in BFS (sequential, static HTML, rate-limited)
```

Like `tools.fetch()`, the crawl tool never throws "no provider available".

## Output shape

```ts
{
  rootUrl: "https://docs.example.com",
  pages: [
    {
      url: "https://docs.example.com",
      title: "Documentation Home",
      markdown: "# Docs\n\nWelcome to...",
      metadata: {
        statusCode: 200,
        contentType: "text/html",
        wordCount: 523,
      },
      source: "builtin"
    },
    {
      url: "https://docs.example.com/getting-started",
      title: "Getting Started",
      markdown: "# Getting Started\n\n...",
      metadata: { statusCode: 200, contentType: "text/html", wordCount: 1847 },
      source: "builtin"
    },
    // ... more pages
  ],
  totalPages: 12,
  crawlDepth: 2,
  source: "builtin"
}
```

Each page in the `pages` array has the same shape as a `tools.fetch()` result.

## How the built-in crawler works

The built-in provider uses breadth-first search:

1. Start at the root URL
2. Fetch the page, extract content with Readability + Turndown
3. Parse all `<a href>` links from the HTML
4. Filter to same-origin only (no external links)
5. Apply include/exclude patterns
6. Add new URLs to the queue at `depth + 1`
7. Continue until `maxPages` or `maxDepth` is reached

Key behaviors:
- **Same-origin only** — the crawler won't follow links to external sites
- **1-second delay** between requests to avoid hammering servers
- **URL normalization** — trailing slashes and hash fragments are stripped to prevent duplicate visits
- **Graceful failure** — if a single page fails (404, timeout, non-HTML), the crawler skips it and continues
- **Non-HTML skipped** — PDFs, images, and other non-HTML responses are ignored

## URL pattern matching

Patterns use glob syntax matched against the URL path:

```ts
tools.crawl({
  includePatterns: ["/docs/**"],     // Only crawl /docs/ and below
  excludePatterns: ["/docs/v1/**"],  // But skip the old v1 docs
})
```

| Pattern | Matches | Doesn't match |
|---------|---------|---------------|
| `/docs/**` | `/docs/intro`, `/docs/api/ref` | `/blog/post` |
| `/docs/*` | `/docs/intro` | `/docs/api/ref` (too deep) |
| `/blog/2026-*` | `/blog/2026-01-post` | `/blog/2025-12-post` |

If `includePatterns` is empty (the default), all same-origin pages are included. If `excludePatterns` is empty, nothing is excluded.

## Direct provider constructors

```ts
import { firecrawlCrawl, builtinCrawl } from "@flow-state-dev/tools";

// Always use Firecrawl (throws if no API key)
const crawl = firecrawlCrawl({ keys: { firecrawl: "fc-..." } });

// Always use built-in BFS
const crawl = builtinCrawl();
```

## Full example: search, fetch, crawl

All three tools compose naturally. The LLM picks the right tool for the task.

```ts
import { generator } from "@flow-state-dev/core";
import { tools } from "@flow-state-dev/tools";

const researcher = generator({
  name: "researcher",
  model: "anthropic/claude-sonnet-4-6",
  prompt: `You are a research assistant. 
Use search to find relevant sources.
Use fetch to read individual pages in full.
Use crawl when you need to understand an entire site or documentation set.`,
  tools: [
    tools.search(),
    tools.fetch(),
    tools.crawl({ maxPages: 30, maxDepth: 2 }),
  ],
});
```

## Limitations of the built-in crawler

The built-in crawler is for development and prototyping. It works well for static HTML sites (documentation, blogs, wikis). It won't handle:

- **JavaScript-rendered pages** — returns whatever the server sends as static HTML
- **Anti-bot protection** — sites behind Cloudflare or similar will block it
- **Authentication** — no cookie or session handling
- **robots.txt** — not respected in Phase 1 (the 1-second rate limit provides basic politeness)

For production crawling, use Firecrawl. It handles all of the above.

## Error handling

| Scenario | Behavior |
|----------|----------|
| Root URL fails | Throws an error |
| Individual page fails | Skips it, continues crawling other pages |
| Non-HTML content | Skips it (only processes text/html) |
| External links | Ignored (same-origin only) |
| Infinite calendar/pagination | `maxPages` limit prevents runaway |
| Firecrawl timeout | Firecrawl SDK handles polling internally |

## Next steps

- [Fetch tool](/docs/tools/fetch) — for single page fetching
- [Tools overview](/docs/tools/overview) — all available tools
