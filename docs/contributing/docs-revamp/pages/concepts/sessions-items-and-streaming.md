---
title: Sessions, items and streaming
type: concept
description: A session is one conversation, everything that happens in it is an item, and items stream to the browser as they are made.
---

import Figure from "@site/src/components/Figure";
import OneRequest from "./figures/one-request-timeline.svg";
import Dropped from "./figures/dropped-and-resumed.svg";

# Sessions, items and streaming

A session is one conversation. Everything that happens in it is an item: a chat message, a tool call, a progress card, an error. Items reach the browser while the work is running, so a reply appears as it is written. The session keeps them, so a reload brings the conversation back.

The example on this page is a support desk. A customer asks where order A-1001 is, the model looks it up, and then it writes the reply.

## One reply, as it arrives

Each message the user sends starts a request: one run of one action, which is a call a client can make. The figure is one request, left to right, and the session's list below it.

<Figure svg={OneRequest} caption="One request, and the session's list under it" description={"A dashed outline, because a request lasts one action run, holds four boxes joined by arrows that mean then. First the user message, complete at once. Second a tool call, a tool_output item for lookUpOrder that is in progress and then done. Third, highlighted, the reply: a message item that is in progress while its text grows piece by piece, as Your order, shipped, Tuesday. Fourth the end, item.done, when the reply is completed with its full text. Below the request is the session's list, hatched because it outlives the request, holding the same items in the same order."} />

The user's message is complete the moment it appears. The tool call is one item that gains its result when it finishes. The reply is one `message` item that grows as the model's words arrive, then is sent again whole when the model finishes. [The items reference](../reference/items.md) has the events and statuses.

So when the model is halfway through a sentence, the browser holds the user's message, the finished tool call, and the reply so far. It has not yet received the reply's done event.

## Reading it on a page

```tsx title="src/app/ticket-thread.tsx"
"use client";

import { useSession } from "@flow-state-dev/react";

export function TicketThread({ sessionId }: { sessionId: string }) {
  const session = useSession(sessionId, { autoResume: true });

  return (
    <ul>
      {session.items.map((item) =>
        item.type === "message" ? (
          <li key={`${item.requestId}:${item.id}`}>
            {item.content.map((part) => (part.type === "output_text" ? part.text : ""))}
          </li>
        ) : null,
      )}
    </ul>
  );
}
```

`session.items` is every item in the session, in order, and the hook updates it as pieces arrive, so the reply grows on screen. The key pairs `requestId` with `id`, and the items reference says why. Drawing cards and tool calls too is [Rendering items](./rendering-items.md).

## The items you will meet

Each item has a `type` and a `status`, and records the block that made it. A block is the framework's unit of work, and [Blocks](./blocks.md) explains it. These four types are the ones this page uses.

| Item | Made by | Seen by the next request's model |
| --- | --- | --- |
| `message` | The user's input, a generator, or `ctx.emit.message` | Yes |
| `tool_output` | A tool call | Yes |
| `component` | `ctx.emit.component` | No |
| `status` | `ctx.emit.status` | No |

[The items reference](../reference/items.md) lists every type, its fields and the visibility rules.

## A session keeps them

A session belongs to the user who created it. A live view and a reloaded page show the same items in the same order. The default store keeps them in memory, so a server restart loses them; a SQLite or Postgres store keeps them. [The items reference](../reference/items.md) has what is stored and who can read it.

What the next request's model sees is a separate choice. A generator sees earlier items only when its `history` option is on, and the table's last column is the default for each type, so a progress card does not end up in the next prompt. The visibility options are in the reference.

## Emitting your own

A generator makes its own messages. Any other block emits items through `ctx.emit`. Here a handler shows a progress card while it looks up the order.

```ts title="src/flows/support/blocks/check-order.ts"
import { handler } from "@flow-state-dev/core";
import { z } from "zod";

// A stand-in for your order system.
const orders: Record<string, string> = { "A-1001": "shipped Tuesday" };

export const checkOrder = handler({
  name: "check-order",
  inputSchema: z.object({ orderId: z.string() }),
  outputSchema: z.object({ orderId: z.string(), detail: z.string() }),
  execute: async (input, ctx) => {
    const key = `order-${input.orderId}`;
    ctx.emit.component("order-lookup", { orderId: input.orderId, state: "looking" }, { key });
    const detail = orders[input.orderId] ?? "not found";
    ctx.emit.component("order-lookup", { orderId: input.orderId, state: "found", detail }, { key });
    return { orderId: input.orderId, detail };
  },
});
```

The first argument names a React component the client registers; [Rendering items](./rendering-items.md) shows how. The `key` makes the second call replace the first instead of stacking beside it.

`ctx.emit.message(text)` and `ctx.emit.status(text)` are the other two emitters. The items reference says what each one stores.

## From a terminal

`fsdev run` prints each item as a line of JSON. Below is the reply from the `hello-chat` example, shortened. A generator needs its model provider's key in the environment.

```bash
fsdev run hello-chat chat -i '{"message":"Say hi in four words."}' --quiet
```

```text
{"type":"item_added","item":{"type":"message","role":"assistant","status":"in_progress","content":[{"type":"output_text","text":""}], …}}
{"type":"content_delta","itemId":"item_msg_…","delta":"Hi"}
{"type":"item_done","item":{"type":"message","role":"assistant","status":"completed","content":[{"type":"output_text","text":"Hi there, my friend!"}], …}}
```

The terminal also prints trace rows such as `block_trace`. A browser's stream leaves them out unless the client asks for them, as [the items reference](../reference/items.md) explains.

## If the connection drops

A request keeps running on the server when the browser's connection ends. The stream is a view onto it, so a client that reconnects picks up after the last event it saw.

<Figure svg={Dropped} caption="A dropped connection, resumed at the next number" description={"Three boxes in a row. On the left, the browser live, holding events 1 to 41 and the reply so far, Your order shi. In the middle, the request still running on the server, producing events 42 to 57 while nobody listens. A red line with a bar between the first two boxes marks the lost connection. On the right, highlighted, the browser back, asking starting_after=41, so events 42 onward are sent. An arrow runs from the middle box to the right one. The reply text snaps to its saved copy and then grows again."} />

The browser client does this on its own.

Reload mid-reply and the order A-1001 thread comes back with the reply as last saved. With `autoResume: true`, as in the example above, the hook then attaches to the running request and carries on.

Detecting a stalled stream, heartbeats and the recovery calls are in [the items reference](../reference/items.md).

## What it gets you

- **The reply shows as it is written.** The reply is one item whose text grows, and `session.items` holds it.
- **A reload brings the thread back.** Reload mid-reply and the order A-1001 thread returns, and with `autoResume` the reply carries on. A dropped stream resumes where it stopped.
- **One list for everything the run does.** A message, a tool call and a progress card are all items in one ordered list, drawn by type.
- **The model remembers what you choose.** Visibility is set per item, so a progress card never ends up in the next prompt.

## How it fits with the others

Blocks emit items, and each item records which block made it. State and resources are separate. A change to either reaches a browser as a short notice item, not as the state itself; [State and scopes](./state-and-scopes.md) covers that.

## Next

- [Rendering items](./rendering-items.md): register the components that draw messages, tool calls and cards.
- [Blocks](./blocks.md): the units that emit items.
- [Items reference](../reference/items.md): every item type, visibility, the wire format, resume and heartbeat.
