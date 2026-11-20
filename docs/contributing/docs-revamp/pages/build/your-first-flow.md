---
title: Your first flow
type: tutorial
description: Build a small chat from nothing. A block that calls a model, a block that counts, a flow that exposes them as one action, a page that uses it, and a test that needs no model.
---

import Figure from "@site/src/components/Figure";
import WhatYouBuild from "./figures/what-you-build.svg";
import WhereEachFileGoes from "./figures/where-each-file-goes.svg";

# Your first flow

A chat that answers is a model call plus a record of what was said. Flow State has you build the two as small pieces that each run on their own: one that calls a model, one that runs plain code, and a named entry point a page can call. Because every piece runs without the page, you check the chat in the terminal first, add the page after, and test all of it without a model or an API key.

This page builds a chat that counts the messages sent to it.

## What you will build

The flow is called `hello-chat`. A flow is a self-contained system in your app: it has actions that pages call and data of its own. Its one action is `chat`, and the action runs a sequencer, which runs blocks in order. Blocks are the units of work. `countMessage` is a handler, a block of plain code. `chatGenerator` is a generator, a block that asks a model. A session is where the flow keeps its requests together as one record. Here it holds the messages and the count.

<Figure svg={WhatYouBuild} caption="hello-chat: one action, two blocks, one session" description={"An action run, drawn with a dashed outline because it lasts one action run, holds a sequencer called chat-pipeline. Inside it, count-message, a handler, passes to chat-generator, a generator, with an arrow meaning then. On the right, a session drawn with a hatched top because it outlives the request holds the messageCount state, highlighted, and the messages. Two double-headed arrows join the blocks to the session, meaning reads and writes. Notes say a page calls the action and never a block, and that the run ends when the reply is done while the session stays."} />

## 1. Start a project

There is no scaffolding command. Start in a Next.js app on Node 22.3 or newer and install the packages.

```bash
pnpm add @flow-state-dev/core @flow-state-dev/engine @flow-state-dev/next @flow-state-dev/react zod @ai-sdk/openai
pnpm add -D @flow-state-dev/fsdev @flow-state-dev/testing vitest --allow-build=better-sqlite3
```

The CLI's default store is SQLite, and pnpm 10 builds the `better-sqlite3` native module only when you allow it. `--allow-build` needs pnpm 10.4 or later; on pnpm 9, leave the flag off, and npm, yarn and bun need no flag.

Set a key for the model in your shell with `export OPENAI_API_KEY=...`. Flow State reads provider keys from the environment, so `openai/gpt-6-luna` in step 2 works once `OPENAI_API_KEY` is set. [Models](../concepts/models.md) covers other providers.

<Figure svg={WhereEachFileGoes} caption="Where each file of hello-chat goes" description={"A project box holds two columns of boxes. On the left, a box for src/flows/hello-chat holds flow.ts, highlighted as the file to open, then blocks/chat-generator.ts for what the model is told, blocks/count-message.ts, blocks/chat-pipeline.ts and flow.test.ts. On the right, an app box holds page.tsx and the route file api/flows/[[...path]]/route.ts, and below it sits fsdev.config.ts. Notes say to edit the prompt in chat-generator.ts to change what the model is told, and that fsdev run finds the flow at src/flows/hello-chat/flow.ts without a config file."} />

One flow gets one folder under `src/flows/`, and one block gets one file. You write the highlighted `flow.ts` in step 2 and open it whenever you want the whole flow in one place. `fsdev run` finds a flow at `src/flows/<name>/flow.ts`, so the terminal works before the app has a config file. The page, the route and the config come in step 6.

## 2. A generator that answers

```ts title="src/flows/hello-chat/blocks/chat-generator.ts"
import { generator } from "@flow-state-dev/core";
import { z } from "zod";

export const chatGenerator = generator({
  name: "chat-generator",
  model: "openai/gpt-6-luna",
  prompt: "You are a concise, friendly assistant.",
  inputSchema: z.object({ message: z.string().min(1) }),
  history: true,
  user: (input) => input.message,
  itemVisibility: { client: true, history: true },
});
```

```ts title="src/flows/hello-chat/flow.ts"
import { defineFlow } from "@flow-state-dev/core";
import { chatGenerator } from "./blocks/chat-generator";

const helloChat = defineFlow({
  kind: "hello-chat",
  requireUser: true,
  actions: {
    chat: {
      block: chatGenerator,
      userMessage: (input) => input.message,
    },
  },
});

export default helloChat();
```

`prompt` is the system instruction, sent first on every model call. Change it to change what the model is told. `model` is a `provider/model-id` string. `history: true` adds the session's earlier messages to each call, so the model remembers the conversation, and `user` builds this turn's message from the input.

`itemVisibility` is why the reply reaches the page; [Items and the stream](../reference/items.md) covers its two flags.

In `flow.ts`, `kind` is the flow's address. The action `chat` wraps a block, here the generator, and `userMessage` records the input as a user message on the session when the request starts. That record is what `history` reads on the next turn. `defineFlow` returns a factory, so the file ends by calling it once and exporting the flow.

Run it in step 3.

## 3. Run it from the terminal

```bash
pnpm fsdev run hello-chat chat -i '{"message":"Hello"}'
```

Run it from the project root. `hello-chat` is the flow's `kind` and `chat` is the action. The [CLI reference](../reference/cli.md) lists the flags, including which user the run is made as.

Stdout is one JSON event per line. Pipe it through `jq` to read the finished reply:

```bash
pnpm fsdev run hello-chat chat -i '{"message":"Hello"}' --quiet | jq -r 'select(.type=="flow_complete") | .output'
```

Besides the reply, the stream carries a trace for each block, what the model was sent, and every change to state. [Items and the stream](../reference/items.md) lists what a run emits. The run calls the real model, so it needs the key.

## 4. Add a step before it

A handler is the block for work that is not a model call. This one adds one to a count kept on the session, so the count survives between messages.

```ts title="src/flows/hello-chat/blocks/count-message.ts"
import { handler } from "@flow-state-dev/core";
import { z } from "zod";

export const countMessage = handler({
  name: "count-message",
  inputSchema: z.object({ message: z.string().min(1) }),
  sessionStateSchema: z.object({ messageCount: z.number().default(0) }),
  execute: async (_input, ctx) => {
    await ctx.session.patchState({ messageCount: ctx.session.state.messageCount + 1 });
  },
});
```

```ts title="src/flows/hello-chat/blocks/chat-pipeline.ts"
import { sequencer } from "@flow-state-dev/core";
import { z } from "zod";
import { chatGenerator } from "./chat-generator";
import { countMessage } from "./count-message";

export const chatPipeline = sequencer({
  name: "chat-pipeline",
  inputSchema: z.object({ message: z.string().min(1) }),
})
  .tap(countMessage)
  .step(chatGenerator);
```

In `flow.ts`, import `chatPipeline` from `./blocks/chat-pipeline` and give it to the action as `block: chatPipeline`.

`.step(block)` runs a block and passes its output to the next one. `.tap(block)` runs a block for its effect and keeps the previous value, so the generator receives the message the pipeline started with. That is also why `countMessage` takes the pipeline's input. `sessionStateSchema` names the slice of session state the handler uses, which types `ctx.session.state.messageCount` as a number.

Run step 3's command again. The stream has a trace for `chat-pipeline`, then `count-message`, then `chat-generator`, and a `state_change` item before the model's reply begins. The counter runs before the model, so a failed model call is counted too. [Blocks](../concepts/blocks.md) lists the other block kinds, and [Composition](../concepts/composition.md) the rest of the sequencer.

## 5. Declare the session state

Declare the count on the flow as well, and say which fields a browser may read:

```ts title="src/flows/hello-chat/flow.ts"
import { defineFlow } from "@flow-state-dev/core";
import { z } from "zod";
import { chatPipeline } from "./blocks/chat-pipeline";

const helloChat = defineFlow({
  kind: "hello-chat",
  requireUser: true,
  actions: {
    chat: {
      block: chatPipeline,
      userMessage: (input) => input.message,
    },
  },
  session: {
    stateSchema: z.object({ messageCount: z.number().default(0) }),
    client: { expose: ["messageCount"] },
  },
});

export default helloChat();
```

Blocks declare the slice of session state they use. The flow declares the whole shape, and a new session starts at the defaults. `client.expose` decides which fields the session's snapshot and `useClientData` show a browser. It does not hide the others completely: while a request runs, each `state_change` item on the stream carries the raw change, unlisted fields included. Keep anything a browser must never see out of session state.

Run twice against one session id and print each run's change to state:

```bash
pnpm fsdev run hello-chat chat -i '{"message":"Hello"}' -s demo --quiet | jq -c 'select(.type=="item_done" and .item.type=="state_change") | .item.delta'
pnpm fsdev run hello-chat chat -i '{"message":"Again"}' -s demo --quiet | jq -c 'select(.type=="item_done" and .item.type=="state_change") | .item.delta'
```

The first prints `{"messageCount":1}` and the second `{"messageCount":2}`. The second run found the first one's count because `fsdev run` keeps sessions in its SQLite store between runs. A new session id starts at 0.

The app you serve in step 6 keeps sessions in memory until you configure a store, so a restart loses the count. [Runtime configuration](../reference/runtime.md) lists the store each entry point uses, [Persistence](../concepts/persistence.md) covers the stores, and [State and scopes](../concepts/state-and-scopes.md) the three other scopes.

The handler wrote the count with `patchState`, so each `state_change` holds the new total. [State operations](../reference/state-operations.md) covers `incState` and what each operation puts in the change.

## 6. Put it on a page

A page reaches the flow through a route in your Next.js app, and the route serves the flows registered in `fsdev.config.ts`.

```ts title="fsdev.config.ts"
import { createFlowState } from "@flow-state-dev/engine";
import helloChat from "./src/flows/hello-chat/flow";

export default createFlowState({ flows: [helloChat] });
```

```ts title="app/api/flows/[[...path]]/route.ts"
import { createNextHandler } from "@flow-state-dev/next";
import flowstate from "@/fsdev.config";

export const { GET, POST, PATCH, DELETE } = createNextHandler(flowstate, {
  allowUnauthenticated: process.env.NODE_ENV !== "production",
});
export const dynamic = "force-dynamic";
```

The flow has no sign-in yet, so `allowUnauthenticated` lets the handler serve it outside production, and in production it refuses every request until the flow checks who is calling: [Auth and tenancy](../concepts/auth-and-tenancy.md). A Vercel preview runs with `NODE_ENV` set to `production`, so it refuses too. In this layout `@/` is the project root. Write the folder name with double brackets; the [HTTP API reference](../reference/http-api.md) says why. [Add to an existing app](../start/add-to-an-existing-app.md) covers the route in full.

```tsx title="app/page.tsx"
"use client";
import { useState, type FormEvent } from "react";
import { FlowProvider, ItemsRenderer, useClientData, useFlow, useSession } from "@flow-state-dev/react";

export default function Page() {
  return (
    <FlowProvider flowKind="hello-chat" userId="devuser">
      <Chat />
    </FlowProvider>
  );
}

function Chat() {
  const flow = useFlow({ autoCreateSession: true });
  const session = useSession(flow.activeSessionId);
  const { session: data } = useClientData(session, { session: ["messageCount"] });
  const [message, setMessage] = useState("");

  async function send(event: FormEvent) {
    event.preventDefault();
    const text = message.trim();
    if (!text) return;
    try {
      await session.sendAction("chat", { message: text });
      setMessage("");
    } catch {
      // session.error holds why, and the text stays for a retry
    }
  }

  return (
    <main>
      <p>Messages sent: {String(data?.messageCount ?? 0)}</p>
      <ItemsRenderer items={session.items} />
      {session.error && <p role="alert">{session.error.message}</p>}
      <form onSubmit={send}>
        <input value={message} onChange={(e) => setMessage(e.target.value)} />
        <button type="submit" disabled={!session.canSendAction || !flow.activeSessionId}>Send</button>
      </form>
    </main>
  );
}
```

`FlowProvider` gives everything beneath it the flow and the user. `useFlow` lists the user's sessions and, with `autoCreateSession`, opens one when there are none. `useSession` returns the session's `items`, and `sendAction("chat", { message })` calls the action by name. `canSendAction` is false while a request is running, and the session id is empty until `useFlow` has one, so Send waits for both. A refused send rejects and leaves the reason in `session.error`, so the form clears the text only on success. `useClientData` reads the field you exposed in step 5. `ItemsRenderer` draws the items, and the generator's messages appear because of its `itemVisibility`.

`userId` says who is chatting. `devuser` is a stand-in; a real app passes the signed-in user.

Run `pnpm dev` and open the page. Send a message: the reply streams in and `Messages sent` goes to 1.

## 7. Test it

```ts title="src/flows/hello-chat/flow.test.ts"
import { describe, expect, it } from "vitest";
import { mockGenerator, testBlock, testFlow } from "@flow-state-dev/testing";
import helloChat from "./flow";
import { countMessage } from "./blocks/count-message";

describe("hello-chat", () => {
  it("answers with the scripted reply", async () => {
    const chat = mockGenerator({ name: "chat-generator", script: [{ text: "Hi there!" }] });
    const result = await testFlow({
      flow: helloChat,
      action: "chat",
      userId: "test-user",
      input: { message: "Hello" },
      generators: { "chat-generator": chat },
    });
    expect(result.status).toBe("completed");
    expect(result.output).toBe("Hi there!");
  });

  it("adds one to the count", async () => {
    const result = await testBlock(countMessage, {
      input: { message: "Hello" },
      session: { state: { messageCount: 3 } },
    });
    expect(result.error).toBeNull();
    expect(result.state.session.messageCount).toBe(4);
  });
});
```

```bash
pnpm vitest run
```

A scripted generator from `mockGenerator` stands in for the model. Each call takes the next entry in `script`, and `{ text }` is the reply. It goes under `generators`, keyed by the generator block's `name` (`"chat-generator"`), not the action's name (`chat`). A key that matches no generator does not throw: the run comes back with `result.status` of `"failed"` and an `error.message` that begins `No mock for generator "chat-generator"`, the same message as having no mock at all. `testFlow` runs the action in-process against in-memory stores, with no server, database, network or key.

`testFlow` returns no session state, so the count is tested on its own block: `testBlock` runs one block and takes starting state under `session`. The [Testing reference](../reference/api/testing.md) lists the result fields, and what a failed run returns.

Both tests pass.

## Next

- [Blocks](../concepts/blocks.md) covers the five block kinds and what each is for.
- [Composition](../concepts/composition.md) covers the rest of the sequencer: parallel steps, conditions and loops.
- [State and scopes](../concepts/state-and-scopes.md) covers the other three scopes and what a browser may read.
- [Testing](../concepts/testing.md) covers the mocking tools and tests that run a real model.
