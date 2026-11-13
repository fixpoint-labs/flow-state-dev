---
title: Resources
type: concept
description: A resource is named, stored data that a block declares, such as a document, a record, or a collection of them.
---

import Figure from "@site/src/components/Figure";
import StateAndResources from "./figures/state-and-resources.svg";
import AResourceTravels from "./figures/a-resource-travels.svg";

# Resources

A resource is named, stored data that a block declares: a document, a record, or a collection of them. It is for things that have a name and a body of their own, like a refund policy every reply should follow, or the notes piling up on a support ticket.

A block is one piece of work in a flow, one of the steps your app calls through its actions. Declare a resource on the block that needs it, and the framework stores it, loads it when the action that uses it runs, and keeps it apart from session state and from other resources. The examples are a support desk. `refundPolicy` is a document, `draftReply` is the block that drafts each reply, and `ticketNotes` is a collection.

A flow also keeps session state, the typed fields on each session's record. The figure sets the two side by side.

<Figure svg={StateAndResources} caption="Session state beside the resources it can reach" description={"At the top, a box for the browser, which sees neither session state nor resources unless a client config exposes it; two dashed arrows run up from the columns below to it, each meaning only when exposed. Below, two hatched columns, both stored with the scope so both outlive the request. On the left, session state on the session record, two flat fields, escalated and ticketCount, read as ctx.session.state, for flags, counters and small settings. On the right, resources, each in its own store keyed by scope and then path: refundPolicy at org/refundPolicy, highlighted as having a name of its own, and one note of the ticketNotes collection at session/ticketNotes/n-1. Each has a content body and its own typed state, and refundPolicy is read as ctx.resources.refundPolicy. A note says state is versioned and content is not."} />

## A resource a block declares

`defineResource` takes a scope, a schema for the resource's typed fields, and its starting content. The scope says whose it is: one `session`, one `user`, or one `org`. The refund policy is the same for everyone, so it is org-scoped.

```ts title="src/flows/support/resources/refund-policy.ts"
import { defineResource } from "@flow-state-dev/core";
import { z } from "zod";

export const refundPolicy = defineResource({
  scope: "org",
  stateSchema: z.object({ version: z.string().default("v1") }),
  content: "Refunds are issued within 30 days of purchase. After that, offer store credit.",
});
```

A block declares it in its `resources` map, and reads it from `ctx.resources`.

```ts title="src/flows/support/blocks/draft-reply.ts"
import { generator } from "@flow-state-dev/core";
import { z } from "zod";
import { refundPolicy } from "../resources/refund-policy";

export const draftReply = generator({
  name: "draft-reply",
  model: "openai/gpt-6-luna",
  prompt: "You answer customer support messages. Follow the refund policy you are given.",
  inputSchema: z.string(),
  resources: { refundPolicy },
  user: async (input, ctx) => {
    const policy = await ctx.resources.refundPolicy.readContent();
    return `Refund policy:\n${policy ?? ""}\n\nCustomer message:\n${input}`;
  },
});
```

The key in `resources` is the name on `ctx.resources`, and a name the block did not declare is a type error. `readContent()` returns the body. The [resources reference](../reference/resources.md) lists every method on the handle.

## State or a resource?

Session state is for flags, counters and small settings. Every block in the flow reads its fields by name from one shared set. The [reference](../reference/resources.md) covers what happens when two blocks declare the same field differently.

A resource has its own name and its own handle, so it cannot collide with another resource's fields. Reach for one when the data has a body of content, needs an identity of its own, or has a nested structure.

Both live on the same three scopes. The refund policy is a resource, and org scope fits: it is one document for every user. User scope would give each user their own, and session scope would give each session its own. At user and org scope, flows that serve the same user or org share a resource by default; the [reference](../reference/resources.md) covers keeping one flow's copy apart.

## Collections

Ticket notes pile up, and you cannot say how many. A collection is a typed set of resources created while the app runs.

```ts title="src/flows/support/resources/ticket-notes.ts"
import { defineResourceCollection } from "@flow-state-dev/core";
import { z } from "zod";

export const ticketNotes = defineResourceCollection({
  pattern: "ticketNotes/**",
  scope: "session",
  stateSchema: z.object({ author: z.string(), pinned: z.boolean().default(false) }),
});
```

```ts title="src/flows/support/blocks/add-note.ts"
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { ticketNotes } from "../resources/ticket-notes";

export const addNote = handler({
  name: "add-note",
  inputSchema: z.object({ key: z.string(), author: z.string(), text: z.string() }),
  outputSchema: z.object({ path: z.string() }),
  resources: { notes: ticketNotes },
  execute: async (input, ctx) => {
    const note = await ctx.resources.notes.create(input.key, { author: input.author });
    await note.writeContent(input.text);
    return { path: note.path };
  },
});
```

The pattern says every note's key sits under `ticketNotes`, at any depth. The name you give in `resources`, here `notes`, is how the block reaches the collection. `create` makes a note and returns its handle, which has its own state and content like any resource. Reading notes back, and what to use when a key may repeat, is in the [reference](../reference/resources.md).

If the set is small and fixed, say three attachments per ticket, one resource with an array in its state is simpler.

## Who can read it: the model, your code, the browser

Your code reads a resource through `ctx.resources`, in any block that declares it.

The model reads nothing by default. `draftReply` passed the policy into its prompt itself. A resource opts a generator in with `llmReadable` and `llmWritable`, and a collection sets them once for every note. The [reference](../reference/resources.md) has the options and the tools that use them.

The browser reads nothing by default either. A `client` config on the resource opens the body, and `expose` picks which state fields the page sees. The [reference](../reference/resources.md) lists the options.

## It travels with the block

<Figure svg={AResourceTravels} caption="draftReply carries its refundPolicy into two flows" description={"On the left, a block named draftReply with its resources declaration, resources: { refundPolicy }, highlighted as the one thing that travels. In the middle, two flows, support and billing, each containing draftReply and a refundPolicy resource. An arrow from the block to each flow means installs. On the right, one hatched box, the stored org/refundPolicy document, which outlives the request; an arrow from each flow into it means reads, so both flows read the same stored document. Notes say a block's resources come with it, and that at org scope the stored document is shared."} />

A block's declaration goes wherever the block goes. A sequencer, a block that runs other blocks in order, collects the declarations of its steps, and a flow collects them from its blocks. Put `draftReply` in the billing flow and `refundPolicy` is there too, with no entry in the flow itself.

What comes along is the definition. The stored document is keyed by scope, and an org-scoped one is shared, so billing reads the same policy support does.

A block can reach only the resources it declares.

## What it gets you

- **A name of its own.** `refundPolicy` cannot collide with a field in session state.
- **The block brings what it needs.** Drop `draftReply` into another flow and its policy installs with it.
- **It lasts as long as its scope and store.** A user-scoped resource is there in the user's next session, and on a store that persists, after a restart.
- **Private until you open it.** The model and the browser see a resource only when its definition says so.

## How it fits with the others

Session state is for flat fields, and the conversation itself is kept as items, a separate store from resources. Resources are named records read by key, not a database: there is no query language over them.

## Next

- [Search a collection](../build/search-a-collection.md) finds notes by path and by content.
- [Link records with edges](../build/link-records.md) connects one resource to another.
- [Run a block when a resource changes](../build/react-to-a-change.md) reacts to a write.
- [Resources reference](../reference/resources.md) lists every option, the scopes and storage, and the browser and HTTP access.
