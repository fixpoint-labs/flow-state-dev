---
title: Find records by facets
type: recipe
description: "Have a model answer fixed questions about each record when it is written, then search by those answers with no model call."
---

# Find records by facets

"Open billing tickets" should find the ticket that says "my card was billed again for a plan I already paid for", which says neither "open" nor "billing". A model can answer that, but asking it on every search is slow and costs a call per lookup.

Facets move the question to write time. When a ticket's body is written, an [evaluator](../concepts/blocks.md) (a block that answers fixed questions with typed answers) answers a few questions about it, such as topic and status. The answers are stored on the ticket. A search then filters the stored answers, and no model runs.

## 1. Write the questions

Each `choice` question lists its options as keys with a description. The search filters on choice questions, and the option keys are the values a search can ask for.

```ts title="src/flows/tickets/facets.ts"
import { choice } from "@flow-state-dev/core";

const TOPICS = {
  billing: "Payments, charges, refunds and invoices",
  outage: "Something is down, broken or erroring",
  other: "Anything else",
} as const;

const STATUSES = {
  open: "The customer needs something from us",
  closed: "The problem is resolved",
} as const;

export const ticketQuestions = {
  topic: choice("What is this support ticket about?", TOPICS),
  status: choice("Is the customer's problem open?", STATUSES),
};
```

Answers to yes/no and scale questions are stored too, where your own code can read them. A search can't filter on them.

## 2. Define the collection

`triage` is an evaluator that asks those questions. The model is named here and nowhere else.

```ts title="src/flows/tickets/blocks/triage.ts"
import { evaluator } from "@flow-state-dev/core";
import { ticketQuestions } from "../facets";

export const triage = evaluator({
  name: "ticket-facets",
  model: "typesafe-ai/jev",
  questions: ticketQuestions,
});
```

`defineFacetedCollection` takes the evaluator, reads the questions off it, and returns the collection, a search block and a reindex block. The questions must be a fixed object, not a function. The evaluator's input is the ticket body.

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

The collection adds two fields beside yours, `facets` and `indexedAs`. Don't put them in `stateSchema`. The [reference](../reference/resources.md) lists what `defineFacetedCollection` refuses.

## 3. Write and search

A block writes a ticket's body through the collection. Any body write inside a flow turn classifies the ticket, whether it comes from an action, a tool or an agent.

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

Pass `tickets.resources` to `defineFlow`, and don't add another `tickets` entry.

```ts title="src/flows/tickets/flow.ts"
import { defineFlow } from "@flow-state-dev/core";
import { writeTicket } from "./blocks/write-ticket";
import { tickets } from "./resources/tickets";

export default defineFlow({
  kind: "tickets",
  requireUser: true,
  resources: tickets.resources,
  actions: {
    write: { block: writeTicket },
    search: { block: tickets.search },
    reindex: { block: tickets.reindex },
  },
})();
```

Search takes one optional value per choice question and returns the matching keys:

```text
search  { "topic": "billing", "status": "open" }
        → { "keys": ["t1", "t7"] }
```

A ticket with no facets never matches. You can give `tickets.search` to an agent as a tool, and the agent sees each question's options as the allowed values.

Classification runs on a side chain, in the background of the turn. If it fails, the save still succeeds and the ticket has no facets until you reindex it. Facets always describe the current body: if a body is rewritten while an earlier classification runs, the earlier answers are discarded.

## 4. Reindex

Tickets written before you added facets, and tickets whose classification failed, have no facets. Call `reindex` to classify them. After you change the questions, call it with `{ "force": true }` to reclassify every ticket.

```text
reindex  { "force": true }
         → { "reindexed": ["t1", "t7"], "failed": [] }
```

Nothing retries a failed ticket. Run reindex again when the model is back.

## Next

- [Search a collection](./search-a-collection.md): find notes by path, text or keyword.
- [Route with an evaluator](./route-with-an-evaluator.md): use an evaluator's answer to choose a path.
- [Resources reference](../reference/resources.md): search options, `minConfidence`, what clients can do with a faceted collection, and every definition-time refusal.
