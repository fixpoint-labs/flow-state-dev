---
title: State and scopes
type: concept
description: "Four places to keep typed state, told apart by how long each lasts and who shares it."
---

import Figure from "@site/src/components/Figure";
import FourScopes from "./figures/four-scopes.svg";
import WhoSeesWhat from "./figures/who-sees-what.svg";

# State and scopes

Alice opens a support chat at acme on Monday and asks about an invoice. On Tuesday she opens a new chat and asks about a refund. The assistant should know she is on the Pro plan, because that is a fact about Alice. It should not assume Tuesday's chat is about the invoice, because that was a different conversation. And the refund limit acme's admin set should apply to Alice and to her colleague Bob alike.

Those are three lifetimes, and a fourth lives inside a single call. Flow State gives each its own place to keep typed state, called a scope: request, session, user and org. You describe each scope's fields with a Zod schema on the flow. A flow is the unit of AI work in your app, a block is one step in it, and a request is one call to one of the flow's actions.

<Figure svg={FourScopes} caption="Four scopes, four separate records" description={"Four boxes side by side: Request, Session, User and Org. Each shows the ctx handle a block reads, an example field from the support desk (lookups, topic, plan, refundLimit) and what keys the record: the request, the session id, the user and the org together, and the org. Request is drawn with a dashed outline because it lasts one action run. Session, user and org are hatched because they outlive the request. An arrow runs from the session to the user and to the org, labelled NAMES: a session names its user and org and holds no copy of their state. None of the four sits inside another."} />

## The smallest working example

```ts title="src/flows/support/flow.ts"
import { defineFlow } from "@flow-state-dev/core";
import { z } from "zod";
import { checkRefund } from "./blocks/check-refund";
import { noteTopic } from "./blocks/note-topic";

const supportFlow = defineFlow({
  kind: "support",
  requireUser: true,
  actions: {
    ask: { block: noteTopic },
    refund: { block: checkRefund },
  },
  request: { stateSchema: z.object({ lookups: z.number().default(0) }) },
  session: { stateSchema: z.object({ topic: z.string().default("") }) },
  user: {
    stateSchema: z.object({
      plan: z.enum(["free", "pro"]).default("free"),
      riskScore: z.number().default(0),
    }),
  },
  org: {
    stateSchema: z.object({
      refundLimit: z.number().default(50),
      refundsApproved: z.number().default(0),
    }),
  },
});

export default supportFlow();
```

Each scope takes a `stateSchema`. A field the stored record lacks reads as its default, so a brand-new user has `plan: "free"` before anything is written. `noteTopic` and `checkRefund` are blocks, each in its own file below.

## State for one conversation, and for one call

A session is one conversation. A request names it by `sessionId`, and the next request with the same id sees what the last one left.

```ts title="src/flows/support/blocks/note-topic.ts"
import { handler } from "@flow-state-dev/core";
import { z } from "zod";

export const noteTopic = handler({
  name: "note-topic",
  inputSchema: z.object({ message: z.string() }),
  sessionStateSchema: z.object({ topic: z.string().default("") }),
  execute: async (input, ctx) => {
    if (ctx.session.state.topic === "") {
      await ctx.session.patchState({ topic: input.message });
    }
  },
});
```

`ctx.session.state.topic` is typed from the schema, and `patchState` writes it. The block's `sessionStateSchema` lists the fields it touches; [the blocks reference](../reference/blocks.md) covers how it combines with the flow's.

Request state is the opposite. `ctx.request.patchState({ lookups: 1 })` writes to a record that belongs to this one call. The next request gets its own record, so it cannot read what this one wrote.

## State a user carries between conversations

User state follows one user across all their sessions. Alice's `plan` is there on Tuesday in a brand-new conversation, and in every flow on the server, unless a flow opts out of sharing.

The record is keyed by user and org together. Alice at acme and Alice at globex have two records, and each keeps its own. A conversation she starts at globex reads `plan` as the schema default until something writes it there. Her acme plan does not carry over.

A session is tied to one user and one org when it is created. Alice cannot move an acme conversation to globex: a later request on that session that names another org is rejected with `OrgBindingMismatchError`. [The flows reference](../reference/flows.md) covers opting a flow out of sharing.

## State an organization shares

Org state belongs to everyone in the organization.

```ts title="src/flows/support/blocks/check-refund.ts"
import { handler } from "@flow-state-dev/core";
import { z } from "zod";

export const checkRefund = handler({
  name: "check-refund",
  inputSchema: z.object({ amount: z.number() }),
  outputSchema: z.object({ approved: z.boolean() }),
  userStateSchema: z.object({ plan: z.enum(["free", "pro"]).default("free") }),
  orgStateSchema: z.object({
    refundLimit: z.number().default(50),
    refundsApproved: z.number().default(0),
  }),
  execute: async (input, ctx) => {
    const limit = ctx.org?.state.refundLimit ?? 50;
    const approved = ctx.user.state.plan === "pro" && input.amount <= limit;
    if (approved) {
      const count = ctx.org?.state.refundsApproved ?? 0;
      await ctx.org?.patchState({ refundsApproved: count + 1 });
    }
    return { approved };
  },
});
```

`ctx.org` carries the organization the request runs in. Its type allows it to be missing, so the code reads it with `?.` and falls back to the schema default; `ctx.request`, `ctx.session` and `ctx.user` are always set. Where that organization comes from is [Auth and tenancy](./auth-and-tenancy.md).

<Figure svg={WhoSeesWhat} caption="Alice and Bob: separate user records, one org record" description={"A large box for the organization acme holds three columns. On the left, Alice's two sessions and Bob's two sessions, each a hatched record with its own topic. In the middle, Alice's user record (plan: pro) and Bob's user record (plan: free), each hatched and separate. On the right, one hatched org record for acme, with the field refundLimit highlighted as the one shared record. Alice and Bob both read and write it. Everything stored is hatched because it outlives the request."} />

When Alice's request changes `refundLimit` or `refundsApproved`, Bob's next request reads the new value. Neither can read the other's user record.

## What the browser may see

State is private to the server. A scope's fields reach the browser only when the flow lists them in that scope's `client.expose`. Alice's `plan` can show in a badge. Her `riskScore` must not. Add `client: { expose: ["plan"] }` to `user` in `flow.ts` and leave `riskScore` out.

```tsx title="src/app/plan-badge.tsx"
import { useClientData, useSession } from "@flow-state-dev/react";

export function PlanBadge({ sessionId }: { sessionId: string }) {
  const session = useSession(sessionId);
  const { user } = useClientData(session, { user: ["plan"] });
  return <span>{String(user.plan)}</span>;
}
```

Only session, user and org state can be exposed, and each name must be a top-level field of that scope's schema. Rename `plan` to `tier` in the schema and leave `expose: ["plan"]` as it was, and `defineFlow` throws when the flow is defined, so a stale name never reaches the browser. [The flows reference](../reference/flows.md) has the rules. A value computed for a screen is a view, not an exposed field. See [Views](./views.md).

## What it gets you

- **A field outlives the call.** `topic` is there on the next request in Alice's chat, and the caller does not send it again.
- **A fact follows the person.** `plan` is there in Tuesday's new conversation.
- **One write reaches everyone in the org.** Raise `refundLimit` and Bob's next request sees it.
- **Private by default.** Adding `riskScore` to the schema sends nothing to the browser.
- **Typed access in blocks.** `ctx.session.state.topc` fails to compile, where `topic` works. `useClientData` with a list of names returns each value as `unknown`, which is why the badge wraps `user.plan` in `String`.

## How it fits with the others

Reach for state when a few fields are read by every block, like `topic` or `plan`. Reach for a [resource](./resources.md) when the data is a document or a collection you list and fetch. A resource declares its own scope. State inside one block run, reached as `ctx.self`, is block state and lasts one run; [blocks](../reference/blocks.md) covers it.

## Next

- [Resources](./resources.md): stored data with its own scope, collections and client access.
- [Views](./views.md): send a computed value to a screen.
- [Auth and tenancy](./auth-and-tenancy.md): where the user and org come from.
- [State operations](../reference/state-operations.md): every verb and what it returns, plus [blocks](../reference/blocks.md) for block state.
