---
title: Search
type: catalog
description: Web search across providers behind one interface.
---

# Search

`@flow-state-dev/tools` gives a generator web search through one tool that wraps seven providers.

## Why this exists

Every search provider has a different API, different parameter names, and a different idea of what "search" means. `tools.search` is one tool that picks whichever provider you have a key for, returns results in a single shape, and lets you tune how thorough the search is without rewriting code when you switch providers.

## Basic usage

```ts title="src/flows/research/blocks/researcher.ts"
import { generator } from "@flow-state-dev/core";
import { tools } from "@flow-state-dev/tools";

export const researcher = generator({
  name: "researcher",
  model: "anthropic/claude-sonnet-5-5",
  prompt: "Search the web to answer questions accurately.",
  tools: [tools.search()],
});
```

With no config, the tool picks a provider from your environment variables. The model calls `search` with a query and gets back titles, URLs, and snippets.

## Providers

The seven providers are Parallel, Tavily, Exa, Perplexity, Serper, Brave, and Perplexity Sonar. Each reads its own API key from an environment variable, and Tavily and Exa also need an optional package installed (`@tavily/core`, `exa-js`). The [Tools reference](../../reference/tools.md) lists every variable and package.

Perplexity and Perplexity Sonar share `PERPLEXITY_API_KEY`. Auto-detection reaches Perplexity first, so a Sonar search needs `provider: "perplexity-sonar"` or the `perplexitySonarSearch` constructor (below).

Unlike `tools.fetch()`, search has no built-in fallback. If no provider key is configured, the tool throws when it runs, not when you build it.

## Search depth tiers

The `tier` option trades latency against thoroughness. Providers with a depth setting map it to their own native parameter.

- `fast`: favor low latency.
- `balanced`: the default, each provider's standard behavior.
- `deep`: favor thoroughness, at the cost of more time.

```ts title="src/flows/research/tools/web-search.ts"
import { tools } from "@flow-state-dev/tools";

export const webSearch = tools.search({ tier: "deep" });
```

Pass `webSearch` to a generator's `tools` list in place of `tools.search()`. Serper and Brave have no depth setting and ignore `tier`. Parallel treats `deep` the same as `balanced`. The [Tools reference](../../reference/tools.md) shows what each provider receives.

### Letting the model choose the tier

By default `tier` is fixed in config, and the model never sees it. Set `agentControlsTier: true` to expose it as a tool parameter, so the model picks the depth per query, such as `deep` when the user asks for thorough research.

```ts title="src/flows/research/tools/web-search.ts"
import { tools } from "@flow-state-dev/tools";

export const webSearch = tools.search({ tier: "fast", agentControlsTier: true });
```

A `tier` set in config becomes the default, and the model can override it.

## How much content each result carries

`tier` sets how thorough the search is. `searchDepth` is a separate option that sets how much content each result carries. It is `"basic"` (the default) or `"advanced"`, and only config sets it, never the model.

```ts title="src/flows/research/tools/web-search.ts"
import { tools } from "@flow-state-dev/tools";

export const webSearch = tools.search({ searchDepth: "advanced" });
```

On Exa, `"advanced"` returns each page's full text in `content`. On Parallel, it returns longer excerpts. On Tavily, it selects Tavily's `advanced` retrieval depth, the same one `tier: "deep"` selects.

## Domain filters

`includeDomains` is an allowlist: results come only from those domains. `excludeDomains` is a denylist. Only config sets them, so the model cannot set or change them from inside a tool call. Every provider applies them.

```ts title="src/flows/research/tools/web-search.ts"
import { tools } from "@flow-state-dev/tools";

export const webSearch = tools.search({
  includeDomains: ["arxiv.org", "github.com"],
  excludeDomains: ["pinterest.com"],
});
```

Perplexity and Perplexity Sonar take an include list or an exclude list, not both. When you set both, only the include list is sent and `excludeDomains` is dropped, so an excluded subdomain of an included domain (`blog.arxiv.org` under `arxiv.org`) can appear in results. The [Tools reference](../../reference/tools.md) has the details per provider.

## Which provider runs

When you don't set `provider`, the tool uses the first provider that has a key, in this order: Parallel, Tavily, Exa, Perplexity, Serper, Brave, Perplexity Sonar.

The choice also depends on `tier`. With `tier: "deep"`, a keyed Serper or Brave is skipped for any other keyed provider, since neither has a depth setting. `fast` and `balanced` never change the choice. If no keyed provider can serve the tier, the first keyed provider in the order runs and ignores the tier.

For example, with `PERPLEXITY_API_KEY` and `BRAVE_SEARCH_API_KEY` both set and `tier: "deep"`, Perplexity runs. It comes before Brave in the order, and Brave serves only `fast` and `balanced`.

## Provider-native modes

`tier` covers the common cases. For a mode only one provider has, `searchMode` passes a string straight to the provider and takes precedence over `tier`:

```ts title="src/flows/research/tools/web-search.ts"
import { tools } from "@flow-state-dev/tools";

// Exa's neural retrieval, which the normalized tiers don't expose.
export const webSearch = tools.search({ provider: "exa", searchMode: "neural" });
```

Only Exa, Parallel, and Perplexity Sonar read `searchMode`. The other providers ignore it.

## What comes back

Every provider returns the same shape:

```jsonc
{
  "query": "your query",
  "results": [
    {
      "title": "Result title",
      "url": "https://example.com/page",
      "snippet": "Query-relevant excerpt",
      "content": "Full text, on some providers",
      "score": 0.92,
      "publishedDate": "2026-01-15",
      "source": "exa"
    }
  ],
  "answer": "Synthesized answer, on some providers"
}
```

`title`, `url`, `snippet`, and `source` are always present. `content`, `score`, `publishedDate`, and `answer` appear only when the provider supplies them. The [Tools reference](../../reference/tools.md) lists which providers fill which field. Failures throw, so a failed search never comes back as a result.

## Change it

To skip auto-detection, call a provider's constructor. Each takes the same config as `tools.search()`, minus `provider`. `keys` passes an API key in code instead of reading the environment variable.

```ts title="src/flows/research/tools/web-search.ts"
import { exaSearch } from "@flow-state-dev/tools";

export const webSearch = exaSearch({ tier: "deep", keys: { exa: "exa-key-here" } });
```

The other constructors are `tavilySearch`, `perplexitySearch`, `serperSearch`, `braveSearch`, `parallelSearch`, and `perplexitySonarSearch`.

## Built-in search on the generator

A generator's `search` field is a different system. It turns on the model provider's own web search (Anthropic, OpenAI, or Google), which runs inside the provider and returns grounded answers with citations. `tools.search` calls a third-party search API instead.

```ts title="src/flows/research/blocks/grounded-researcher.ts"
import { generator } from "@flow-state-dev/core";

export const groundedResearcher = generator({
  name: "groundedResearcher",
  model: "openai/gpt-6-luna",
  prompt: "Answer using current web results.",
  search: true,
});
```

The two share no configuration. `tier` applies only to `tools.search`, and `searchDepth` takes `"low"`, `"medium"` or `"high"` on the generator, not `"basic"` or `"advanced"`. Use `tools.search` when you need a specific provider or want to move between providers. Use the generator's `search` for the model provider's built-in grounding with minimal setup. See the [Generators reference](../../reference/generators.md) for the generator's fields.

## Next steps

- [Fetch tool](./fetch.md): read the full content of result URLs.
- [Tools overview](./index.md): all available tools.
- [Tools reference](../../reference/tools.md): providers, mappings and every option.
