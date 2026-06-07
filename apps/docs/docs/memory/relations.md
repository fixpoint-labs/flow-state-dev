---
sidebar_position: 3
sidebar_label: Relations
---

# Relations

Semantic memory stores facts about a subject: "the user prefers dark mode", "Moni is his wife". That works well for personalization. It works less well when the value lives in the connections between things, which is the shape of research and analysis work: a ticker depends on a supplier, a supplier sits in a country, a macro factor drives a sector.

The relations layer adds typed links between entities on top of semantic facts. A **relation** is a directed, typed edge, the same primitive described in [Resource Edges](../resources/edges). It's opt-in. Leave it off and memory behaves exactly as it does today; the personalization path is unchanged.

## Turning it on

Set `relations` on the semantic tier.

```ts
import { system } from "@flow-state-dev/memory";

const mem = system({
  model: "openai/gpt-5.4-mini",
  episodic: true,
  semantic: {
    relations: {
      vocabulary: ["drives", "depends_on", "exposed_to", "located_in"],
    },
  },
});
```

`relations: true` enables it with defaults (free-text relation types). Passing an object lets you set a curated `vocabulary`, a `maxEdges` cap, and `createImplicitEntities` (see below). Relations require the semantic tier, which requires episodic.

## What gets stored

When relations is on, the periodic consolidation pass extracts edges in the same LLM call that distills facts, so you don't pay for a second round-trip. Each edge connects two subjects (`user --married_to--> moni`), carries a confidence and the episode ids it came from, and is stored on the semantic resource's edge graph.

Endpoints are canonicalized to known subjects so the same entity doesn't fork into "NVDA" and "Nvidia". If an edge points at something memory has never seen as a subject, it's dropped by default; set `createImplicitEntities: true` to keep it as a new node instead. When a fact's subject is culled by [hygiene](./hygiene), the janitor prunes any edges left dangling.

Contradictions don't overwrite. If a relationship changes, the old edge is superseded (stamped with an end time) and the new one added, so the history stays intact.

## Asking connection questions

Two read surfaces use the graph:

- **The `memory/connect` tool** answers connection questions directly. Give it one entity to get everything connected to it, or two entities to get the path between them ("what links our NVDA exposure to Taiwan?"). It returns the connecting edges.
- **Recall** becomes connection-aware. When the agent searches memory, entities named in the query pull in nearby facts and edges from the graph, so a relevant fact two hops away surfaces even when its wording doesn't match the query.

Handlers can also reach the graph directly through `ctx.cap.memory.connections(entity)` (direct links), `ctx.cap.memory.relate(from, to)` (shortest path), and `ctx.cap.memory.egoGraph(entity)` (the neighborhood).

## Curated vocabulary, and why it's worth it

Left to its own devices, an extraction model invents `works_at`, `works_for`, and `employed_by` as three different relationships. A curated `vocabulary` constrains the edge types to a set you choose, and out-of-vocabulary edges are dropped. For a focused domain this is worth doing up front: a trading lab might allow `drives`, `depends_on`, `exposed_to`, `hedges`, `supplier_of`, `competitor_of`. Free-text is fine for exploration; lean on the vocabulary once you know the shape of your domain.

## Cost and limits

Relations add extraction work to consolidation (a longer prompt and more to parse) and store more state per user. Traversal is in-memory and fast for the hundreds-to-thousands of edges a research agent accumulates, not a substitute for a graph database at large scale. If your agent is pure chat personalization, leave relations off; you won't miss anything.

See [Resource Edges](../resources/edges) for the underlying primitive, [Recall tool](./recall-tool) for the search surface, and [Hygiene](./hygiene) for how edges are pruned over time.
