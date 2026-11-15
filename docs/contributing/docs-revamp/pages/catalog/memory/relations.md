---
title: Memory relations
type: catalog
description: Store connections between things, for questions about how they relate.
---

# Memory relations

Semantic memory stores facts about a subject: "the user prefers dark mode", "Moni is his wife". That works well for personalization. It works less well when the value lives in the connections between things, which is the shape of research and analysis work: a ticker depends on a supplier, a supplier sits in a country, a macro factor drives a sector.

The relations layer adds typed links between entities on top of semantic facts. A **relation** is a directed, typed edge, the same primitive described in [Resource Edges](../resources/edges). It's opt-in. Leave it off and memory stores facts only.

## Turning it on

Set `relations` on the semantic tier. Relations need the semantic tier, which needs the episodic tier.

```ts title="src/lib/memory.ts"
import { system } from "@flow-state-dev/memory";

export const mem = system({
  model: "openai/gpt-6-luna",
  working: true,
  episodic: true,
  semantic: {
    relations: {
      vocabulary: ["drives", "depends_on", "exposed_to", "located_in"],
    },
  },
});
```

`relations: true` turns it on with free-text relation types. The object form takes a curated `vocabulary`, a `maxEdges` cap and `createImplicitEntities`; the [memory reference](../../reference/memory) lists each option and its default.

## What gets stored

Relations are extracted from conversations automatically, during the periodic consolidation pass that distills facts. Each edge connects two subjects (`user --married to--> moni`) and records how confident memory is and which episodes it came from.

Edges attach to subjects memory already has a fact about. Case and spacing don't matter, so "NVDA" and "nvda" are one node, but "NVDA" and "Nvidia" are two. An edge that names an unknown subject is dropped unless you set `createImplicitEntities: true`. The [memory reference](../../reference/memory) has the full endpoint rules, including what happens to edges when [hygiene](./hygiene) removes a fact.

Contradictions don't overwrite. When a relationship changes, the old edge is closed with an end time and the new one added. Closed edges stay stored, and the connection tools skip them. If you set `maxEdges`, closed edges are the first to go when the cap is reached.

## Asking connection questions

You can query the graph with the `memory/connect` tool, or through recall.

- **The `memory/connect` tool** answers connection questions directly. Give it one entity to get everything connected to it, or two entities to get the path between them ("what links our NVDA exposure to Taiwan?"). It returns the connecting edges.
- **Recall** follows connections when relations is on. If a search query names an entity that has edges, up to 10 of those edges, within two hops, are added to the candidates the agent sees.

Handlers reach the graph through `ctx.cap.memory`. The [memory reference](../../reference/memory) lists `connections`, `relate` and `egoGraph`.

## Curated vocabulary, and why it's worth it

Left to its own devices, an extraction model invents `works_at`, `works_for`, and `employed_by` as three different relationships. A curated `vocabulary` constrains the edge types to a set you choose, and out-of-vocabulary edges are dropped. For a focused domain this is worth doing up front: a trading lab might allow `drives`, `depends_on`, `exposed_to`, `hedges`, `supplier_of`, `competitor_of`. Free-text is fine for exploration; lean on the vocabulary once you know the shape of your domain.

## When to reach for it

Use relations when your agent answers questions about how things connect: research, analysis, anything shaped like a dependency map. It makes consolidation do more work and stores more per user, and traversal runs in memory, so it suits hundreds to thousands of edges, not a graph database's scale. For pure chat personalization, leave it off. The [memory reference](../../reference/memory) has the cost and limits.

See [Resource Edges](../resources/edges) for the underlying primitive, [Recall tool](./recall-tool) for the search surface, and [Hygiene](./hygiene) for how memory is pruned over time.
