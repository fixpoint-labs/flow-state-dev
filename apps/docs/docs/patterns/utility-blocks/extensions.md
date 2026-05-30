---
sidebar_position: 3
---

# Extension Utilities

Extension utilities are adapter-driven utility blocks that wrap external services — search engines, vector stores, web crawlers, fact-checking APIs — behind a standard block interface. Unlike core utilities, extension utilities require a provider adapter that handles the actual service integration.

The adapter pattern keeps your block composition clean. You configure the adapter once (with credentials, endpoints, and provider-specific options) and pass it to the utility. The utility handles the block API, error normalization, and sequencer composability.

## Strategy blocks

A subset of extension utilities are **strategy blocks** — utilities where the provider is itself swappable at configuration time. The same block can be wired to different backends depending on the deployment context:

| Utility | Kind | What it does |
|---------|------|--------------|
| [`searcher`](#searcher) | handler | Web or knowledge-base search via a pluggable search adapter |
| [`retriever`](#retriever) | handler | Vector or semantic retrieval via a pluggable retrieval adapter |
| [`networker`](#networker) | handler | Web fetch and crawl via a pluggable fetch adapter |
| [`claimChecker`](#claimchecker) | handler | Fact verification via a pluggable verification adapter |

All extension utilities are available from `@flow-state-dev/core`:

```ts
import { utility } from "@flow-state-dev/core";
```

---

## searcher {#searcher}

`searcher` wraps a search provider — a web search engine, an internal knowledge base, a document index — and returns results as structured items. You configure the adapter; the block normalizes results into a consistent shape.

**Common use cases:**
- Giving an agentic pipeline access to current web information
- Searching an internal document corpus before generating a response
- Powering a Retrieval-Augmented Generation (RAG) lookup step

```ts
import { utility } from "@flow-state-dev/core";
import { braveSearchAdapter } from "@flow-state-dev/adapters/brave";

const search = utility.searcher({
  name: "web-search",
  adapter: braveSearchAdapter({ apiKey: process.env.BRAVE_API_KEY }),
  maxResults: 10,
});
```

**Input:**
```ts
{ query: string }
```

**Output:**
```ts
{
  results: Array<{
    title: string;
    url: string;
    snippet: string;
    score?: number;
  }>;
}
```

**Configuration:**

```ts
utility.searcher({
  name: string;           // required
  adapter: SearchAdapter; // required — search provider adapter
  maxResults?: number;    // max results to return (default: 10)
  outputSchema?: ZodSchema; // override default output shape
});
```

Use `searcher` inside a sequencer when you need to fetch external information before generating a response:

```ts
const researchPipeline = sequencer({
  name: "research",
  inputSchema: z.object({ question: z.string() }),
})
  .map((input) => ({ query: input.question }))
  .step(search)
  .map((results) => ({
    context: results.results.map((r) => r.snippet).join("\n"),
    question: "...", // carried forward via connector
  }))
  .step(answerGenerator);
```

---

## retriever {#retriever}

`retriever` performs semantic or vector retrieval from an embedding store. It takes a query and returns the top-k most relevant documents or chunks based on embedding similarity.

**Common use cases:**
- Injecting relevant documents into a generator's context
- Building RAG pipelines with a vector database
- Narrowing the search space before a more expensive generation step

```ts
import { utility } from "@flow-state-dev/core";
import { pineconeAdapter } from "@flow-state-dev/adapters/pinecone";

const retrieve = utility.retriever({
  name: "knowledge-retrieval",
  adapter: pineconeAdapter({
    apiKey: process.env.PINECONE_API_KEY,
    index: "product-docs",
    namespace: "v2",
  }),
  topK: 5,
});
```

**Input:**
```ts
{ query: string; filter?: Record<string, unknown> }
```

**Output:**
```ts
{
  documents: Array<{
    id: string;
    content: string;
    score: number;
    metadata?: Record<string, unknown>;
  }>;
}
```

**Configuration:**

```ts
utility.retriever({
  name: string;              // required
  adapter: RetrievalAdapter; // required — retrieval provider adapter
  topK?: number;             // number of results (default: 5)
  minScore?: number;         // minimum similarity threshold (default: 0)
  outputSchema?: ZodSchema;  // override default output shape
});
```

---

## networker {#networker}

`networker` fetches and processes web content — a single URL, a crawl of linked pages, or a structured scrape. It returns the content in a normalized text format, ready to pass to a generator.

**Common use cases:**
- Reading a URL and summarizing its content
- Crawling a documentation site to build a knowledge base
- Fetching structured data from a public API or RSS feed

```ts
import { utility } from "@flow-state-dev/core";
import { playwrightAdapter } from "@flow-state-dev/adapters/playwright";

const crawl = utility.networker({
  name: "web-crawl",
  adapter: playwrightAdapter(),
  maxDepth: 2,
  maxPages: 20,
});
```

**Input:**
```ts
{ url: string; instructions?: string }
```

**Output:**
```ts
{
  content: string;         // normalized text content
  url: string;             // final URL after redirects
  title?: string;
  links?: string[];        // discovered outbound links (if crawling)
}
```

**Configuration:**

```ts
utility.networker({
  name: string;             // required
  adapter: FetchAdapter;    // required — fetch/crawl provider adapter
  maxDepth?: number;        // crawl depth (default: 1 — single page)
  maxPages?: number;        // max pages to crawl (default: 1)
  outputSchema?: ZodSchema; // override default output shape
});
```

---

## claimChecker {#claimchecker}

`claimChecker` verifies factual claims against a configured verification source — a fact-checking API, an internal knowledge base, or a reference corpus. It returns a verdict and supporting evidence for each claim.

**Common use cases:**
- Validating LLM-generated claims before surfacing them to users
- Adding a fact-check step to summarization or research pipelines
- Flagging hallucinations in generated content

```ts
import { utility } from "@flow-state-dev/core";
import { perplexityAdapter } from "@flow-state-dev/adapters/perplexity";

const verify = utility.claimChecker({
  name: "fact-check",
  adapter: perplexityAdapter({ apiKey: process.env.PERPLEXITY_API_KEY }),
});
```

**Input:**
```ts
{ claims: string[] }
```

**Output:**
```ts
{
  results: Array<{
    claim: string;
    verdict: "supported" | "disputed" | "unverifiable";
    confidence: number;   // 0–1
    evidence?: string;
    sources?: Array<{ title?: string; url: string }>;
  }>;
}
```

**Configuration:**

```ts
utility.claimChecker({
  name: string;                  // required
  adapter: VerificationAdapter;  // required — verification provider adapter
  outputSchema?: ZodSchema;      // override default output shape
});
```

---

## Writing an adapter

Adapters implement a typed interface specific to each utility. If a built-in adapter doesn't cover your provider, you can write one directly:

```ts
import type { SearchAdapter } from "@flow-state-dev/core";

const mySearchAdapter: SearchAdapter = {
  search: async ({ query, maxResults }) => {
    const raw = await mySearchAPI.query(query, { limit: maxResults });
    return {
      results: raw.hits.map((h) => ({
        title: h.title,
        url: h.url,
        snippet: h.excerpt,
        score: h.relevance,
      })),
    };
  },
};

const search = utility.searcher({
  name: "custom-search",
  adapter: mySearchAdapter,
});
```

Adapters are plain objects. No class inheritance, no registration step. Type errors surface at the point of use if your adapter's return shape doesn't match.

---

## Next steps

- See [Core Utilities](./core) for the general-purpose utility blocks
- See [Parallel Tasks](../parallelTasks), [Supervisor](../supervisor), and [Plan and Execute](../plan-and-execute) for composable multi-step patterns that use these utilities internally
