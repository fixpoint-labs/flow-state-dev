---
title: Tools
type: catalog
description: The tool blocks that ship, in one table, and how any of them reaches a generator.
---

# Tools

Your model needs to look something up on the web, read a page, or run a command. `@flow-state-dev/tools` ships the blocks that do that, so you don't write the HTTP calls and provider glue yourself.

## What you get

A tool is a handler block a generator can call. The generator shows the model the tool's description and input schema, the model decides when to call it, and its arguments are checked against that schema before the tool runs. A shipped tool is the same kind of block as one you write.

| Tool | What it does | Setup |
|------|-------------|-------|
| `tools.search()` | Web search through a provider | Needs at least one search API key |
| `tools.fetch()` | Fetch one page as markdown | None |
| `tools.crawl()` | Crawl a site from a root URL, returning markdown per page | None |
| `createBashCapability()` | Run bash commands in a sandbox; files from your resource collections are copied in and changes are copied back | Needs the optional `just-bash` package |
| `createMcpCapability()` | Expose the tools of MCP servers | Needs the optional `@ai-sdk/mcp` package |

Search, fetch and crawl go in a generator's `tools` array. Bash and MCP attach through `uses`; see their pages.

## Install it

```bash
npm install @flow-state-dev/tools
```

Each provider's client library is an optional peer package, installed only when you use that provider. The [Search](/docs/tools/search), [Fetch](/docs/tools/fetch) and [Crawl](/docs/tools/crawl) pages list them.

## Give tools to a generator

```ts title="src/flows/research/researcher.ts"
import { generator } from "@flow-state-dev/core";
import { tools } from "@flow-state-dev/tools";

export const researcher = generator({
  name: "researcher",
  model: "openai/gpt-6-luna",
  prompt: "Search for information, then read the pages that look relevant.",
  tools: [
    tools.search(),
    tools.fetch(),
    tools.crawl({ maxPages: 30, maxDepth: 2 }),
  ],
});
```

With search and fetch together, the model can search, then read the pages it finds.

A generator also has its own `search` option that uses the model provider's built-in search. It needs no key from this package; `tools.search()` does.

## Pick a provider

Search, fetch and crawl choose a provider from the API keys in your environment. Search needs one key, such as `TAVILY_API_KEY`. Without one, running the tool fails with "No search provider available". Fetch and crawl need no key. With none set, they use a built-in fetcher that returns markdown, and a `FIRECRAWL_API_KEY` switches them to Firecrawl.

To choose yourself, pass keys or call a provider's factory:

```ts title="src/flows/research/tools/firecrawl.ts"
import { tools, firecrawlFetch } from "@flow-state-dev/tools";

// Keys passed here win over environment variables.
export const search = tools.search({ keys: { tavily: "tvly-..." } });

// Force one provider; this throws if it has no key.
export const firecrawl = firecrawlFetch({ keys: { firecrawl: "fc-..." } });
```

The [Search](/docs/tools/search), [Fetch](/docs/tools/fetch) and [Crawl](/docs/tools/crawl) pages list every provider, its key variable and the order they are tried in.

## Cache a tool's results

A tool block can declare `cacheable`, so identical calls reuse the first result instead of running again. Pass `true` for the defaults, or an object to set scope, TTL, the cache key or a per-call guard.

```ts title="src/flows/research/tools/exchange-rate.ts"
import { handler } from "@flow-state-dev/core";
import { z } from "zod";

export const exchangeRate = handler({
  name: "exchange-rate",
  description: "Look up the current exchange rate for a currency pair.",
  inputSchema: z.object({ pair: z.string() }),
  outputSchema: z.object({ rate: z.number() }),
  cacheable: { ttl: 60_000 }, // 60 seconds, default "run" scope
  execute: async (input) => {
    const res = await fetch(`https://rates.example.com/${input.pair}`);
    return { rate: (await res.json()).rate };
  },
});
```

Caching applies when the block is a tool in a generator's `tools` slot and a tool cache is installed: add `createToolCacheCapability()` from `@flow-state-dev/core` to the generator's `uses`. A [task board](/docs/orchestration/task-board) installs one for you when a worker's tool declares `cacheable`. Anywhere else, `cacheable` has no effect.

Scope is `run` (default, the current task board run), `request`, or `session` (across requests in a session). Errors are never cached: if `execute` throws, the next call runs the block again.

Don't mark a tool cacheable if it changes state, depends on time or randomness its arguments don't capture, or if a stale result would do real harm.

## Next steps

- [Search tool](/docs/tools/search): multi-provider web search
- [Fetch tool](/docs/tools/fetch) and [Crawl tool](/docs/tools/crawl): read one page or a whole site
- [Bash tool](/docs/tools/bash): sandboxed commands over your resource collections
- [Coding agents](/docs/tools/coding-agents): run Claude Code, Codex or Cursor as a block
