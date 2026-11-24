---
title: Memory relations
type: catalog
description: Store connections between things, for questions about how they relate.
---

# Memory relations

Semantic memory stores facts about a subject: "the user prefers dark mode", "the user works at Acme". That works well for personalization. It works less well when the value lives in the connections between things, which is the shape of research and analysis work: a ticker depends on a supplier, a supplier sits in a country, a macro factor drives a sector.

The relations layer adds typed links between entities on top of semantic facts. A **relation** is a directed, typed edge, the same primitive described in [Resource Edges](../../build/link-records.md). It's opt-in. Leave it off and memory stores facts only.

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
      vocabulary: ["drives", "depends on", "exposed to", "located in"],
    },
  },
});
```

`relations: true` turns it on with free-text relation types. The object form takes a curated `vocabulary`, a `maxEdges` cap and `createImplicitEntities`; the [memory reference](../../reference/memory.md) lists each option and its default.

## What gets stored

Relations are extracted from conversations automatically, during the periodic consolidation pass that distills facts. Each edge connects two subjects (`user --works at--> acme`) and records how confident memory is and which episodes it came from.

Edges attach to subjects memory already has a fact about. Endpoints are trimmed and lowercased before they are matched, so "NVDA" and "nvda" are one node. There is no alias merging: "Nvidia" is a different subject string, so an edge to "Nvidia" does not join the "nvda" node.

Say the model proposes `nvda depends on samsung`, and memory has no stored fact about Samsung. The edge is dropped with a console warning, and consolidation carries on. A bad edge never fails the pass. Set `createImplicitEntities: true` and the endpoint is kept as a new node instead. The [memory reference](../../reference/memory.md) has the full endpoint rules, including what happens to edges when [hygiene](./hygiene.md) removes a fact.

Contradictions don't overwrite. Say memory holds `nvda depends on tsmc` and `tsmc located in taiwan`, and a later conversation says TSMC has moved its main fab out of Taiwan. Consolidation closes the old `located in` edge by giving it an end time, and adds the new one. Nothing is deleted, but the connection tools only walk edges that are active. Calling `memory/connect` for the path from `nvda` to `taiwan` afterwards returns no results (`totalMatched: 0`), not an error. The closed edge stays stored as history until `maxEdges` evicts it, or until [hygiene](./hygiene.md) prunes it because an endpoint's fact was removed. Recall's graph expansion does not filter closed edges, so a closed edge can appear there.

## Asking connection questions

You can query the graph with the `memory/connect` tool, or through recall.

- **The `memory/connect` tool** answers connection questions directly. Give it one entity to get everything connected to it, or two entities to get the path between them ("what links our NVDA exposure to Taiwan?"). It returns the connecting edges, or an empty list when there is no path. With relations off, it returns an error result instead of throwing: "The relations graph is not enabled for this memory. Enable the relations tier to use connect."
- **Recall** follows connections when relations is on. If a search query names an entity that has edges, up to 10 of those edges, within two hops, are added to the candidates the agent sees.

Handlers reach the graph through `ctx.cap.memory`. The [memory reference](../../reference/memory.md) lists `connections`, `relate` and `egoGraph`.

## Who decides the relation types

You do, in config. The model can't change the vocabulary at runtime.

Leave `vocabulary` unset and the model writes each type as free text, so one relationship can come out as `works at` in one run and `employed by` in the next. Those are two different edge types, and a query on one misses the other.

Set it, and the list goes into the consolidation prompt and is enforced when edges are written. An edge whose type isn't on the list, such as `supplied by` against `["depends on", "located in"]`, is dropped with a console warning. Matching is exact, not lowercased, so list the spelling you want stored. Edges already stored with other types are kept; changing the list never removes them.

Free text is fine for exploration. Lean on the vocabulary once you know the shape of your domain: a trading lab might allow `drives`, `depends on`, `exposed to`, `hedges`, `supplier of`, `competitor of`.

## What it costs

There is no extra model call. The consolidation call that already distills facts also returns an `edges` array, so its prompt and output get longer. Nothing is added to a turn.

Recall scans the stored edges in process for names in the query and may add up to 10 edge candidates, again with no model call. Every edge is stored in the semantic memory's state and loaded with it, with no limit unless you set `maxEdges`. Traversal runs in memory, sized for hundreds to low thousands of edges, not a graph database.

Off, it costs nothing: no edges field, no prompt text, no tool. For pure chat personalization, leave it off. Use relations when your agent answers questions about how things connect: research, analysis, anything shaped like a dependency map. The [memory reference](../../reference/memory.md) has the limits.

See [Resource Edges](../../build/link-records.md) for the underlying primitive, [Recall tool](./recall-tool.md) for the search surface, and [Hygiene](./hygiene.md) for how memory is pruned over time.
