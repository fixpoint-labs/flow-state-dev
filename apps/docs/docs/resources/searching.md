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

`defineFacetedCollection` defines a collection that does this for you. You bring the fields you'd store anyway and an evaluator that asks your questions. You get back the collection, a search block and a reindex block.

Start with the questions. Each one is a `choice`, and its option keys are the values a search can ask for:

```ts
export const ticketQuestions = {
  topic: choice("What is this support ticket about?", TOPICS), // billing | outage | other
  status: choice("Is the customer's problem still open?", STATUSES), // open | closed
};
```

Then define the collection around the evaluator, and register what it returns on the flow:

```ts
export function ticketsFlow(triage: TicketEvaluator) {
  const tickets = defineFacetedCollection({
    name: "tickets",
    pattern: "tickets/*",
    scope: "user",
    stateSchema: z.object({ title: z.string() }), // facets and indexedAs are added
    evaluator: triage,
  });

  // … a write action that calls writeContent on a ticket

  return defineFlow({
    kind: "index-time-facets",
    requireUser: true,
    resources: tickets.resources,
    actions: {
      write: { block: write },
      search: { block: tickets.search },
      reindex: { block: tickets.reindex },
    },
  })();
}
```

The flow takes the evaluator as a parameter. Build it where you configure the app, so the model is named in one place:

```ts
const triage = evaluator({ name: "ticket-facets", model: "typesafe-ai/jev", questions: ticketQuestions });
```

`defineFacetedCollection` never picks a model. It reads the questions off the evaluator, so they have to be a fixed object rather than a function. The evaluator gets the document's body as its input.

`name` is the key the collection is registered under, and the key your own blocks use for it: the write action above declares `resources: { tickets: tickets.collection }`. Pass `tickets.resources` to the flow so the collection is registered under that key however you use the search. It also carries any resources your evaluator declares, so they're available when the evaluator runs.

Some shapes are refused when the collection is defined, each with the reason:

- a key pattern with parameters, such as `[topic]/observations`. Use a wildcard pattern like `tickets/*`.
- an evaluator whose questions are a function.
- an evaluator that declares `flowConfigSchema`.
- a `stateSchema` that already has `facets` or `indexedAs`, or a question with the id `minConfidence`.
- your own `reactTo.contentUpdated`. The collection uses that binding. `created`, `stateUpdated` and `deleted` are yours.

The [companion example](https://github.com/fixpoint-labs/flow-state-dev/tree/main/examples/guides/index-time-facets) has the whole setup, with tests on the mock evaluation model.

### What it does on every write

Every body write inside a flow turn indexes the same way, whether it comes from an action, a tool, or an agent writing content. The collection keeps two fields beside yours. `facets` holds the answers, keyed by question id, and `indexedAs` records which write they belong to.

- **It clears the old facets first.** The body is already saved when indexing starts. If classifying the new body fails, the document has no facets and matches no facet search. It never matches on answers about text it no longer contains.
- **It classifies on a [side chain](/docs/sequencers/composing-blocks#sidechain--fire-and-forget-background-tasks)**, background work that runs alongside the turn instead of inside it. A failed or refused model call shows up in the trace and doesn't fail the save. The side chain finishes before the turn ends, so the next turn's search sees the new facets.
- **It stores only answers about the current body.** If the body is written again while the first classification is still running, the first answers are thrown away. The check and the write commit together on the memory, SQLite and Postgres stores. The filesystem store locks each record within one process only, so two processes writing the same directory can still interleave.

Nothing retries. A document whose classification failed stays without facets until you reindex it.

Storing facets is a state write, so it doesn't start another classification.

### Searching facets

`tickets.search` takes one optional value per choice question and returns the matching keys. It filters the stored answers and runs no model:

```ts
// { "topic": "billing", "status": "open" } → { "keys": ["t1", "t7"] }
```

A document with no facets never matches. You can hand the same block to an agent as a tool, and the agent sees each question's options as the allowed values.

Answers are stored exactly as the model gave them. [Jev](/docs/fundamentals/models#evaluation-models), an evaluation model you reach through Vercel's AI Gateway, also reports how sure it was. Most evaluation models don't. A plain search matches on the answer alone.

When you only want answers the model was sure of, add `minConfidence`: `{ "topic": "billing", "minConfidence": 0.8 }`. It applies to the values you name. An answer with no confidence fails the check, so on a model that never reports confidence, a search with a minimum finds nothing.

The search offers options for choice questions only. Answers to yes/no and scale questions are stored on each document's `facets`, where your own code can read them.

On a [projected collection](/docs/resources/projected-collections), where your own database holds the rows, pass facet values in the `filter` of your list query instead. `defineFacetedCollection` doesn't build projected collections.

### Reindexing

Documents get facets when their body is written inside a flow turn. `tickets.reindex` covers the rest: documents that existed before you added facets, documents whose classification failed, and, with `{ "force": true }`, every document after you change the questions. It returns the keys it classified as `{ "reindexed": [...] }`.

A faceted collection doesn't let clients create or edit bodies directly. Those edits run outside a flow turn, so nothing would reclassify them. Write bodies through an action instead. Clients can still read and delete.

If you already store facets with your own `contentUpdated` reaction in the same `facets` and `indexedAs` fields, switching keeps them. Delete both fields from your `stateSchema`, since the collection adds them, and replace the collection definition with `defineFacetedCollection`. Existing documents are found as before, with no reindex.

If your text lives in state rather than the body, `defineFacetedCollection` doesn't fit. Bind `created` and `stateUpdated` yourself, with a `when` that checks the text fields changed. The [source](https://github.com/fixpoint-labs/flow-state-dev/tree/main/packages/core/src/types/faceted-collection.ts) shows the three rules above as code.

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
