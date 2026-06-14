---
sidebar_position: 1
---

# Tools

`@flow-state-dev/tools` — Pre-built tools for common agentic tasks: web search, page fetching, and site crawling.

## What are tools?

Tools are handler blocks that give generators the ability to interact with the outside world. When you pass a tool to a generator, the LLM can decide when to call it during a conversation. The framework handles the tool-call loop, schema validation, and retry mechanics automatically.

The `@flow-state-dev/tools` package ships four built-in tools:

| Tool | What it does | Always works? |
|------|-------------|---------------|
| `tools.search()` | Web search via any configured provider | No — requires at least one search API key |
| `tools.fetch()` | Fetch a single web page as markdown | Yes — built-in fallback always available |
| `tools.crawl()` | Crawl a website (BFS), returning markdown for each page | Yes — built-in fallback always available |
| `createBashTool()` | Execute bash commands in a sandboxed workspace with resource sync | Yes — in-memory fallback always available |

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
| `PERPLEXITY_API_KEY` | Perplexity search and Sonar grounding |
| `PARALLEL_API_KEY` | Parallel search |
| `FIRECRAWL_API_KEY` | Firecrawl fetch + crawl (best quality) |
| `JINA_API_KEY` | Jina Reader fetch (optional — works without key at 20 RPM) |

With zero environment variables, `tools.fetch()` and `tools.crawl()` still work using the built-in fallback (Node.js fetch + Readability + Turndown). Only `tools.search()` requires at least one configured provider.

## Marking tools cacheable

A tool block can opt into result memoization by declaring `cacheable` on its config. When the tool runs under a Task Board with caching enabled, identical calls within the configured scope serve from cache instead of re-executing.

Two shorthands. Pass `true` for defaults, or a config object to tune scope, TTL, key derivation, or a per-call guard:

```ts
import { handler } from "@flow-state-dev/core";
import { z } from "zod";

const readArtifact = handler({
  name: "read-artifact",
  inputSchema: z.object({ key: z.string() }),
  outputSchema: z.object({ content: z.string() }),
  cacheable: { ttl: 60_000 },   // 60 seconds, "run" scope
  execute: async (input, ctx) => {
    const artifact = await ctx.resources.artifacts.get(input.key);
    return { content: artifact.content };
  },
});
```

Scope choices:

- `run` (default) — entries live for the current Task Board run.
- `request` — entries live for the lifetime of the request.
- `session` — entries persist across requests within the same session.

Errors are never cached. If `execute` throws, no entry is written and the next caller re-runs the block. Identical in-flight calls within the same request coalesce into one execution, so two workers asking for the same key at the same time share the result instead of racing.

Don't mark a tool cacheable if it mutates state, depends on time or randomness not captured in its arguments, or if a stale result would cause real harm. A cache hit isn't always a correct hit.

The cross-task observation flow that pairs with this layer is documented in the [Flow policy](/docs/patterns/flow-policy) guide — observations get recorded whether or not the tool is cacheable.

## Requiring approval

A tool can demand a human sign-off before it runs. The tool owns both the decision and the UI: declare an `approval` object on the tool block.

```ts
import { handler } from "@flow-state-dev/core";
import { z } from "zod";

const transfer = handler({
  name: "transfer-funds",
  inputSchema: z.object({ to: z.string(), amount: z.number() }),
  outputSchema: z.object({ confirmation: z.string() }),
  approval: {
    required: (args) => args.amount > 1000,   // gate large transfers only
    message: (args) => `Approve transfer of $${args.amount}?`,
    render: { component: "transfer-approval" },
  },
  execute: async (input) => ({ confirmation: await sendTransfer(input) }),
});
```

`approval.required` decides whether the call needs sign-off — `true` gates every call, or a predicate that receives the parsed tool arguments and the block context and decides per call (gate on the arguments, or read session or user state from `ctx`). `approval.message` is the prompt shown in the approval UI, and `approval.render` names a custom component for it. Because each tool declares its own `message` and `render`, a generator can hold several gated tools that each present a different approval panel, with no central policy to edit.

When a generator calls a gated tool, the model turn ends, the request suspends, and a human approves or denies before the call executes. This takes effect only when the calling generator runs with a `DurabilityProvider` configured — a gated call without one fails fast.

The generator can override these declarations with its `toolApproval` handling policy: `"auto"` runs everything without gating, `"all"` gates everything, and the object form auto-approves or requires specific tools. The generator's policy wins over the tool's declaration. See [Tool approval](/docs/human-in-the-loop/tool-approval) for the full handling policy, the suspension shape, and how a human resolves it.

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

- [Search tool](/docs/tools/search) — multi-provider web search with depth tiers
- [Fetch tool](/docs/tools/fetch) — single page fetching
- [Crawl tool](/docs/tools/crawl) — multi-page site crawling
- [Bash tool](/docs/tools/bash) — sandboxed command execution with resource sync
- [Claude Code remote dispatch](/docs/tools/claude-code-cli) — dispatch a cloud coding task via the local `claude` CLI (separate `@flow-state-dev/claude-code` package)
- [Claude Code SDK agent](/docs/tools/claude-code-sdk) — run a Claude Code agent in-process with streaming items and a persistent session (separate `@flow-state-dev/claude-code` package, optional `@anthropic-ai/claude-agent-sdk` peer)
