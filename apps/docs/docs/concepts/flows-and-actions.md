---
title: Flows and actions
type: concept
description: A flow is a self-contained system inside your app, with actions clients call and data of its own. You define it once and the server runs instances of it.
---

import Figure from "@site/src/components/Figure";
import FlowsAndActions from "./figures/flows-and-actions.svg";

# Flows and actions

A flow is a self-contained system inside your app. It exposes actions that clients call, and it keeps its own data. What happens inside is up to you. A flow can act like an agent that responds, works in the background and is woken by other flows, like a controller that handles requests, or like any other self-contained mechanism. You define a flow once, the way you write a class, and the server runs instances of it.

A client never reaches the code inside. It names a flow and an action, `support` and `reply`, and sends some input.

The example on this page is a support desk: a flow called `support` with an action called `reply`.

<Figure svg={FlowsAndActions} caption="One flow definition, three things people call the flow" description={"Three columns, left to right. The first, in your code, is the flow.ts file with a defineFlow call whose kind is support and whose actions hold one action named reply; reply is highlighted as the name a client sends. An arrow, keyed as becomes or owns, runs to the second column, the registered flow in the running server: one support entry, answering every user, not kept per user. A second arrow runs to the third column, the sessions in the store, hatched because they outlive the request: alice's session with a count of 2 and bob's with a count of 1, one session each."} />

## A flow with one action

`reply` is a block, the framework's unit of work (see [Blocks](./blocks.md)). This one counts replies and echoes the message. It stands in for a model.

```ts title="src/flows/support/blocks/reply.ts"
import { handler } from "@flow-state-dev/core";
import { z } from "zod";

export const reply = handler({
  name: "reply",
  inputSchema: z.object({ message: z.string().min(1) }),
  outputSchema: z.object({ echoed: z.string(), count: z.number() }),
  sessionStateSchema: z.object({ replyCount: z.number().default(0) }),
  execute: async (input, ctx) => {
    const count = ctx.session.state.replyCount + 1;
    await ctx.session.patchState({ replyCount: count });
    return { echoed: input.message, count };
  },
});
```

```ts title="src/flows/support/flow.ts"
import { defineFlow } from "@flow-state-dev/core";
import { reply } from "./blocks/reply";

export const supportFlow = defineFlow({
  kind: "support",
  actions: { reply },
});

export default supportFlow();
```

`defineFlow` takes a `kind`, the flow's id, which a client and `fsdev run` use to name it, and `actions`. The flow needs nothing about the reply count: `reply` declares the state it uses, and the flow picks that up from its blocks. `defineFlow` returns the definition. Calling the definition makes the flow the server registers, which is the default export. The app lists it once:

```ts title="fsdev.config.ts"
import { createFlowState } from "@flow-state-dev/engine";
import support from "./src/flows/support/flow";

export default createFlowState({ flows: [support] });
```

## What an action is

An action is a name a client can send, and the block that name runs. The name is its key in `actions`, so `reply` here. An action is the bare block, or `{ block, ... }` when the action needs options of its own; the [flows reference](../reference/flows.md) lists them.

Its input is checked against a schema before the block runs. By default that is the block's own `inputSchema`; the [flows reference](../reference/flows.md) covers overriding it on the action.

A second action is a second key. `actions: { reply, reset }` adds `reset`, which can take `{}` while `reply` takes `{ message }`. The flow, its sessions and its stored state stay as they are, and a client can send `reset` into a session `reply` used.

## Calling it

```ts title="src/lib/support.ts"
import { createClient } from "@flow-state-dev/client";
import type { supportFlow } from "../flows/support/flow";

export async function askSupport(userId: string, message: string) {
  const fsd = createClient({ userId, baseUrl: "http://localhost:3000" });
  const support = fsd.flow<typeof supportFlow>("support");

  const session = await support.createSession();
  const sent = await support.send("reply", { message }, { sessionId: session.id });
  return sent.result();
}
```

`send` resolves when the server accepts the request, not when the action finishes. `result()` waits, then resolves `{ status: "completed", output }`, or `{ status: "failed", error }`. A call the schema refuses settles as `failed`, and the [flows reference](../reference/flows.md) shows its shape.

Passing `typeof supportFlow` types the call. `send("walk", ...)` and a `message` that is not a string are both compile errors. Use `import type` so the flow's server code stays out of the browser bundle.

### With no server

`fsdev run` calls an action from a terminal. It takes the flow's id, the action and the input, and prints one JSON line per event ([CLI reference](../reference/cli.md)):

```bash
fsdev run support reply -i '{"message":"hi"}'
```

The last line is `flow_complete` with the action's `output`.

From code, hand the client the engine instead of a URL. The calls are the same ones.

```ts title="src/lib/support-local.ts"
import { createClient } from "@flow-state-dev/client";
import { createFlowState, createInProcessFetch } from "@flow-state-dev/engine";
import support from "../flows/support/flow";

const fetcher = createInProcessFetch(createFlowState({ flows: [support] }));
export const fsd = createClient({ userId: "alice", baseUrl: "", fetcher });
```

[Run a flow from your own code](../build/run-a-flow-from-code.md) covers calling an action with no client at all.

## One definition, many sessions

"The flow" names different things. The definition is code in your repo. The registered flow is what the running server answers with, one per id, shared by every user. A session is one running record of requests to it, kept in the app's store.

Alice and Bob both send `reply` at once, each in their own session.

- **Shared.** The registered `support` flow: the same code, the same `reply` action, the same schema. Both also use the app's stores, and any organization-wide state the flow keeps ([State and scopes](./state-and-scopes.md)).
- **Separate.** Each user's session and its state, so Alice's second reply is `count: 2` and Bob's first is `count: 1`. Each `send` is also its own request, with its own id.

If Bob sends to Alice's session id, the server refuses it with `404 Unknown session`, the same answer it gives for an id that does not exist. Nothing is written, and the answer does not reveal that the session exists ([HTTP API reference](../reference/http-api.md)).

A send with no `sessionId` starts a session of its own and does not return its id ([HTTP API reference](../reference/http-api.md)). To keep later sends together, create the session first and pass its id, as above.

## What it gets you

- **One name to call.** The client sends `reply` to `support`. The blocks behind it can change without the client changing.
- **Checked input.** A bad call comes back as a failed request before the block runs.
- **A session that remembers.** Call `reply` twice on one session and the second call sees the first's count. A new session starts at 1.
- **A client checked against the flow.** Rename an action and the client stops compiling.

## How it fits with the others

A flow is the part of your backend a client can see. Other callers, such as webhooks, schedules and MCP, reach the same registered flow, and one definition can be registered several times under different ids. Both are in the [flows reference](../reference/flows.md).

## Next

- [Sessions, items and streaming](./sessions-items-and-streaming.md) shows what a request records and how a client follows it live.
- [State and scopes](./state-and-scopes.md) covers what a session, a user and an organization each keep.
- [Flows reference](../reference/flows.md) lists every field of `defineFlow` and of an action.
- [HTTP API reference](../reference/http-api.md) lists the endpoints a send goes to.
