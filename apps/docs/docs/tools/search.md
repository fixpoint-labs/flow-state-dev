---
sidebar_position: 2
---

# Search

`@flow-state-dev/tools` — Web search for generators, across one normalized interface that wraps seven providers.

## Why this exists

Search is the tool agents reach for most. The problem is that every provider has a different API, different parameter names, and a different idea of what "search" means. `tools.search` gives you one tool that auto-detects whichever provider you have a key for, normalizes the results into a single shape, and lets you tune how deep the search goes without rewriting code when you switch providers.

## Basic usage

```ts
import { generator } from "@flow-state-dev/core";
import { tools } from "@flow-state-dev/tools";

const researcher = generator({
  name: "researcher",
  model: "anthropic/claude-sonnet-4-6",
  prompt: "Search the web to answer questions accurately.",
  tools: [tools.search()],
});
```

With no config, the tool picks a provider from your environment variables. The LLM calls `search` with a query and gets back titles, URLs, and snippets.

## Providers

| Provider | Env var | Package |
|----------|---------|---------|
| Parallel | `PARALLEL_API_KEY` | _(fetch-based, no extra dep)_ |
| Tavily | `TAVILY_API_KEY` | `@tavily/core` (optional peer dep) |
| Exa | `EXA_API_KEY` | `exa-js` (optional peer dep) |
| Perplexity | `PERPLEXITY_API_KEY` | _(fetch-based, no extra dep)_ |
| Serper | `SERPER_API_KEY` | _(fetch-based, no extra dep)_ |
| Brave | `BRAVE_SEARCH_API_KEY` | _(fetch-based, no extra dep)_ |
| Perplexity Sonar | `PERPLEXITY_API_KEY` | _(fetch-based, no extra dep)_ |

Unlike `tools.fetch()`, search has no built-in fallback. If no provider key is configured, the tool throws at execution time.

## Search depth tiers

The `tier` option is a provider-agnostic knob for the tradeoff between latency and thoroughness. It's a small vocabulary, mapped to whatever native parameter each provider exposes:

- `fast` — favor low latency. Good for quick lookups and autocomplete-style queries.
- `balanced` — the default. Reproduces each provider's standard behavior.
- `deep` — favor thoroughness. Good for research and enrichment, at the cost of more time.

```ts
tools.search({ tier: "deep" });
```

Here's how each tier lands on each provider:

| Provider | `fast` | `balanced` | `deep` |
|----------|--------|-----------|--------|
| Exa | `type: "fast"` | `type: "auto"` | `type: "deep"` |
| Tavily | `basic` depth | `basic` depth | `advanced` depth |
| Perplexity | `search_context_size: low` | provider default | `search_context_size: high` |
| Perplexity Sonar | `sonar` model | `sonar` model | `sonar-reasoning` model |
| Parallel | `mode: basic` | `mode: advanced` | `mode: advanced` |
| Serper | no depth control | no depth control | no depth control |
| Brave | no depth control | no depth control | no depth control |

Serper and Brave are thin wrappers with no depth concept, so the tier has no effect on them. That matters for provider selection (below).

## Domain filters

Restrict or exclude domains where the provider supports it:

```ts
tools.search({
  includeDomains: ["arxiv.org", "github.com"],
  excludeDomains: ["pinterest.com"],
});
```

Exa, Tavily, Perplexity, and Parallel apply these natively. Serper emulates them with Google `site:` operators. Brave has no domain filter, so the values are ignored there.

## Provider selection

When you don't set `provider`, the tool checks for keys in priority order and uses the first one it finds:

```
Parallel → Tavily → Exa → Perplexity → Serper → Brave → Perplexity Sonar
```

Selection is also tier-aware. If you request `tier: "deep"` and several providers are configured, the tool skips providers that can't serve a deep search. So a `deep` request will route past Serper and Brave even when their keys are present and they sit earlier in the priority order. The `balanced` default supports every provider, so it never changes the selection.

If no tier-capable provider has a key, the tool falls back to the priority order and the chosen provider does its best with whatever it supports.

## Provider-native passthrough

The `tier` vocabulary is deliberately small and doesn't cover provider-specific behaviors. For those, `searchMode` overrides the tier mapping with a value passed straight to the provider:

```ts
// Reach Exa's neural retrieval, which the normalized tiers don't expose:
tools.search({ provider: "exa", searchMode: "neural" });
```

`searchMode` is read by the providers that have a native mode field (Exa maps it to `type`, Parallel to `mode`, Perplexity Sonar to the model name). When set, it takes precedence over whatever the `tier` would have selected.

## Output shape

Every provider returns the same normalized result:

```ts
{
  query: "your query",
  results: [
    {
      title: "Result title",
      url: "https://example.com/page",
      snippet: "Query-relevant excerpt",
      content: "Full text (when searchDepth is advanced)",
      score: 0.92,           // when the provider returns one
      publishedDate: "2026-01-15",
      source: "exa",         // which provider produced this result
    },
  ],
  answer: "Synthesized answer (grounding providers like Sonar)",
}
```

`searchDepth` (`"basic"` or `"advanced"`) is separate from `tier`. It controls how much content is pulled per result, not how thorough the search itself is.

## Direct provider constructors

To skip auto-detection and lock to one provider:

```ts
import {
  tavilySearch,
  exaSearch,
  perplexitySearch,
  serperSearch,
  braveSearch,
  parallelSearch,
  perplexitySonarSearch,
} from "@flow-state-dev/tools";

const search = exaSearch({ tier: "deep", keys: { exa: "..." } });
```

Each constructor accepts the same config as `search()` minus `provider`.

## Provider-native search on the generator

For search executed inside the model provider (grounded responses with inline citations), use the `search` field on the generator instead of an external tool:

```ts
generator({ search: true });
```

See the generator docs in `@flow-state-dev/core` for details.

## Next steps

- [Fetch tool](/docs/tools/fetch) — read the full content of result URLs
- [Tools overview](/docs/tools/overview) — all available tools
