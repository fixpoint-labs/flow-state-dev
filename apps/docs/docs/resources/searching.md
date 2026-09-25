---
sidebar_position: 6
---

# Searching resources

Resources are addressable by key, and a collection can list instances under a prefix. That covers "give me `concepts/react`" and "give me everything under `concepts/`". It does not cover "find the concept whose body mentions `useEffect`" or "which concepts are about hooks". The first is a text search, covered below. The second is a question about meaning, and the cheapest way to answer it is to ask once, when the content is written, and keep the answer. That's [facets](#find-by-facets).

`resourceSearchTools()` returns three handler blocks that close the text half of that gap — the same Glob/Grep/Search split you know from a coding agent, but over resources:

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

All three span both static resources and `defineResourceCollection` instances — a collection instance is itself a resource, so you don't choose between them. A collection's instances are searchable once the collection opts in with `llmReadable` (see [Collections — LLM access](/docs/resources/collections#llm-access)).

On a [projected collection](/docs/resources/projected-collections), `searchResources` sends the query to the collection's `search` hook. `globResources` and `grepResourceContent` skip them.

Each result is the resource's scope-qualified uri (for example `session/concepts/react`) — the same handle [`readResourceContentTool`](/docs/resources/overview#llm-access-patterns) accepts, so a search result feeds straight into a read. Glob patterns and the grep/search `prefix` match the within-scope path (you write `concepts/**`, not `session/concepts/**`); only the results carry the scope.

## Glob by path — `globResources`

Match resource paths against a glob pattern. This is the deterministic "I know roughly where it is" tool. It reads no content, so it's cheap.

```text
concepts/**        →  concepts/react, concepts/react/hooks, …    (any depth)
concepts/*         →  concepts/react                             (one level, not concepts/react/hooks)
concepts/*hooks*   →  concepts/react-hooks                       (within-segment substring; a prefix can't express this)
```

With no pattern (`null`), `globResources` returns every resource uri the agent can read, sorted. It's a superset of a prefix listing: `globResources("concepts/**")` covers what a prefix list of `concepts` would, plus the patterns prefixes can't reach. Results are bounded by `limit` (default 100).

Glob reads no content, but a path is still something you may not want an agent to see, so it applies the same `llmReadable` gate as the other two. A collection that hasn't opted in is skipped before it is read, so nothing is loaded to work out that it was off limits.

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

## Find by facets

Some searches aren't about words. "Open billing tickets" should find the ticket that says "my card was billed again for a plan I already paid for", which never says "open" and never says "billing". A model can answer that, but asking it on every search is slow and costs a call per lookup.

Facets move the question to write time. When a document's body is written, an [evaluator](/docs/fundamentals/blocks#evaluator--the-questions-you-already-know) answers a few fixed questions about it (which topic, what status) and the answers are stored on the document. Searching is then a filter over stored answers. No model runs.

The pattern uses a `facets` field on the collection's state, a [reactive block](/docs/resources/reactive-blocks) on `contentUpdated` that fills it, and a search that reads it.

```ts
export const ticketQuestions = {
  topic: choice("What is this support ticket about?", TOPICS), // billing | outage | other
  status: choice("Is the customer's problem still open?", STATUSES), // open | closed
};

export function ticketsFlow(triage: TicketEvaluator) {
  const tickets = defineResourceCollection({
    pattern: "tickets/*",
    scope: "user",
    stateSchema: z.object({
      title: z.string(),
      facets: ticketFacetsSchema.nullable().default(null),
      indexedAs: z.string().nullable().default(null), // which write the facets may describe
    }),
    reactTo: { contentUpdated: indexFacets(triage) },
  });
  // … actions: write, search, reindex
}
```

The flow takes the evaluator as a parameter. Build it where you configure the app, so the model is named in one place:

```ts
const triage = evaluator({ name: "ticket-facets", model: "typesafe-ai/jev", questions: ticketQuestions });
```

`indexFacets` is about twenty lines, and the [companion example](https://github.com/fixpoint-labs/flow-state-dev/tree/main/examples/guides/index-time-facets) has it in full. Copy it rather than rewriting it. Keep all of the following, or stale answers get through:

- **It clears the old facets first.** The body is already saved when the reaction runs. If classifying the new body fails, a document keeping its old answers would match searches for text it no longer contains. With no facets, it matches no facet search.
- **It classifies on a [side chain](/docs/sequencers/composing-blocks#sidechain--fire-and-forget-background-tasks)**, background work that runs alongside the turn instead of inside it. A failed or refused model call shows up in the trace and doesn't fail the save. The side chain finishes before the turn ends, so the next turn's search sees the new facets.
- **It stores only answers about the current body.** Each write stamps the document with a fresh token. The answers are stored through `updateState`, and its updater keeps them only if the stored token is still this write's. `updateState` runs the updater against the stored row and re-runs it if another write lands first, so the check and the write commit together. If the body is written again while the first classification is running, the first answers are thrown away. Checking the token and then calling `patchState` looks the same but isn't safe: a second write can land between the check and the write.

The store step is the one to get exactly right:

```ts
await ref.updateState((state) =>
  state.indexedAs === token ? { ...state, facets: answers } : state,
);
```

Storing the facets is a state write, so it doesn't fire `contentUpdated` again. No loop.

The check and the write are atomic on the memory, SQLite and Postgres stores. The filesystem store locks each record within one process only, so two processes writing the same directory can still interleave.

### Searching facets

```ts
const hits = (await ctx.resources.tickets.list()).filter(
  (t) => t.state.facets?.topic.choice === "billing" && t.state.facets?.status.choice === "open",
);
```

The example wraps this in a `search` handler that takes the facet values as typed options, and you can hand the same handler to an agent as a tool. On a [projected collection](/docs/resources/projected-collections), pass the values in the `filter` of your list query instead, so your own database does the filtering.

Answers are stored exactly as the model gave them. [Jev](/docs/fundamentals/models#evaluation-models), an evaluation model you reach through Vercel's AI Gateway, also reports how sure it was. Most evaluation models don't. A plain search matches on the answer alone.

When you only want answers the model was sure of, add a minimum confidence. A stored answer carries a `confidence` field when the model reported one, so the check reads that field:

```ts
const sure = (await ctx.resources.tickets.list()).filter(
  (t) => t.state.facets?.topic.choice === "billing" && (t.state.facets.topic.confidence ?? -1) >= 0.8,
);
```

The example's `search` action takes the same check as an option: `{ "topic": "billing", "minConfidence": 0.8 }`. An answer with no confidence fails it, so on a model that never reports confidence, a minimum finds nothing.

### Reindexing

Documents get facets when their body is written inside a flow turn. Three cases need a reindex, which the example ships as an action: documents that existed before you added facets, documents whose classification failed, and every document after you change the questions (`force: true`).

Content edited straight from a client doesn't run reactions, so the example doesn't allow client content edits on its collection. If yours does, reindex after them.

If your text lives in state rather than the body, bind `created` and `stateUpdated` instead, with a `when` that checks the text fields changed. That check also keeps the facet write from re-triggering the reaction.

### Classifying the search instead

You can run the same evaluator on a search string to turn "anything about refunds that's still open?" into facet values. That's a model call on every search, so keep it for the case where the caller can't pick values from a list. The companion example doesn't include it.

## Choosing a tool

- **Glob** when you can describe the path: `concepts/**`, `decisions/2026-*`. Deterministic, no content read.
- **Grep** when you need an exact string or pattern inside the content, and you want the matching lines.
- **Search** when you have keywords and want the most relevant resources ranked, not every literal hit.
- **Facets** when the question is about meaning (topic, status, kind) and you can decide the questions ahead of time. The model runs once per write, not per search.

## Limits and readability

All three tools see only resources marked `llmReadable` — the same gate as [`readResourceContentTool`](/docs/resources/overview#llm-access-patterns). The gate covers collection instances too: a collection's instances are searchable once the collection sets `llmReadable`. A resource the LLM can't read won't appear in any of their results. Grep and search match the *rendered* content — the same text `readResourceContentTool` returns — so a resource whose body is a state-driven template is found by the words it renders to, not by its template source.

All three identify each match by its scope-qualified uri (for example `session/concepts/react`) — the same handle `readResourceContentTool` accepts, so a uri from a search result feeds straight into a read or write with no translation.

Search and grep are lexical. They're a good fit for curated, bounded content where answers live in the words on the page. They are not a substitute for semantic retrieval over a large, uncurated corpus — that's what [memory](/docs/memory/overview) and a retrieval layer are for.

`grepResourceContent` treats its pattern as a regular expression, falling back to a literal match when the pattern isn't valid regex. It runs line by line over trusted resource content and does not sandbox the pattern, so a pathological regex can be slow. Isolate the call before pointing it at attacker-controlled patterns.
