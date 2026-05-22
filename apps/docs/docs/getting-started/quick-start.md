---
sidebar_position: 1
---

# Quick Start

Build a streaming chat in five minutes. By the end you have a typed flow, a Next.js API route, and a React UI that talks to an LLM with conversation history.

## Prerequisites

- Node.js 20 or newer
- pnpm (or npm/yarn)
- An API key from OpenAI, Anthropic, or Google. See [Setting Up Models](/docs/getting-started/setting-up-models) for the full list.

## 1. Install

```bash
pnpm add @flow-state-dev/core @flow-state-dev/server @flow-state-dev/react zod
```

## 2. Configure your model provider

Set one API key in your shell:

```bash
export OPENAI_API_KEY=sk-...
# or
export ANTHROPIC_API_KEY=sk-ant-...
```

The framework auto-detects whichever providers it finds keys for. The example below uses `model: "preset/small"`, which resolves to the first available small-tier model across providers. For multi-provider fallback, gateways, and custom presets, see [Setting Up Models](/docs/getting-started/setting-up-models).

## 3. Define a flow

Every piece of logic in flow-state.dev is a **block** — a typed unit of work. There are four block kinds: handler, generator, sequencer, router. You'll meet all four eventually. The quick-start uses one: a generator, which calls the LLM.

A **flow** mounts blocks under named actions and packages everything for the server. `defineFlow` returns the flow factory; calling it with no arguments gives you the registerable instance.

```ts title="src/flows/hello-chat/flow.ts"
import { defineFlow, generator } from "@flow-state-dev/core";
import { z } from "zod";

const inputSchema = z.object({ message: z.string() });

const chat = generator({
  name: "chat",
  model: "preset/small",
  prompt: "You are a helpful assistant.",
  inputSchema,
  history: true,
  user: (input) => input.message,
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

The generator handles prompt assembly, streaming, and conversation history (`history: true` reads prior turns out of the session automatically). Both `user: (input) => input.message` on the generator and `userMessage: (input) => input.message` on the action wire to the same source; they are complementary contracts and the framework deduplicates equivalent content. See [Generator context > User slot](/docs/advanced/generator-context#user-slot) for the interaction.

To chain multiple blocks together, you'd compose them with a **sequencer**:

```ts
import { sequencer } from "@flow-state-dev/core";

const pipeline = sequencer({ name: "pipeline", inputSchema })
  .then(chat)
  .then(otherBlock);
```

The quick-start doesn't need one yet. [Your First Flow](/docs/getting-started/your-first-flow) walks through composing blocks step-by-step.

## 4. Mount the server

One catch-all route gives you action dispatch, SSE streaming, and session state:

```ts title="app/api/flows/[...path]/route.ts"
import { createFlowApiRouter, createFlowRegistry } from "@flow-state-dev/server";
import chatFlow from "@/flows/hello-chat/flow";

const registry = createFlowRegistry();
registry.register(chatFlow);

const router = createFlowApiRouter({ registry });

export const GET = router.GET;
export const POST = router.POST;
export const DELETE = router.DELETE;
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

- **[Your First Flow](/docs/getting-started/your-first-flow)** — A narrative walkthrough that explains each concept as you build.
- **[Setting Up Models](/docs/getting-started/setting-up-models)** — Provider keys, presets, gateways, custom resolvers.
- **[Project Structure](/docs/getting-started/project-structure)** — How to organize flows, blocks, and tools.
- **[Blocks](/docs/fundamentals/blocks)** — The four block kinds in depth.
