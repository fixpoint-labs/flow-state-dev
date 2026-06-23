---
sidebar_position: 6
---

# Searching resources

Resources are addressable by key, and a collection can list instances under a prefix. That covers "give me `concepts/react`" and "give me everything under `concepts/`". It does not cover "find the concept whose body mentions `useEffect`" or "which concepts are about hooks". For those, an agent used to drop to bash.

`resourceSearchTools()` returns three handler blocks that close that gap — the same Glob/Grep/Search split you know from a coding agent, but over resources:

- **`globResources`** finds resources by path pattern.
- **`grepResourceContent`** finds lines in resource content by regex or substring.
- **`searchResources`** ranks resources by lexical relevance to a query.

"Lexical" here means exact word and substring matching — counting where your terms literally appear. It does not understand meaning or synonyms. For fuzzy, meaning-aware recall, reach for [memory](/docs/memory/overview) or a retrieval layer instead.

```ts
import { generator, resourceSearchTools } from "@flow-state-dev/core";

const search = resourceSearchTools();

const librarian = generator({
  name: "librarian",
  model: "openai/gpt-5.4-mini",
  prompt: "Answer using the knowledge base. Find relevant concepts before answering.",
  tools: [search.globResources, search.grepResourceContent, search.searchResources],
});
```

All three span both static resources and collection instances — a collection instance is itself a resource, so you don't choose between them. A collection's instances are searchable once the collection opts in with `llmReadable` (see [Collections — LLM access](/docs/resources/collections#llm-access)).

Each result is the resource's scope-qualified uri (for example `session/concepts/react`) — the same handle [`readResourceContentTool`](/docs/resources/overview#llm-access-patterns) accepts, so a search result feeds straight into a read. Glob patterns and the grep/search `prefix` match the within-scope path (you write `concepts/**`, not `session/concepts/**`); only the results carry the scope.

## Glob by path — `globResources`

Match resource paths against a glob pattern. This is the deterministic "I know roughly where it is" tool. It reads no content, so it's cheap.

```text
concepts/**        →  concepts/react, concepts/react/hooks, …    (any depth)
concepts/*         →  concepts/react                             (one level, not concepts/react/hooks)
concepts/*hooks*   →  concepts/react-hooks                       (within-segment substring; a prefix can't express this)
```

With no pattern (`null`), `globResources` returns every resource uri, sorted. It's a superset of a prefix listing: `globResources("concepts/**")` covers what a prefix list of `concepts` would, plus the patterns prefixes can't reach. Results are bounded by `limit` (default 100).

Glob is discovery, so it does not filter on `llmReadable` — it surfaces uris the same way listing does.

## Grep content — `grepResourceContent`

Search content bodies for a pattern, line by line. Returns each match as `{ uri, line, snippet }`, with 1-based line numbers.

```ts
// pattern: "useEffect"
// → [{ uri: "org/concepts/react", line: 2, snippet: "the useEffect hook runs after render" }]
```

The pattern is treated as a regular expression. If it isn't valid regex, it's matched as a literal substring instead, so `a(` searches for the text `a(` rather than erroring. Scope the search with `prefix` (a path prefix), and cap output with `maxResults` (default 50).

## Ranked search — `searchResources`

When you have keywords rather than an exact string, `searchResources` scores each resource by how often your terms appear in its content and returns the top matches as `{ uri, score, snippet }`, highest score first.

```ts
// query: "react hooks"
// → [{ uri: "org/concepts/react-hooks", score: 5, snippet: "..." }, ...]
```

Resources that don't match at all are dropped. Scope with `prefix` and cap with `limit` (default 10).

## Choosing a tool

- **Glob** when you can describe the path: `concepts/**`, `decisions/2026-*`. Deterministic, no content read.
- **Grep** when you need an exact string or pattern inside the content, and you want the matching lines.
- **Search** when you have keywords and want the most relevant resources ranked, not every literal hit.

## Limits and readability

`grepResourceContent` and `searchResources` read content, so they only see resources marked `llmReadable` — the same gate as [`readResourceContentTool`](/docs/resources/overview#llm-access-patterns). The gate covers collection instances too: a collection's instances are searchable once the collection sets `llmReadable`. A resource the LLM can't read won't appear in their results. `globResources` lists uris regardless. They match the *rendered* content — the same text `readResourceContentTool` returns — so a resource whose body is a state-driven template is found by the words it renders to, not by its template source.

All three identify each match by its scope-qualified uri (for example `session/concepts/react`) — the same handle `readResourceContentTool` accepts, so a uri from a search result feeds straight into a read or write with no translation.

Search and grep are lexical. They're a good fit for curated, bounded content where answers live in the words on the page. They are not a substitute for semantic retrieval over a large, uncurated corpus — that's what [memory](/docs/memory/overview) and a retrieval layer are for.

`grepResourceContent` treats its pattern as a regular expression, falling back to a literal match when the pattern isn't valid regex. It runs line by line over trusted resource content and does not sandbox the pattern, so a pathological regex can be slow. Isolate the call before pointing it at attacker-controlled patterns.
