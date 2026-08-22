---
sidebar_position: 1
---

# Quick Start

Build a streaming chat in five minutes. By the end you have a typed flow, a Next.js API route, and a React UI that talks to an LLM with conversation history.

## Prerequisites

- Node.js 22 or newer
- pnpm (or npm/yarn)
- An API key from OpenAI, Anthropic, or Google. See [Setting Up Models](/docs/getting-started/setting-up-models) for the full list.

## 1. Install

```bash
pnpm add @flow-state-dev/core @flow-state-dev/engine @flow-state-dev/react zod
pnpm add -D @flow-state-dev/fsdev
```

Add the SDK package for whichever provider you have a key for. The framework loads it from your app, so at least one has to be installed:

```bash
pnpm add @ai-sdk/openai
# or: @ai-sdk/anthropic, or @ai-sdk/google
```

## 2. Configure your model provider

Set one API key in your shell:

```bash
export OPENAI_API_KEY=sk-...
# or
export ANTHROPIC_API_KEY=sk-ant-...
# or
export GOOGLE_GENERATIVE_AI_API_KEY=...
```

The framework auto-detects whichever providers it finds keys for.

Generators in this guide ask for `intent/chat` instead of naming a model. An **intent** is a name you point at an ordered list of models; the framework picks the first candidate it has both a key and an installed SDK package for. You declare that list once, in step 4. That's why the same block code runs whichever of the three keys you set, and why swapping models later is a config edit rather than a search across your blocks.

For gateways and the full set of options, see [Setting Up Models](/docs/getting-started/setting-up-models).

## 3. Define a flow

Every piece of logic in flow-state.dev is a **block** — a typed unit of work. There are four block kinds: handler, generator, sequencer, router. You'll meet all four eventually. The quick-start uses one: a generator, which calls the LLM.

A **flow** mounts blocks under named actions and packages everything for the server. `defineFlow` returns the flow factory; calling it with no arguments gives you the registerable instance.

```ts title="src/flows/hello-chat/flow.ts"
import { defineFlow, generator } from "@flow-state-dev/core";
import { z } from "zod";

const inputSchema = z.object({ message: z.string() });

const chat = generator({
  name: "chat",
  model: "intent/chat",
  prompt: "You are a helpful assistant.",
  inputSchema,
  history: true,
  user: (input) => input.message,
  itemVisibility: { client: true, history: true },
});

export default defineFlow({
  kind: "hello-chat",
  actions: {
    chat: {
      inputSchema,
      block: chat,
      userMessage: (input) => input.message,
    },
  },
  session: {
    stateSchema: z.object({}),
  },
})();
```

The generator handles prompt assembly, streaming, and conversation history (`history: true` reads prior turns out of the session automatically). `user` is this turn's model input. `userMessage` is the stored user-visible text. Point both at `input.message`. The [user slot](/docs/advanced/generator-context#user-slot) page covers how those two fields interact. [Block options](/docs/configuration/blocks) lists every generator field.

To chain multiple blocks together, you'd compose them with a **sequencer**:

```ts
import { sequencer } from "@flow-state-dev/core";

const pipeline = sequencer({ name: "pipeline", inputSchema })
  .step(chat)
  .step(otherBlock);
```

The quick-start doesn't need one yet. [Your First Flow](/docs/getting-started/your-first-flow) walks through composing blocks step-by-step.

## 4. Mount the server

Describe the runtime once, then mount it with one catch-all route. That route gives you action dispatch, SSE streaming, and session state:

```ts title="lib/flowstate.ts"
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import chatFlow from "@/flows/hello-chat/flow";

export const flowstate = createFlowState({
  flows: { chatFlow },
  models: {
    default: "openai/gpt-5.4-mini",
    intents: {
      chat: [
        "anthropic/claude-sonnet-4-6",
        "openai/gpt-5.4-mini",
        "google/gemini-3.1-pro",
      ],
    },
  },
  stores: { default: { primary: inMemoryStores() } },
});
```

This is where `intent/chat` gets its meaning. The framework takes the first candidate you have a key and an SDK package for, so whichever key you set in step 2 is the one that runs. `default` covers the case where none of an intent's candidates are reachable; declaring any intent makes it required, and it's a plain model string, so point it at a provider you have a key for.

```ts title="app/api/flows/[...path]/route.ts"
import { flowstate } from "@/lib/flowstate";
import { createVercelNextHandler } from "@flow-state-dev/vercel/next";

export const { GET, POST, PATCH, DELETE } = createVercelNextHandler(flowstate);
export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";
```

That's it for the backend. You now have action execution, SSE streaming with resume, and session persistence under `/api/flows/`.

## 5. Render in React

`useSession` exposes the live item stream, streaming status, and `sendAction`. `ItemsRenderer` is the default plural renderer — it dispatches messages, reasoning, tool output, and errors to the framework's built-in renderers without you having to wire each one up.

```tsx title="src/app/page.tsx"
"use client";
import { FlowProvider, ItemsRenderer, useFlow, useSession } from "@flow-state-dev/react";

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

  return (
    <div>
      <ItemsRenderer items={session.items} />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          const message = new FormData(e.currentTarget).get("message") as string;
          session.sendAction("chat", { message });
          e.currentTarget.reset();
        }}
      >
        <input name="message" placeholder="Type a message..." />
        <button type="submit" disabled={session.isStreaming}>
          {session.isStreaming ? "Working..." : "Send"}
        </button>
      </form>
    </div>
  );
}
```

## 6. Run it

```bash
pnpm dev
```

Open the page and start chatting. Behind the scenes you have streaming over SSE with reconnect, conversation history, session state, and typed validation on every input.

## Skip the React layer

You don't need a server or UI to try a flow. The CLI runs it directly and streams NDJSON to stdout:

```bash
fsdev run hello-chat chat -i '{"message": "Hello!"}'
```

Or open the visual inspector with `fsdev dev` — see the [DevTool guide](/docs/devtool/setup).

## Next steps

- **[Your First Flow](/docs/getting-started/your-first-flow)** — The same app, with the why for each piece.
- **[Anatomy of a Flow](/guides/anatomy-of-a-flow)** — Mental model without a project to build.
- **[Block options](/docs/configuration/blocks)** and **[Flow options](/docs/configuration/flow)** — field catalogs next to those concepts.
- **[Project Structure](/docs/getting-started/project-structure)** — How to organize flows, blocks, and tools.
- **[Blocks](/docs/fundamentals/blocks)** — The four block kinds in depth.
