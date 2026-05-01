---
sidebar_position: 8
title: clientData redaction
description: How to expose client-visible data without leaking server-only state.
---

# clientData redaction

`clientData` is the only path from scope state to the client snapshot. Raw request, session, user, and org state stay on the server.

That makes redaction explicit. If a value appears in `clientData`, the client can read it. If it does not, the client cannot.

## Scope-level clientData

Declare derived projections on a flow scope:

```ts
import { defineFlow } from "@flow-state-dev/core";
import { z } from "zod";

const flow = defineFlow({
  kind: "support",
  requireUser: true,
  session: {
    stateSchema: z.object({
      currentTicketId: z.string().optional(),
      internalRiskScore: z.number().default(0),
    }),
    clientData: {
      ticketStatus: (ctx) => ({
        currentTicketId: ctx.state.currentTicketId,
      }),
    },
  },
  actions: { /* ... */ },
});
```

The client receives `currentTicketId`, not `internalRiskScore`.

## Resource client data

Resources have their own `client.data` function. It works the same way, but per resource or collection item:

```ts
const artifacts = defineResourceCollection({
  pattern: "artifacts/**",
  stateSchema: z.object({
    title: z.string(),
    summary: z.string(),
    embedding: z.array(z.number()),
  }),
  client: {
    content: { read: true },
    data: (state) => ({
      title: state.title,
      summary: state.summary,
    }),
  },
});
```

The embedding remains server-only.

## Rules of thumb

- Treat every `clientData` return value as public to the authenticated caller.
- Return shaped objects, not raw state spreads.
- Keep secret material out of resource `content` if `client.content.read` or `prefetch` is enabled.
- Prefer narrow projections for lists. Fetch content lazily only when the UI needs it.

## Related pages

- [State and Scopes](/docs/fundamentals/state-and-scopes#why-clientdata-matters)
- [Client Access](/docs/resources/client-access)
