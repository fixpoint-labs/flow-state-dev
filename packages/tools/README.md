# @flow-state-dev/tools

Portable tool blocks for `@flow-state-dev` flows. Each tool is a handler block that can be passed directly to a generator's `tools` array.

## Search

Multi-provider web search with automatic provider detection.

```typescript
import { search } from "@flow-state-dev/tools/search";

const webSearch = search(); // auto-detects from env vars

generator({
  tools: [webSearch],
  // ...
});
```

### Providers

Provider is selected automatically based on available API keys (checked in order):

| Provider | Env var | Package | Result type |
|----------|---------|---------|-------------|
| Tavily | `TAVILY_API_KEY` | `@tavily/core` (optional peer dep) | Raw results |
| Exa | `EXA_API_KEY` | `exa-js` (optional peer dep) | Raw results |
| Perplexity | `PERPLEXITY_API_KEY` | _(fetch-based, no extra dep)_ | Raw results |
| Serper | `SERPER_API_KEY` | _(fetch-based, no extra dep)_ | Raw results |
| Brave | `BRAVE_SEARCH_API_KEY` | _(fetch-based, no extra dep)_ | Raw results |
| Perplexity Sonar | `PERPLEXITY_API_KEY` | _(fetch-based, no extra dep)_ | Grounded answer + citations |

Perplexity Search API returns raw ranked web results (hybrid lexical + semantic retrieval). Perplexity Sonar returns AI-synthesized answers with source citations, similar to Gemini grounding. When `PERPLEXITY_API_KEY` is set, auto-detection prefers the Search API. Use `perplexitySonarSearch()` to explicitly select the Sonar grounding provider.

### Configuration

```typescript
search({
  provider: "tavily",        // override auto-detection
  maxResults: 10,            // default: 5
  searchDepth: "advanced",   // "basic" (default) or "advanced"
  topic: "news",             // "general" (default) or "news"
  keys: { tavily: "sk-..." }, // explicit keys (default: env vars)
});
```

### Direct provider constructors

```typescript
import {
  tavilySearch,
  exaSearch,
  perplexitySearch,
  serperSearch,
  braveSearch,
  perplexitySonarSearch,
} from "@flow-state-dev/tools/search";
```

## Fetch

Fetch a single web page and return its content as clean, LLM-ready markdown.

```typescript
import { fetch } from "@flow-state-dev/tools/fetch";

const pageFetch = fetch(); // auto-detects from env vars

generator({
  tools: [pageFetch],
  // ...
});
```

### Providers

| Provider | Env var | Package |
|----------|---------|---------|
| Firecrawl | `FIRECRAWL_API_KEY` | `@mendable/firecrawl-js` (optional peer dep) |
| Jina Reader | `JINA_API_KEY` (optional) | _(fetch-based, no extra dep)_ |
| Built-in | _(none needed)_ | _(uses Readability + Turndown)_ |

Always works — falls back to built-in when no API keys are set.

### Direct provider constructors

```typescript
import { firecrawlFetch, jinaFetch, builtinFetch } from "@flow-state-dev/tools/fetch";
```

## Crawl

Crawl a website starting from a root URL, following links breadth-first.

```typescript
import { crawl } from "@flow-state-dev/tools/crawl";

const siteCrawl = crawl({ maxPages: 30, maxDepth: 2 });

generator({
  tools: [siteCrawl],
  // ...
});
```

### Providers

| Provider | Env var | Package |
|----------|---------|---------|
| Firecrawl | `FIRECRAWL_API_KEY` | `@mendable/firecrawl-js` (optional peer dep) |
| Built-in | _(none needed)_ | _(BFS crawler with Readability + Turndown)_ |

Always works — falls back to built-in BFS crawler when no API keys are set.

### Direct provider constructors

```typescript
import { firecrawlCrawl, builtinCrawl } from "@flow-state-dev/tools/crawl";
```

## Provider-native search

For provider-level search tools (grounded responses, citations), use the `search` field on generator config instead:

```typescript
generator({
  search: true, // uses the model provider's native search tool
});
```

See `@flow-state-dev/core` generator docs for details.
