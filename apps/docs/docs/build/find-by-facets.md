---
title: Find records by facets
type: recipe
description: "Have a model answer fixed questions about each record when it is written, then search by those answers with no model call."
---

# Find records by facets

"Open billing tickets" should find the ticket that says "my card was billed again for a plan I already paid for", which says neither "open" nor "billing". A model can answer that, but asking it on every search is slow and costs a call per lookup.

Facets are answers stored on each record, so the question moves to write time. When a ticket's body is written, an [evaluator](../concepts/blocks.md) (a block that answers fixed questions with typed answers) answers a few questions about it, such as topic and status, and stores the answers on the ticket. A search then filters the stored answers, and no model runs.

## 1. Write the questions

Each `choice` question lists its options as keys with a description. The search filters on choice questions, and the option keys are the values a search can ask for.

```ts title="src/flows/tickets/facets.ts"
import { choice, type EvaluatorQuestions } from "@flow-state-dev/core";

const TOPICS = {
  billing: "Payments, charges, refunds and invoices",
  outage: "Something is down, broken or erroring",
  other: "Anything else",
} as const;

const STATUSES = {
  open: "The customer needs something from us",
  closed: "The problem is resolved",
} as const;

// Annotated as EvaluatorQuestions so step 2 type-checks under `strict`. The search's input
// type then loses the option keys; the search checks them when it runs.
export const ticketQuestions: EvaluatorQuestions = {
  topic: choice("What is this support ticket about?", TOPICS),
  status: choice("Is the customer's problem open?", STATUSES),
};
```

Yes/no and scale questions are also available; the [Resources reference](../reference/resources.md) says which kinds a search can filter on.

## 2. Define the collection

`triage` is an evaluator that asks those questions. To change the model, change it here.

```ts title="src/flows/tickets/blocks/triage.ts"
import { evaluator } from "@flow-state-dev/core";
import { ticketQuestions } from "../facets";

export const triage = evaluator({
  name: "ticket-facets",
  model: "openai/gpt-6-luna",
  questions: ticketQuestions,
});
```

`defineFacetedCollection` takes the evaluator and returns the collection, the `resources` to give the flow, a search block and a reindex block.

```ts title="src/flows/tickets/resources/tickets.ts"
import { defineFacetedCollection } from "@flow-state-dev/core";
import { z } from "zod";
import { triage } from "../blocks/triage";

export const tickets = defineFacetedCollection({
  name: "tickets",
  pattern: "tickets/*",
  scope: "user",
  stateSchema: z.object({ title: z.string() }),
  evaluator: triage,
});
```

The collection reserves the field names `facets` and `indexedAs` for the stored answers, so leave them out of `stateSchema`. The [Resources reference](../reference/resources.md) lists what `defineFacetedCollection` refuses.

## 3. Write and search

A block writes a ticket's body through the collection. Any body write during an action run classifies the ticket, whether an action, a tool or an agent made it.

```ts title="src/flows/tickets/blocks/write-ticket.ts"
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { tickets } from "../resources/tickets";

export const writeTicket = handler({
  name: "write-ticket",
  inputSchema: z.object({ key: z.string(), title: z.string(), body: z.string() }),
  outputSchema: z.object({ key: z.string() }),
  resources: { tickets: tickets.collection },
  execute: async (input, ctx) => {
    const ticket = await ctx.resources.tickets.create(input.key, { title: input.title });
    await ticket.writeContent(input.body);
    return { key: input.key };
  },
});
```

The blocks bring the collection into the flow themselves. Pass `tickets.resources` as the flow's `resources` as well: it carries any resources the evaluator declares, which reach the flow no other way.

```ts title="src/flows/tickets/flow.ts"
import { defineFlow } from "@flow-state-dev/core";
import { writeTicket } from "./blocks/write-ticket";
import { tickets } from "./resources/tickets";

export default defineFlow({
  kind: "tickets",
  requireUser: true,
  resources: tickets.resources,
  actions: {
    write: writeTicket,
    search: tickets.search,
    reindex: tickets.reindex,
  },
})();
```

Search takes one optional value per choice question and returns the matching keys of the signed-in user's tickets, since the collection is `scope: "user"` (see [scopes](../concepts/state-and-scopes.md)). The [Resources reference](../reference/resources.md) has the rest of its input and output.

```text
search  { "topic": "billing", "status": "open" }
        → { "keys": ["t1", "t7"] }
```

Each body write makes one evaluator call that answers every question, during the write's action run. Once the write action returns, the ticket is classified, and a search finds it. If the model call fails, the save succeeds, but the ticket has no facets and matches no search, not even `{}`, which returns every classified ticket. Nothing retries it until the body is written again or you reindex. Writing a new body clears the old facets first, so search never matches a ticket on answers about an earlier body.

## 4. Reindex

Call `reindex` to classify tickets that have no facets. After you change the questions, call it with `{ "force": true }` to reclassify every ticket.

```text
reindex  { "force": true }
         → { "reindexed": ["t1", "t7"], "failed": [] }
```

Tickets it classifies are listed in `reindexed`, and tickets whose model call fails again are listed in `failed`, with no retry. The [Resources reference](../reference/resources.md) has the rest.

## Next

- [Search a collection](./search-a-collection.md): find notes by path, text or keyword.
- [Route with an evaluator](./route-with-an-evaluator.md): use an evaluator's answer to choose a path.
- [Resources reference](../reference/resources.md): search options, `minConfidence`, what clients can do with a faceted collection, and every definition-time refusal.
