---
title: Link records with edges
type: recipe
description: "Store typed links between records in a resource and walk them: neighbors, paths, and links that change over time."
---

# Link records with edges

A support desk has tickets that duplicate each other and tickets that block each other. Resource state holds fields well and connections badly. An **edge** is a typed, directed link from one thing to another (`ticket:4821` duplicates `ticket:4790`), and a resource can store edges and walk them: what is near a ticket, and what chain connects two.

Edges are opt-in. Declare them and the resource's state gains an `edges` array, stored with the rest of its state, plus an `.edges` API on the resource's handle for adding and walking them.

## 1. Declare edges on a resource

Pass `edges` to `defineResource`. `true` takes the defaults. An object sets a `vocabulary` of allowed relationship types and a `maxEdges` cap.

```ts title="src/flows/support/resources/ticket-links.ts"
import { defineResource } from "@flow-state-dev/core";
import { z } from "zod";

export const ticketLinks = defineResource({
  ref: "ticketLinks",
  scope: "org",
  stateSchema: z.object({}),
  default: {},
  edges: { vocabulary: ["duplicates", "blocks"], maxEdges: 500 },
});
```

You don't declare the `edges` field in `stateSchema`. The scope is `org` because a ticket's links are the same for everyone on the desk.

An edge has a `from` and a `to`, each a string id you choose, and a `type` naming the relationship in active voice. A **node** is one of those ids. Nodes aren't declared anywhere. A node exists because an edge names it, and the framework doesn't check that an id points at anything.

By convention an id reads `namespace:key`. The `nodeRef` helper builds one and lowercases the key, so `nodeRef("ticket", "T-4821")` is `ticket:t-4821`. Build every id with it, or none: `ticket:T-4821` and `ticket:t-4821` are different nodes, so mixing the two splits one ticket's links across both.

## 2. Add an edge

```ts title="src/flows/support/blocks/link-duplicate.ts"
import { handler } from "@flow-state-dev/core";
import { nodeRef } from "@flow-state-dev/core/graph";
import { z } from "zod";
import { ticketLinks } from "../resources/ticket-links";

export const linkDuplicate = handler({
  name: "link-duplicate",
  inputSchema: z.object({ ticketId: z.string(), duplicateOf: z.string() }),
  resources: { ticketLinks },
  execute: async (input, ctx) => {
    const links = ctx.resources.ticketLinks.edges!;
    const edge = await links.add({
      from: nodeRef("ticket", input.ticketId),
      to: nodeRef("ticket", input.duplicateOf),
      type: "duplicates",
    });
    return { edgeId: edge.id };
  },
});
```

`add` returns the stored edge. The framework assigns its `id`. `edges` is optional on the handle's type, so take it once with `!` into a local, as above.

`add` also takes these optional fields, and the stored edge carries them:

| Field | Meaning |
| --- | --- |
| `confidence` | How confident the link is, from 0 to 1. Defaults to `1`. |
| `validFrom`, `validUntil` | When the link was true. `validUntil: null` means the link is open-ended. |
| `source` | Ids of where the link came from. Defaults to `[]`. |

`add` throws on a type outside the `vocabulary`. When an `add` would pass `maxEdges`, the framework deletes ended edges first, oldest first, then the least confident. Adding the same link twice stores two edges.

## 3. Follow the links

Reads return right away. Writes are async.

```ts title="src/flows/support/blocks/find-related.ts"
import { handler } from "@flow-state-dev/core";
import { nodeRef } from "@flow-state-dev/core/graph";
import { z } from "zod";
import { ticketLinks } from "../resources/ticket-links";

export const findRelated = handler({
  name: "find-related",
  inputSchema: z.object({ ticketId: z.string(), otherId: z.string() }),
  resources: { ticketLinks },
  execute: async (input, ctx) => {
    const links = ctx.resources.ticketLinks.edges!;
    const ticket = nodeRef("ticket", input.ticketId);

    // Every ticket within two hops, and the links between them.
    const around = links.egoGraph(ticket, { depth: 2 });

    // The chain of links to another ticket, or null.
    const chain = links.shortestPath(ticket, nodeRef("ticket", input.otherId));

    return { around, chain };
  },
});
```

`neighbors` returns the edges touching a node, `egoGraph` returns `{ nodes, edges }`, and `shortestPath` returns the ordered edges from one node to another. Traversals ignore ended edges unless you pass `at`.

Traversals walk a link in both directions. Pass `direction: "out"` to follow only what a ticket points at. `shortestPath` searches two hops by default and returns `null` when no chain fits within `depth`, so pass a larger `depth` for longer chains.

## 4. Change a link

When a link stops being true, `supersede` ends it and keeps the record.

```ts title="src/flows/support/blocks/unlink-duplicate.ts"
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { ticketLinks } from "../resources/ticket-links";

export const unlinkDuplicate = handler({
  name: "unlink-duplicate",
  inputSchema: z.object({ edgeId: z.string() }),
  resources: { ticketLinks },
  execute: async (input, ctx) => {
    const links = ctx.resources.ticketLinks.edges!;
    await links.supersede(input.edgeId);
    return { current: links.all({ at: new Date().toISOString() }).length };
  },
});
```

`all()` with no argument returns every stored edge, ended ones included. `all({ at })` returns the edges that were true at that moment. `remove(edgeId)` deletes an edge outright, and `pruneDangling(nodes)` deletes the edges whose endpoints aren't in the list you pass.

## Limits

Edges are not a graph database. They suit hundreds to low thousands of edges in one resource, and they can't be followed across resources. For millions of edges or complex path queries, use a real graph store.

[Memory relations](../catalog/memory/relations.md) is built on edges: it extracts typed links between the people, companies, and topics an agent learns about. [Collections](../concepts/resources.md) can declare edges per instance. The [Resources reference](../reference/resources.md) lists the options, every operation and the traversal rules.
