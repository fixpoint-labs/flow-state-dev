---
sidebar_position: 1
---

# Quick Start

Build your first flow in 5 minutes. This guide walks you through defining a simple chat flow, setting up the server, and connecting a React frontend.

## Prerequisites

- Node.js >= 18 (Node 20+ recommended)
- pnpm (or npm/yarn)

## 1. Install Packages

```bash
pnpm add @flow-state-dev/core @flow-state-dev/server @flow-state-dev/client @flow-state-dev/react zod
```

## 2. Define a Flow

Create a file for your flow definition:

```ts title="src/flows/hello-chat/flow.ts"
import { defineFlow, generator, sequencer } from "@flow-state-dev/core";
import { z } from "zod";

// Define a generator block for LLM interaction
const chatGen = generator({
  name: "chat",
  model: "gpt-5-mini",
  prompt: "You are a helpful assistant.",
  inputSchema: z.object({ message: z.string() }),
  user: (input) => input.message,
});

// Create a pipeline
const pipeline = sequencer({
  name: "chat-pipeline",
  inputSchema: z.object({ message: z.string() }),
}).then(chatGen);

// Define and export the flow
const chatFlow = defineFlow({
  kind: "hello-chat",
  actions: {
    chat: {
      inputSchema: z.object({ message: z.string() }),
      block: pipeline,
      userMessage: (input) => input.message,
    },
  },
  session: {
    stateSchema: z.object({}),
  },
});

export default chatFlow({ id: "default" });
```

**What's happening here:**
- `generator` creates an LLM-calling block with a prompt and input schema
- `sequencer` chains blocks into a pipeline
- `defineFlow` declares the flow with its actions and session config
- The final `chatFlow({ id: "default" })` creates a flow instance

## 3. Set Up the Server

Create an API route that registers your flow and handles requests:

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

This gives you a full REST API with SSE streaming at `/api/flows/`.

## 4. Connect the React Frontend

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
          Send
        </button>
      </form>
    </div>
  );
}
```

**What's happening here:**
- `FlowProvider` sets up the flow context with `flowKind` and `userId`
- `useFlow` manages session lifecycle (creates one automatically)
- `useSession` provides items, streaming status, and `sendAction`
- `ItemRenderer` renders each streamed item using registered renderers

## 5. Run It

```bash
pnpm dev
```

Open your browser and start chatting. The framework handles:
- Action dispatch and validation
- SSE streaming with automatic reconnection
- Session state persistence
- Item rendering in the UI

## Next Steps

- [Installation](/docs/getting-started/installation) — Package options and configuration
- [Project Structure](/docs/getting-started/project-structure) — How to organize your flow project
- [Concepts: Blocks](/docs/concepts/blocks) — Deep dive into the four block kinds
- [Guide: Building a Chat App](/docs/guides/building-a-chat-app) — Complete walkthrough with state, tools, and UI
