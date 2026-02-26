---
sidebar_position: 1
---

# Building a Chat App

This guide walks you through building a complete chat application with Flow State Dev — from flow definition to React UI.

## What We're Building

A chat app with:
- LLM-powered responses via a generator block
- Message counting via a handler block
- Session state persistence
- Streaming responses in a React UI

## 1. Define the Blocks

### Generator Block

```ts title="src/flows/hello-chat/blocks/chat-gen.ts"
import { generator } from "@flow-state-dev/core";
import { z } from "zod";

export const chatGen = generator({
  name: "chat",
  model: "gpt-5-mini",
  prompt: "You are a helpful assistant. Be concise and friendly.",
  inputSchema: z.object({ message: z.string() }),
  user: (input) => input.message,
});
```

### Counter Handler

```ts title="src/flows/hello-chat/blocks/counter.ts"
import { handler } from "@flow-state-dev/core";
import { z } from "zod";

export const counter = handler({
  name: "counter",
  inputSchema: z.any(),
  outputSchema: z.any(),
  sessionStateSchema: z.object({ messageCount: z.number().default(0) }),
  execute: async (input, ctx) => {
    await ctx.session.incState({ messageCount: 1 });
    return input;
  },
});
```

## 2. Compose the Pipeline

```ts title="src/flows/hello-chat/flow.ts"
import { defineFlow, sequencer } from "@flow-state-dev/core";
import { z } from "zod";
import { chatGen } from "./blocks/chat-gen";
import { counter } from "./blocks/counter";

const pipeline = sequencer({
  name: "chat-pipeline",
  inputSchema: z.object({ message: z.string() }),
})
  .then(chatGen)
  .then(counter);

const chatFlow = defineFlow({
  kind: "hello-chat",
  requireUser: true,

  actions: {
    chat: {
      inputSchema: z.object({ message: z.string() }),
      block: pipeline,
      userMessage: (input) => input.message,
    },
  },

  session: {
    stateSchema: z.object({
      messageCount: z.number().default(0),
    }),

    projections: {
      messageCount: {
        client: true,
        compute: (ctx) => ctx.session.state.messageCount ?? 0,
      },
    },
  },
});

export default chatFlow({ id: "default" });
```

**What this does:**
- The sequencer chains `chatGen` → `counter`, so every chat message gets an LLM response and increments the count
- `userMessage: (input) => input.message` emits the user's input as a visible message item
- The `messageCount` projection exposes the count to the React UI

## 3. Set Up the Server

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

## 4. Build the React UI

```tsx title="src/components/ChatApp.tsx"
import {
  FlowProvider,
  ItemRenderer,
  useFlow,
  useSession,
  useProjections,
} from "@flow-state-dev/react";

function ChatApp() {
  return (
    <FlowProvider flowKind="hello-chat" userId="devuser">
      <ChatUI />
    </FlowProvider>
  );
}

function ChatUI() {
  const flow = useFlow({ autoCreateSession: true });
  const session = useSession(flow.activeSessionId, {
    items: { visibility: "ui" },
  });

  const projections = useProjections(session, {
    session: ["messageCount"],
  });

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const message = new FormData(form).get("message") as string;
    if (message.trim()) {
      session.sendAction("chat", { message });
      form.reset();
    }
  };

  return (
    <div>
      <header>
        <h1>Chat</h1>
        <span>Messages: {projections.session?.messageCount ?? 0}</span>
      </header>

      <div>
        {session.items.map((item) => (
          <ItemRenderer key={item.id} item={item} />
        ))}
      </div>

      <form onSubmit={handleSubmit}>
        <input
          name="message"
          placeholder="Type a message..."
          autoComplete="off"
        />
        <button type="submit" disabled={session.isStreaming}>
          {session.isStreaming ? "Sending..." : "Send"}
        </button>
      </form>
    </div>
  );
}
```

## 5. Test It

```ts title="src/flows/hello-chat/__tests__/flow.test.ts"
import { testFlow } from "@flow-state-dev/testing";
import chatFlow from "../flow";

test("chat action increments message count", async () => {
  const result = await testFlow({
    flow: chatFlow,
    action: "chat",
    input: { message: "Hello!" },
    userId: "testuser",
    generators: {
      chat: { output: "Hi there!" },
    },
  });

  expect(result.session.state.messageCount).toBe(1);
  expect(result.items).toContainEqual(
    expect.objectContaining({ type: "message", role: "user" })
  );
});
```

## Next Steps

- Add [custom renderers](/docs/guides/react-integration) for message styling
- Add tools to the generator for [function calling](/docs/concepts/blocks#generator)
- Use [sequencer patterns](/docs/guides/sequencer-patterns) for branching and error recovery
