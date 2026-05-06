---
sidebar_position: 4
---

# Connectors

Blocks have typed inputs and outputs. When adjacent steps don't match, you need a transform. Connectors are lightweight functions that sit between blocks and reshape data. They work across the sequencer DSL: `.then()`, `.thenIf()`, `.parallel()`, and more.

## Connector functions

A connector receives the previous step's output and the block context, and returns the shape the next block expects:

```ts
const pipeline = sequencer({ name: "pipeline", inputSchema: inputSchema })
  .then(blockA)
  .then(
    (output, ctx) => ({ query: output.text, limit: 10 }),
    searchBlock
  );
```

Here, `blockA` produces `{ text: string }`. `searchBlock` expects `{ query: string, limit: number }`. The connector bridges the gap.

## Connectors in sequencer methods

### then and thenIf

```ts
.then(connector, block)
.thenIf(condition, connector, block)
```

The connector runs before the block. Its return value is the block's input.

### parallel

Parallel steps can use connectors when each branch needs different input shapes:

```ts
.parallel({
  summary: summaryBlock,
  tags: { connector: (input) => input.text, block: tagBlock },
  metrics: {
    connector: (input) => ({ docId: input.id, version: input.version }),
    block: metricsBlock,
  },
})
```

Steps without a connector receive the pipeline value directly. Steps with `{ connector, block }` receive the connector output.

### forEach

Use a connector to extract the array before iterating:

```ts
.forEach(
  (output) => output.items,
  processItemBlock,
  { maxConcurrency: 5 }
)
```

The connector returns the items. Each item is passed to the block.

## Block-level connections

You can attach transforms directly to a block with `connectInput` and `connectOutput`:

```ts
const searchFromText = searchBlock.connectInput(
  (text: string) => ({ query: text, limit: 10 })
);

pipeline.then(searchFromText);
```

The block always receives the adapted input. Useful when you reuse the same block in multiple pipelines with different upstream shapes.

`connectOutput` transforms the block's output before it reaches the next step:

```ts
const adapted = someBlock.connectOutput((out) => ({
  ...out,
  normalized: out.raw.trim(),
}));
```

## Model-visible tool output: `mapModelOutput`

When a block is installed as a tool on a generator, its output flows to two consumers: the LLM (as the tool result it sees on the next turn) and the framework's observation surfaces (`block_tool_output` items, devtool, replay, tests). For tools with rich structured envelopes, that's a bad tradeoff — fields the LLM can't reason about cost tokens, and trimming the result strips inspection value.

`mapModelOutput` declares a separate, model-visible representation. The structured `TOutput` keeps flowing through the framework. The mapper only fires at the AI SDK bridge boundary, producing the value the LLM observes.

```ts
const recallTool = recallSeq.mapModelOutput((result) => {
  if ('error' in result) return `Recall failed: ${result.error}`
  if (result.results.length === 0) return `No memories matched "${result.query}".`
  return result.results.map((r) => `- ${r.content}`).join('\n')
})
```

The mapper returns a string. Both `TInputSchema` and `TOutputSchema` are preserved — downstream sequencer steps and `block_tool_output` items still see the full structured envelope.

### How it differs from `connectOutput`

| | `connectOutput` | `mapModelOutput` |
| -- | -- | -- |
| Rewrites `TOutputSchema` | yes | no |
| Visible to downstream block consumers | yes | no |
| Visible in `block_tool_output` items | yes | no |
| Fires when the block is used as a non-tool step | yes | no — silently inert |
| Fires when the block is installed as a tool | yes | yes, at the bridge boundary |

`connectOutput` reshapes data flowing into downstream consumers. `mapModelOutput` is scoped to a single boundary — the AI SDK tool-result content the LLM sees — and preserves every existing type and observation contract.

The mapper is expected to be deterministic: history replay re-runs it on the persisted structured output rather than persisting the string itself.

### Devtool inspection

When a tool block declares `mapModelOutput`, the framework emits a transient `block_debug` item carrying the mapper's string output alongside the regular `block_tool_output` item that carries the structured value. Devtool surfaces both, so you can see what the LLM saw next to what the block actually produced. Gated by `FSDEV_TRACE_OBSERVABILITY` (on by default in dev/test, off in production).

## State handoffs

Connectors can read from scope state or sequencer state when shaping input:

```ts
.then(
  (output, ctx) => ({
    query: output.text,
    userId: ctx.user.identity.id,
    preferences: ctx.user.state.preferences,
  }),
  personalizedSearch
)
```

Scope state (session, user, org) and sequencer state are available in the block context. Use them when the next block needs contextual data.

## Why this matters for portability

Community or shared blocks often have fixed input shapes. Your pipeline may produce something different. Connectors let you adapt without wrapper blocks:

```ts
// Community block expects { query: string, limit: number }
import { communitySearchBlock } from "@vendor/search";

pipeline.then(
  (output) => ({ query: output.userMessage, limit: 5 }),
  communitySearchBlock
);
```

One-line connector. No new block, no inheritance. The block stays portable; the pipeline does the adaptation.

## Type inference through connectors

TypeScript infers types through the chain. The connector's return type must match the next block's input schema. Mismatches surface at compile time:

```ts
// searchBlock expects { query: string }
.then(
  (output) => ({ query: output.text }),  // ✓
  searchBlock
);

// This would error: missing required 'query'
.then(
  (output) => ({ limit: 10 }),
  searchBlock
);
```

## Realistic examples

### Reshaping for a generator

```ts
const agent = generator({
  name: "agent",
  inputSchema: z.object({ prompt: z.string(), context: z.array(z.string()) }),
  user: (input) => input.prompt,
  context: (input) => input.context,
});

const researchPipeline = sequencer({ name: "research" })
  .then(searchBlock)
  .then(
    (results) => ({
      prompt: `Summarize these findings: ${results.summary}`,
      context: results.snippets,
    }),
    agent
  );
```

### Parallel with different shapes

```ts
.parallel({
  sentiment: sentimentBlock,
  entities: {
    connector: (input) => input.entities,
    block: entityExtractor,
  },
  summary: {
    connector: (input) => ({ text: input.body, maxLength: 200 }),
    block: summarizeBlock,
  },
})
```

### Conditional connector

```ts
.thenIf(
  (output) => output.needsEnrichment,
  (output, ctx) => ({
    ...output,
    userContext: ctx.user.state.recentTopics,
  }),
  enrichBlock
)
```
