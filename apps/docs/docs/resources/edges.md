---
sidebar_position: 4
sidebar_label: Edges
---

# Resource Edges

Most resource state is a bag of fields. Sometimes what you actually care about is how things connect: this ticker depends on that supplier, this person works at that company, this macro factor drives that sector. An **edge** is a typed link from one thing to another, and the edge graph lets you store those links and walk them.

Edges are opt-in. A resource that doesn't declare them behaves exactly as before. When you do declare them, the framework keeps an `edges` array inside the resource's own state (no new storage key, no separate database) and hands you an `.edges` API on the resource reference for adding and traversing them.

## Turning it on

Pass `edges` to `defineResource`. `true` uses defaults; an object lets you set a relation vocabulary and a size cap.

```ts
import { defineResource } from "@flow-state-dev/core";
import { z } from "zod";

const research = defineResource({
  ref: "research",
  scope: "user",
  stateSchema: z.object({ notes: z.array(z.string()).default([]) }),
  default: { notes: [] },
  writable: true,
  edges: true, // or: { vocabulary: ["drives", "depends_on"], maxEdges: 500 }
});
```

The framework adds an `edges: Edge[]` field to the resource's state for you. You don't declare it in `stateSchema`.

## The edge shape

An edge is directed (it goes `from` one node `to` another) and typed (the `type` names the relationship, written in active voice like `drives` or `works_at`). A **node** is just a string id. For links that point at another resource, the convention is `"namespace:key"` — the `nodeRef("ticker", "NVDA")` helper builds one and `parseNodeRef` splits it back.

| Field | Meaning |
|-------|---------|
| `id` | Stable id, assigned on `add`. |
| `from` / `to` | The two node ids the edge connects. |
| `type` | The relationship, active voice. |
| `confidence` | How sure we are, `[0, 1]`. Defaults to `1`. |
| `validFrom` / `validUntil` | When the edge was true. `validUntil: null` means still true. |
| `source` | Provenance ids (where the edge came from). |

## Adding and traversing

The `.edges` API lives on the resource reference. Reads are synchronous over the in-state array; writes go through the resource's normal state persistence.

```ts
const ref = ctx.resources.research;

await ref.edges.add({ from: "ticker:nvda", to: "ticker:tsmc", type: "depends_on" });
await ref.edges.add({ from: "ticker:tsmc", to: "country:taiwan", type: "located_in" });

// Everything within 2 hops of NVDA:
const around = ref.edges.egoGraph("ticker:nvda", { depth: 2 });

// The chain connecting two nodes (null if there isn't one):
const path = ref.edges.shortestPath("ticker:nvda", "country:taiwan");
// → [nvda depends_on tsmc, tsmc located_in taiwan]
```

The full API: `add`, `supersede`, `remove`, `all`, `neighbors`, `egoGraph`, `shortestPath`, and `pruneDangling` (drop edges whose endpoints no longer exist). Traversals take `{ depth, direction, relationTypes, at }` and are depth-bounded and cycle-safe, so a graph with loops won't run away.

## Edges that change over time

Facts go stale. Someone leaves a company; a supplier relationship ends. Rather than delete the old edge, `supersede` stamps it with a `validUntil` and you add the new one. The old edge stays on record, so you can still ask what was true at a past moment.

```ts
await ref.edges.supersede(oldEdgeId);           // closes it as of now
await ref.edges.add({ from: "alice", to: "acme-2", type: "works_at" });

ref.edges.all({ at: new Date().toISOString() }); // only currently-valid edges
```

## When to reach for this

Edges earn their place when the question is about connections: "what links X to Y", "what's near X", multi-hop paths. They are stored in memory and walked with plain breadth-first traversal, which is fast for hundreds or low thousands of edges per resource. This is not a graph database. If you need millions of edges or query-planner-grade path matching, push the data into a real store; the edge graph is for the relational structure that rides alongside ordinary resource state.

The first framework consumer of this primitive is [memory relations](../memory/relations), which extracts typed edges between the people, companies, and topics an agent learns about.

See also [Collections](./collections) for the other way to hold many related instances in resource state.
