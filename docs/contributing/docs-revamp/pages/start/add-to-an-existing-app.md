---
title: Add to an existing app
type: start
description: Add one flow to a Next.js or Node app you already have, with a route that serves it and a page that calls it.
---

import Figure from "@site/src/components/Figure";
import WhereTheNewFilesGo from "./figures/where-the-new-files-go.svg";

# Add to an existing app

Flow State can live inside an app you already run. The AI part is a flow: a self-contained piece of backend with named actions. Your app calls them over HTTP, so nothing you have needs to move. You add three things: a flow, a server for it, and a page that calls it.

<Figure svg={WhereTheNewFilesGo} caption="Three new parts in an existing app" description={"One large box is your existing Next.js app. Inside it, on the left, a box holds your code, unchanged: your pages, routes, layout, config and styles, none of them edited. On the right, a highlighted area marks what is new, and holds three boxes. The flow is src/flows/support/flow.ts. The server is two files, fsdev.config.ts and the route file src/app/api/flows/[[...path]]/route.ts. The page is src/app/page.tsx. The highlight marks the only new files."} />

This page adds one flow, `support`, with one action, `reply`. It needs Next.js 15 or later with the App Router, and Node 22 or later. The Pages Router is not supported.

## Install the packages

```bash
pnpm add @flow-state-dev/core @flow-state-dev/engine @flow-state-dev/next @flow-state-dev/react zod @ai-sdk/openai
```

Put `OPENAI_API_KEY` in `.env.local` and keep that file out of git. [Environment variables](../reference/environment.md) has the key and package for Anthropic and Google.

## Write one flow

```ts title="src/flows/support/flow.ts"
import { defineFlow, generator } from "@flow-state-dev/core";
import { z } from "zod";

const replyInput = z.object({ message: z.string().min(1) });

const reply = generator({
  name: "reply",
  model: "openai/gpt-6-luna",
  prompt: "You answer support questions briefly.",
  inputSchema: replyInput,
  history: true,
  user: (input) => input.message,
  itemVisibility: { client: true, history: true },
});

const supportFlow = defineFlow({
  kind: "support",
  actions: {
    reply: { block: reply, userMessage: (input) => input.message },
  },
});

export default supportFlow();
```

`reply` is a generator, a block that calls a model. With no output schema it replies in text that streams, `history: true` gives it the earlier turns, and `itemVisibility` sends its reply to the browser and keeps it in the transcript. [Generators](../reference/generators.md) has the details. `userMessage` makes the user's own line appear in the transcript too. `kind` names the flow, and [Flows](../reference/flows.md) lists its other fields.

## Serve it

`fsdev.config.ts` builds the server from a list of flows.

```ts title="fsdev.config.ts"
import { createFlowState } from "@flow-state-dev/engine";
import support from "./src/flows/support/flow";

export default createFlowState({ flows: [support] });
```

A session is the record that keeps one user's requests together. With no `stores`, sessions live in memory and are lost on restart. [Serving flows](../concepts/serving-flows.md) covers keeping them, and every other option.

A route file mounts it in Next.js.

```ts title="src/app/api/flows/[[...path]]/route.ts"
import { createNextHandler } from "@flow-state-dev/next";
import flowstate from "../../../../../fsdev.config";

export const dynamic = "force-dynamic";

export const { GET, POST, PATCH, DELETE } = createNextHandler(flowstate, {
  allowUnauthenticated: process.env.NODE_ENV !== "production",
});
```

The flow has no sign-in yet, so `allowUnauthenticated` lets the handler serve it outside production, and in production it refuses every request until the flow checks who is calling: [Auth and tenancy](../concepts/auth-and-tenancy.md). One route file serves every flow under `/api/flows`. A second flow is one more entry in `flows`.

**No Next.js app?** Run `pnpm add @flow-state-dev/node`. It starts a long-lived HTTP server for the same config.

```ts title="src/server.ts"
import { serve } from "@flow-state-dev/node";
import flowstate from "../fsdev.config";

await serve(flowstate, { host: "127.0.0.1" });
```

`serve` binds every network interface unless you pass `host`. On any host but loopback it refuses to start while a flow has no way to check who is calling (`authentication.resolvePrincipal`), so this one binds `127.0.0.1`. It does not read `.env.local`, so start it with the file loaded:

```bash title="Terminal"
npx tsx --env-file=.env.local src/server.ts
```

## Call it from a page

```tsx title="src/app/page.tsx"
"use client";

import { useState } from "react";
import { FlowProvider, ItemsRenderer, useFlow, useSession } from "@flow-state-dev/react";

export default function Page() {
  return (
    <FlowProvider flowKind="support" userId="u1">
      <Support />
    </FlowProvider>
  );
}

function Support() {
  const flow = useFlow({ autoCreateSession: true });
  const session = useSession(flow.activeSessionId);
  const [text, setText] = useState("");

  return (
    <main>
      <ItemsRenderer items={session.items} />
      {session.error && <p role="alert">{session.error.message}</p>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          session.sendAction("reply", { message: text }).then(
            () => setText(""),
            () => {}, // kept in session.error, and the text stays for a retry
          );
        }}
      >
        <input value={text} onChange={(e) => setText(e.target.value)} />
        <button disabled={!session.canSendAction || !flow.activeSessionId}>Send</button>
      </form>
    </main>
  );
}
```

`useFlow` finds the user's newest session, or creates one, and gives back its id. The id is empty on the first render, so the button waits for it. `session.items` is the transcript, in order, and `ItemsRenderer` draws it with plain defaults. `sendAction` resolves when the request is accepted, and the answer arrives in `items`. If the request is refused, it rejects and `session.error` holds why, so the form clears the text only on success.

**Every call says who is calling.** The provider's `userId` goes with each request, and a call without one is refused. With no sign-in configured, the server believes whatever `userId` the request carries, so a setup like this one is only for development. Only `serve()` and `fsdev dev` on a loopback host serve it without an override. The Next.js, Vercel and Lambda handlers refuse every request unless given `allowUnauthenticated: true`. [Auth and tenancy](../concepts/auth-and-tenancy.md) covers verifying callers.

## Common pitfalls

- **The page stays empty.** The generator has no `itemVisibility`, so it emits nothing for the page to show. Set `{ client: true, history: true }`: [Items and the stream](../reference/items.md).
- **The reply arrives all at once.** Next.js buffers the response unless the route file exports `dynamic = "force-dynamic"`: [HTTP API](../reference/http-api.md).
- **Streaming and state calls fail.** The route file must export all four verbs, `GET`, `POST`, `PATCH` and `DELETE`, and the stream is read with `GET`: [HTTP API](../reference/http-api.md).
- **`/api/flows` returns 404.** The route folder must be named `[[...path]]`, with double brackets, so the bare `/api/flows` is served: [HTTP API](../reference/http-api.md).
- **A hook errors in a server component.** Hooks run only in client components, so put `"use client"` at the top of the file: [Client configuration](../reference/client.md).
- **Requests go to `/api/api/flows`.** The client adds `/api/flows` itself, so a `baseUrl` of `/api` doubles the prefix. On the same origin, leave `baseUrl` off: [Client configuration](../reference/client.md).
- **`createNextHandler` rejects the router.** It takes the object `createFlowState` returned, not `flowstate.getRouter()`: [Runtime options](../reference/runtime.md).

## Next

- [Serving flows](../concepts/serving-flows.md) covers `stores`, models and the other ways in.
- [What the browser sees](../concepts/what-the-browser-sees.md) has the hooks, and how to draw your own items.
- [Auth and tenancy](../concepts/auth-and-tenancy.md) is what to set before anyone else can reach the route.
- [Choose where to deploy](../build/deploy.md) puts it on Vercel or a long-lived host.
- [Runtime options](../reference/runtime.md) lists every option on `createFlowState`.
