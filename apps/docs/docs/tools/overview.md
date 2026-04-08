---
sidebar_position: 1
---

# Tools

`@flow-state-dev/tools` — Pre-built tools for common agentic tasks: web search, page fetching, and site crawling.

## What are tools?

Tools are handler blocks that give generators the ability to interact with the outside world. When you pass a tool to a generator, the LLM can decide when to call it during a conversation. The framework handles the tool-call loop, schema validation, and retry mechanics automatically.

The `@flow-state-dev/tools` package ships three built-in tools:

| Tool | What it does | Always works? |
|------|-------------|---------------|
| `tools.search()` | Web search via Tavily, Exa, Serper, or Brave | No — requires at least one search API key |
| `tools.fetch()` | Fetch a single web page as markdown | Yes — built-in fallback always available |
| `tools.crawl()` | Crawl a website (BFS), returning markdown for each page | Yes — built-in fallback always available |

## Provider auto-selection

All three tools follow the same pattern: detect which providers are available from environment variables, then use the best one. You can also force a specific provider or pass API keys explicitly.

```ts
import { tools } from "@flow-state-dev/tools";

// Auto-detect providers from env vars
const search = tools.search();
const fetch = tools.fetch();
const crawl = tools.crawl();

// Or force a specific provider
import { firecrawlFetch } from "@flow-state-dev/tools";
const fetch = firecrawlFetch({ keys: { firecrawl: "fc-..." } });
```

## Using tools in generators

Pass tools to a generator's `tools` array. The LLM decides when to call them.

```ts
import { generator } from "@flow-state-dev/core";
import { tools } from "@flow-state-dev/tools";

const researcher = generator({
  name: "researcher",
  model: "anthropic/claude-sonnet-4-6",
  prompt: "Search for information and read relevant pages to answer questions.",
  tools: [
    tools.search(),
    tools.fetch(),
    tools.crawl({ maxPages: 30, maxDepth: 2 }),
  ],
});
```

A common workflow the LLM will discover on its own: search for a topic, then fetch the most relevant results to read the full content.

## Environment variables

| Variable | Enables |
|----------|---------|
| `TAVILY_API_KEY` | Tavily search |
| `EXA_API_KEY` | Exa search |
| `SERPER_API_KEY` | Serper search |
| `BRAVE_SEARCH_API_KEY` | Brave search |
| `FIRECRAWL_API_KEY` | Firecrawl fetch + crawl (best quality) |
| `JINA_API_KEY` | Jina Reader fetch (optional — works without key at 20 RPM) |

With zero environment variables, `tools.fetch()` and `tools.crawl()` still work using the built-in fallback (Node.js fetch + Readability + Turndown). Only `tools.search()` requires at least one configured provider.

## Installation

The tools package is part of the monorepo. For external projects:

```bash
npm install @flow-state-dev/tools
```

Firecrawl requires an optional peer dependency:

```bash
npm install @mendable/firecrawl-js  # only if using Firecrawl
```

## Next steps

- [Fetch tool](/docs/tools/fetch) — single page fetching
- [Crawl tool](/docs/tools/crawl) — multi-page site crawling
