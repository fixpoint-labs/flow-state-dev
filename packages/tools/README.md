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

| Provider | Env var | Package |
|----------|---------|---------|
| Tavily | `TAVILY_API_KEY` | `@tavily/core` (optional peer dep) |
| Exa | `EXA_API_KEY` | `exa-js` (optional peer dep) |
| Serper | `SERPER_API_KEY` | _(fetch-based, no extra dep)_ |
| Brave | `BRAVE_SEARCH_API_KEY` | _(fetch-based, no extra dep)_ |

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
import { tavilySearch, exaSearch, serperSearch, braveSearch } from "@flow-state-dev/tools/search";
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

## Bash

Resource-backed bash execution with pluggable sandbox adapters. Files live as framework resources for persistence and portability. They're materialized into a real filesystem for execution, then synced back after mutations.

```typescript
import { createBashTool } from "@flow-state-dev/tools/bash";
import { providerTool } from "@flow-state-dev/core";

// Inside a handler's execute function:
const { tools, sandbox } = await createBashTool({
  collections: { files: ctx.session.resources.files },
  provider: { type: "local", cwd: "./workspace" },
});

// Pass to a generator as provider tools:
generator({
  providerTools: [
    providerTool("bash", tools.bash),
    providerTool("readFile", tools.readFile),
    providerTool("writeFile", tools.writeFile),
  ],
});
```

### Sandbox adapters

| Adapter | Provider type | Description |
|---------|--------------|-------------|
| Local FS | `"local"` | Real filesystem + `child_process`. Best for development. |
| Vercel | `"vercel"` | `@vercel/sandbox`. Supports persistent sandboxes. |
| Upstash | `"upstash"` | Placeholder — blocked on API stabilization (FIX-314). |
| just-bash | `"just-bash"` | In-memory bash emulation. No real processes. |
| Custom | `"custom"` | Any object implementing the `Sandbox` interface. |

### Configuration

```typescript
createBashTool({
  collections: { files: ctx.session.resources.files },
  provider: { type: "vercel" },
  destination: "/workspace",     // workspace root (default: "/workspace")
  persist: true,                 // persist sandbox across sessions
  syncMode: "diff",              // "diff" (default) or "full"
  fileFilter: (p) => !p.includes("node_modules"),
  onBeforeCommand: (cmd) => {
    if (cmd.includes("rm -rf /")) return "echo 'Nice try.'";
  },
});
```

### Sync lifecycle

1. **Hydrate** — resource collection entries are written into the sandbox filesystem
2. **Execute** — `bash`, `readFile`, `writeFile` tools are available to the LLM
3. **Flush** — after every `bash` and `writeFile`, changed files sync back to resources
4. Deleted files are removed from resource collections. `readFile` does not trigger a flush.

### Direct adapter constructors

```typescript
import {
  createLocalFsSandbox,
  createVercelAdapter,
  createJustBashSandbox,
} from "@flow-state-dev/tools/bash";
```

## Provider-native search

For provider-level search tools (grounded responses, citations), use the `search` field on generator config instead:

```typescript
generator({
  search: true, // uses the model provider's native search tool
});
```

See `@flow-state-dev/core` generator docs for details.
