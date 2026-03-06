---
sidebar_position: 1
---

# Quick Start

Build a streaming chat app in 5 minutes. By the end, you'll have an LLM-powered chat with conversation history, session state, and a React UI — all type-safe, all streaming.

## Prerequisites

- Node.js >= 18 (Node 20+ recommended)
- pnpm (or npm/yarn)

## 1. Install packages

```bash
pnpm add @flow-state-dev/core @flow-state-dev/server @flow-state-dev/client @flow-state-dev/react zod
```

## 2. Define your flow

This is where you describe what your AI does. A generator calls the LLM. A handler tracks state. A sequencer wires them together. `defineFlow` makes it deployable.

```ts title="src/flows/hello-chat/flow.ts"
import { defineFlow, generator, handler, sequencer } from "@flow-state-dev/core";
import { z } from "zod";

const inputSchema = z.object({ message: z.string() });

// Generator: calls the LLM with conversation history
const chatGen = generator({
  name: "chat",
  model: "gpt-5-mini",
  prompt: "You are a helpful assistant.",
  inputSchema,
  history: (_input, ctx) => ctx.session.items.llm(),
  user: (input) => input.message,
});

// Handler: increments a message counter after each exchange
const counter = handler({
  name: "counter",
  inputSchema: z.string(),
  outputSchema: z.string(),
  sessionStateSchema: z.object({ messageCount: z.number().default(0) }),
  execute: async (input, ctx) => {
    await ctx.session.incState({ messageCount: 1 });
    return input;
  },
});

// Pipeline: generator → counter
const pipeline = sequencer({ name: "chat-pipeline", inputSchema })
  .then(chatGen)
  .then(counter);

// Flow definition
const chatFlow = defineFlow({
  kind: "hello-chat",
  requireUser: true,
  actions: {
    chat: {
      inputSchema,
      block: pipeline,
      userMessage: (input) => input.message,
    },
  },
  session: {
    stateSchema: z.object({ messageCount: z.number().default(0) }),
  },
});

export default chatFlow({ id: "default" });
```

**What's happening:** The generator handles the LLM call — prompt assembly, streaming, conversation history. The handler is a pure function that bumps a counter. The sequencer pipes the generator's output into the handler. `defineFlow` wraps it all with actions, session state, and lifecycle management.

## 3. Set up the server

One catch-all route gives you a complete API with SSE streaming:

```ts title="app/api/flows/[...path]/route.ts"
import { createFlowRegistry, createFlowApiRouter } from "@flow-state-dev/server";
import chatFlow from "@/flows/hello-chat/flow";

const registry = createFlowRegistry();
registry.register(chatFlow);

const router = createFlowApiRouter({ registry });

export const GET = router.GET;
export const POST = router.POST;
export const DELETE = router.DELETE;
```

That's it. You now have action execution, session management, SSE streaming with resume, and state snapshots at `/api/flows/`.

## 4. Connect the React frontend

The hooks handle streaming, reconnection, and state sync. You just render:

```tsx title="src/app/page.tsx"
import { FlowProvider, ItemRenderer, useFlow, useSession } from "@flow-state-dev/react";

function App() {
  return (
    <FlowProvider flowKind="hello-chat" userId="devuser">
      <ChatUI />
    </FlowProvider>
  );
}

function ChatUI() {
  const flow = useFlow({ autoCreateSession: true });
  const session = useSession(flow.activeSessionId);

  return (
    <div>
      {session.items.map((item) => (
        <ItemRenderer key={item.id} item={item} />
      ))}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          const input = new FormData(e.currentTarget).get("message") as string;
          session.sendAction("chat", { message: input });
          e.currentTarget.reset();
        }}
      >
        <input name="message" placeholder="Type a message..." />
        <button type="submit" disabled={session.isStreaming}>
          {session.isStreaming ? "Thinking..." : "Send"}
        </button>
      </form>
    </div>
  );
}
```

**What's happening:** `FlowProvider` sets up the flow context. `useFlow` creates a session automatically. `useSession` gives you live-updating items, streaming status, and `sendAction`. `ItemRenderer` renders each streamed item. The framework handles SSE connection, reconnection, and state sync behind the scenes.

## 5. Run it

```bash
pnpm dev
```

Open your browser and start chatting. The framework is handling:
- Input validation against your Zod schema
- Action dispatch and async block execution
- SSE streaming with automatic reconnection and resume
- Session state persistence across requests
- Conversation history assembly for the LLM
- Item rendering in the UI

## Next steps

- **[Installation](/docs/getting-started/installation)** — Package options, peer dependencies, TypeScript config
- **[Project Structure](/docs/getting-started/project-structure)** — How to organize flows, blocks, and tools
- **[Blocks](/docs/concepts/blocks)** — Deep dive into handler, generator, sequencer, and router
- **[Building a Chat App](/docs/guides/building-a-chat-app)** — Full walkthrough with state, clientData, tools, and tests
