---
title: State and scopes
type: concept
description: State is typed data your backend keeps between steps. Four scopes decide how long it lasts and who shares it.
---

import Figure from "@site/src/components/Figure";
import FourScopes from "./figures/four-scopes.svg";
import WhoSeesWhat from "./figures/who-sees-what.svg";

# State and scopes

State is typed data your backend keeps so that one step can use what an earlier one worked out: a customer's plan, a count of tickets, a setting an admin chose. You declare its shape with a Zod schema and read and write it from the code that runs a step. Flow State keeps it in four places, called scopes, and they differ in two ways: how long the data lasts and who shares it.

The example is a support desk, a flow named `support`: a self-contained part of your backend that a client calls by action name. A session is where a flow keeps a run of requests together, here one customer conversation.

<Figure svg={FourScopes} caption="Four scopes, four separate records" description={"Four columns side by side, left to right: request, session, user and org. Request has a dashed outline, meaning it lasts one action run, and holds a field named tries. Session, user and org have hatched tops, meaning they outlive the request, and hold ticketCount, plan and licenses. Each column shows how to reach it from code, what it is for and what keys it: the request, the session id, the user and the organization, the organization. An arrow labelled names runs from the session to the user and the org: a session names them and holds none of their state. None of the four boxes sits inside another."} />

Request state is scratch space for one run, such as a retry count. A second request cannot read what the first put there. A flow declares it as `request: { stateSchema }`.

## Session first

Most state belongs to the session: if the next request might care, put it there. A flow declares it with a schema, and a field's default is what a new session reads.

```ts title="src/flows/support/flow.ts"
import { defineFlow } from "@flow-state-dev/core";
import { z } from "zod";
import { handleTicket } from "./blocks/handle-ticket";

export const supportFlow = defineFlow({
  kind: "support",
  actions: { handleTicket },
  session: {
    stateSchema: z.object({ ticketCount: z.number().default(0) }),
  },
});

export default supportFlow();
```

A block reads and writes it through `ctx`, the object every block receives. The block names the fields it touches, and `ctx.session.state` is typed from that.

```ts title="src/flows/support/blocks/count-ticket.ts"
import { handler } from "@flow-state-dev/core";
import { z } from "zod";

export const countTicket = handler({
  name: "count-ticket",
  inputSchema: z.object({ message: z.string() }),
  outputSchema: z.object({ first: z.boolean() }),
  sessionStateSchema: z.object({ ticketCount: z.number().default(0) }),
  execute: async (_input, ctx) => {
    const before = ctx.session.state.ticketCount;
    await ctx.session.incState({ ticketCount: 1 });
    return { first: before === 0 };
  },
});
```

`incState` adds to a number. `patchState` merges fields into the state instead. State is read-only on `ctx`; you change it through these calls. The next request with the same session id reads the count the last one left, and a new session starts again at `0`. [State operations](../reference/state-operations.md) lists every call and what it returns.

A session belongs to one user in one organization, fixed when it is created.

## State a user carries between conversations

The customer's plan should follow them into every conversation, so it is user state. Beside `session` in `defineFlow`, declare `user` the same way, a `stateSchema` with a `plan` that defaults to `"free"` and a `score` that defaults to `0`. Declare `org` with a `licenses` field that defaults to `5`.

```ts title="src/flows/support/blocks/upgrade-plan.ts"
import { handler } from "@flow-state-dev/core";
import { z } from "zod";

export const upgradePlan = handler({
  name: "upgrade-plan",
  inputSchema: z.object({ plan: z.string() }),
  outputSchema: z.object({ plan: z.string(), licenses: z.number().optional() }),
  userStateSchema: z.object({ plan: z.string().default("free") }),
  orgStateSchema: z.object({ licenses: z.number().default(5) }),
  execute: async (input, ctx) => {
    await ctx.user.patchState({ plan: input.plan });
    return { plan: input.plan, licenses: ctx.org?.state.licenses };
  },
});
```

The calls are the same as for the session. Only the scope changes. When a customer, Alice, upgrades to `"pro"`, a brand-new session of hers reads `plan` as `"pro"`. A user's state belongs to them inside one organization: Alice in another organization reads `"free"`, and so does Bob, who shares her organization but not her user record. How flows share or keep apart a user's record is in the [flows reference](../reference/flows.md).

## State an organization shares

Org state is for what everyone in an organization uses, such as settings an admin controls. Where the organization comes from is [Auth and tenancy](./auth-and-tenancy.md).

<Figure svg={WhoSeesWhat} caption="Alice and Bob share one org record" description={"Two rows, one per user, both in the organization acme. Each row has a hatched user record on the left, a hatched box of that user's two sessions in the middle, and arrows from the sessions to the left and to the right. Alice's user record holds plan pro and Bob's holds plan free, so each has a record of their own. Both rows send an arrow to the single tall org record on the right, which holds licenses 9 and is highlighted because Alice and Bob both read and write it. The key marks arrows as reads and writes and hatching as outliving the request."} />

Two users in one organization share the org record and nothing else. When Alice sets `licenses` to `9`, Bob reads `9`. His plan and his sessions stay his.

## What the browser may see

The browser never gets raw state. Only the fields you name in a scope's `client.expose` cross to it, so an internal score stays private by being left out. Request state cannot be exposed at all.

Add `client: { expose: ["plan"] }` to `user` in the flow. A component then asks for it by name.

```tsx title="src/app/plan-badge.tsx"
"use client";

import { useClientData, useSession } from "@flow-state-dev/react";

export function PlanBadge({ sessionId }: { sessionId: string }) {
  const session = useSession(sessionId, { flowKind: "support" });
  const data = useClientData(session, { user: ["plan"] });

  return <span>{String(data.user.plan)}</span>;
}
```

Blocks on the server still read and write `score`. A value computed from state is a [view](./views.md), not an exposed field.

## What it gets you

- **Typed state.** `ctx.session.state.ticketCount` is a `number`, and writing a string to it is a compile error.
- **A lifetime picked by where the field goes.** `tries` lasts one run, `ticketCount` one conversation, `plan` one customer and `licenses` one organization.
- **No filtering code.** A customer in two organizations has two user records, so no block writes `where orgId = ...`.
- **New fields need no migration.** A field added with a default reads that default on every record saved before it existed.
- **Nothing leaks by accident.** Adding a field to a schema does not send it to the browser. Only `expose` does.

## How it fits with the others

State is typed data on a scope. A [resource](./resources.md) is a named container of structured data with a scope of its own. A session's items, the messages and tool calls it records, sit beside its state and are not part of it; [Sessions, items and streaming](./sessions-items-and-streaming.md) covers them. Block and sequencer state is tied to one run rather than to a user, and the [blocks reference](../reference/blocks.md) covers it.

## Next

- [State operations](../reference/state-operations.md) lists every call on `ctx.session`, `ctx.user` and `ctx.org`, what each returns and what happens when two requests write at once.
- [Views](./views.md) shows how to send the browser a value computed from state.
- [Auth and tenancy](./auth-and-tenancy.md) covers where the user and organization come from.
- [Flows reference](../reference/flows.md) lists the isolation settings and every field of a scope's config.
