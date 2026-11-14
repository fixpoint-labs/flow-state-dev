---
title: What the browser sees
type: concept
description: The client is a thin, typed window onto a flow. A page calls actions, follows a session's stream and reads what the flow exposes, and gets nothing else.
---

import Figure from "@site/src/components/Figure";
import TheWindow from "./figures/the-window.svg";

# What the browser sees

A browser page never runs your flow. The flow runs on the server, and the page reaches it through the client, a small typed window with three openings. The page can call an action, follow a session as it happens, and read the data the flow chooses to expose. Nothing else gets through.

A flow is a self-contained system on the server, with actions you call and state of its own. A session is the record it keeps of many requests together.

The example on this page is a support desk: a flow called `support` with an action called `reply`.

<Figure svg={TheWindow} caption="The page sees the support session through three openings" description={"Two columns with a wall between them. On the left, the page, with four boxes: useAction for reply, useSession for items as they arrive, useClientData asking for ticketStatus, and useClientData asking for internalNotes. On the right, the server's session for support, drawn hatched because it outlives the request, with four boxes: the reply action, the items, ticketStatus named in client.expose, and internalNotes, which is highlighted because client data never holds it. The wall is labelled the client and has three openings. Three arrows from the page cross them, labelled calls, follows and reads, and reach reply, items and ticketStatus. A fourth, red arrow from the page toward internalNotes is labelled not exposed and ends in a bar at the wall, so useClientData never returns it."} />

## Wrapping the app

`FlowProvider` tells every hook below it which flow to talk to, who the user is, and where the server answers. Its props are in the [Client reference](../reference/client.md).

```tsx title="src/app/support-page.tsx"
import { FlowProvider } from "@flow-state-dev/react";
import { SupportDesk } from "./support-desk";

export function SupportPage({ userId }: { userId: string }) {
  return (
    <FlowProvider flowKind="support" userId={userId} baseUrl="">
      <SupportDesk />
    </FlowProvider>
  );
}
```

## Calling an action

```tsx title="src/app/reply-box.tsx"
import { useAction } from "@flow-state-dev/react";

export function ReplyBox({ sessionId }: { sessionId: string }) {
  const reply = useAction({ action: "reply" });

  return (
    <button
      disabled={reply.loading}
      onClick={() => void reply.execute({ text: "Where is order A-1001?" }, sessionId)}
    >
      Send
    </button>
  );
}
```

`execute` resolves when the server accepts the request, usually before the work is done. The answer arrives through the session. The [Client reference](../reference/client.md) covers the options.

## Following a session

```tsx title="src/app/conversation.tsx"
import { ItemsRenderer, useSession } from "@flow-state-dev/react";

export function Conversation({ sessionId }: { sessionId: string }) {
  const session = useSession(sessionId);

  return <ItemsRenderer items={session.items} />;
}
```

`useSession` returns the session's items: messages, tool calls, status cards. While a request streams, the text of a message grows token by token. By default the hook follows only the requests it sent itself, with `session.sendAction("reply", { text })`. A request sent through `useAction`, as `ReplyBox` does, is not one of them. Send it with `sendAction` to watch it stream, or pass `useSession(sessionId, { live: true })`: the hook then follows every request in the session, another agent's tab included, and each finished item joins `items` whole, a moment after it is saved.

[Sessions, items and streaming](./sessions-items-and-streaming.md) covers items and the stream.

## Reading what the flow exposes

Session state reaches client data only when the flow names a field in `client.expose`.

```ts title="src/flows/support/flow.ts"
import { defineFlow } from "@flow-state-dev/core";
import { z } from "zod";
import { reply } from "./blocks/reply";

export default defineFlow({
  kind: "support",
  actions: { reply: { block: reply } },
  session: {
    stateSchema: z.object({
      ticketStatus: z.enum(["open", "waiting", "solved"]).default("open"),
      internalNotes: z.array(z.string()).default([]),
    }),
    client: { expose: ["ticketStatus"] },
  },
})();
```

`reply` is a block, the framework's unit of work, in its own file beside the flow. On the page:

```tsx title="src/app/ticket-badge.tsx"
import { useClientData, useSession } from "@flow-state-dev/react";

export function TicketBadge({ sessionId }: { sessionId: string }) {
  const session = useSession(sessionId);
  const data = useClientData(session, { session: ["ticketStatus", "internalNotes"] });

  return <span>{String(data.session.ticketStatus)}</span>;
}
```

`data.session.ticketStatus` is `"open"`, then `"solved"` as the flow changes it, mid-stream. `data.session.internalNotes` is always `undefined`, because the flow never named it.

When the page needs an answer in a different shape, a view computes it on the server. [Views](./views.md) covers them.

## Rendering items

`ItemsRenderer` draws a list of items in order. It has a built-in for messages, reasoning, status, errors, tool output and suspension cards. For any other type it draws a placeholder, not the item's content. The [UI components reference](../reference/ui-components.md) lists what it draws.

To draw a type yourself, register a renderer on `FlowProvider`. A `component` item is one a flow emits to ask the page to draw a named component, and the renderer map is keyed by that name:

```tsx title="src/app/order-card.tsx"
import type { ComponentItem } from "@flow-state-dev/core/items";

export function OrderCard({ item }: { item: ComponentItem }) {
  return <div>Order {String(item.data.orderId)}</div>;
}
```

In `SupportPage`, add `renderers={{ component: { "order-card": OrderCard } }}` to `FlowProvider`.

## What the browser never gets

A field in session state that is not in `client.expose` never appears in `useClientData` or the session snapshot. It is not a secret, though: while a request runs, a change to it can travel in the stream's state-change events, so keep secrets out of session state. Items the flow marks as not for the client, such as block traces and router decisions, are removed from the stream. The `userId` the page sends is caller input, not proof. When the server checks who is calling (see the [Client reference](../reference/client.md)), it ignores this `userId` and uses the request's credentials.

## Without React

Hooks are a thin layer. Outside React, import `createClient` from `@flow-state-dev/client`. It has no React or DOM dependency and runs in Node, the browser and edge runtimes.

```ts title="src/lib/support-client.ts"
import { createClient } from "@flow-state-dev/client";
import type supportFlow from "../flows/support/flow";

export async function askSupport(userId: string, text: string) {
  const fsd = createClient({ userId, baseUrl: "https://support.example.com" });
  const support = fsd.flow<typeof supportFlow>("support");

  const session = await support.createSession({ title: "Billing question" });
  const sent = await support.send("reply", { text }, { sessionId: session.id });
  const final = await sent.wait();

  return final.status;
}
```

`sent.stream({ ... })` follows that one request as it runs. It does not reconnect on its own: if the connection drops, open it again with `startingAfter` set to the last sequence number you saw, and the server sends what you missed before carrying on. `fsd.sessions.stream(sessionId)` follows the whole session and retries by itself.

`import type` keeps the flow's server code out of a browser bundle, and the type is what makes a misspelt action name a compile error. [Client options](../reference/client.md) has the rest.

## What it gets you

- **Types follow the flow.** `reply` with the wrong input fails to compile.
- **A new field stays out of client data.** Add `refundLimit` to session state and `useClientData` returns nothing for it until you name it in `expose`.
- **A dropped stream loses nothing.** Reopen a request's stream with `startingAfter` and the server sends what you missed; `useSession` and a session stream reconnect by themselves.
- **Credentials live in one place.** Pass a `fetcher` that adds an `Authorization` header to `FlowProvider` (or `createClient`), and every call and stream carries it.

## How it fits with the others

The client is the page's half of [Flows and actions](./flows-and-actions.md): it names a flow and an action and sends input. What it reads is decided by [State and scopes](./state-and-scopes.md). Hooks for resources, such as `useResourceCollection`, are listed in the [Client reference](../reference/client.md).

## Next

- [Sessions, items and streaming](./sessions-items-and-streaming.md): the items the page follows and how they arrive.
- [State and scopes](./state-and-scopes.md): what `expose` copies and from which scope.
- [Client reference](../reference/client.md): every `createClient` and `FlowProvider` option.
- [UI components](../reference/ui-components.md): ready-made renderers.
