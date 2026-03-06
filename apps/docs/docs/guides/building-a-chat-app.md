---
sidebar_position: 1
---

# Building a Chat App

This guide walks you through building a complete chat application — from blocks to React UI to deterministic tests. Along the way, you'll see how conversation history, session state, clientData, and streaming fit together.

## What we're building

A chat app where:
- An LLM generates responses via a generator block
- A handler tracks message count in session state
- A clientData function exposes the count to the React UI
- Items stream to the frontend in real time
- Tests run deterministically with mocked generators

## 1. Define the blocks

### The generator — talks to the LLM

```ts title="src/flows/hello-chat/blocks/chat-gen.ts"
import { generator } from "@flow-state-dev/core";
import { z } from "zod";

export const chatGen = generator({
  name: "chat",
  model: "gpt-5-mini",
  prompt: "You are a helpful assistant. Be concise and friendly.",
  inputSchema: z.object({ message: z.string() }),
  history: (_input, ctx) => ctx.session.items.llm(),
  user: (input) => input.message,
});
```

The `history` slot loads prior conversation from persisted request items. `session.items.llm()` returns completed messages in `{role, content}` format — the framework handles filtering and formatting. The `user` slot extracts the current message from input.

### The handler — tracks usage

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

Notice the **partial state schema** — this handler only declares `messageCount`. It doesn't need to know about any other session state fields. `incState` is an atomic increment — safe even under concurrent requests.

## 2. Compose the pipeline and flow

```ts title="src/flows/hello-chat/flow.ts"
import { defineFlow, sequencer } from "@flow-state-dev/core";
import { z } from "zod";
import { chatGen } from "./blocks/chat-gen";
import { counter } from "./blocks/counter";

const inputSchema = z.object({ message: z.string() });

const pipeline = sequencer({ name: "chat-pipeline", inputSchema })
  .then(chatGen)
  .then(counter);

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
    stateSchema: z.object({
      messageCount: z.number().default(0),
    }),

    clientData: {
      messageCount: (ctx) => ctx.state.messageCount ?? 0,
    },
  },
});

export default chatFlow({ id: "default" });
```

Key details:
- The sequencer chains `chatGen` then `counter` — every message gets an LLM response and increments the count
- `userMessage: (input) => input.message` tells the framework to emit a user-role message item before execution, so the conversation stream shows what the user said
- The `messageCount` clientData function exposes the count to the React UI — this is the *only* way the client sees this value

## 3. Set up the server

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

Three lines of setup. You now have action execution, session management, SSE streaming, and state snapshots.

## 4. Build the React UI

```tsx title="src/components/ChatApp.tsx"
import {
  FlowProvider,
  ItemRenderer,
  useFlow,
  useSession,
  useClientData,
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

  const clientData = useClientData(session, {
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
        <span>{clientData.session?.messageCount ?? 0} messages</span>
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
          {session.isStreaming ? "Thinking..." : "Send"}
        </button>
      </form>
    </div>
  );
}
```

What each hook does:
- `useFlow({ autoCreateSession: true })` — creates a session on mount, tracks the active session ID
- `useSession(id, { items: { visibility: "ui" } })` — connects to the SSE stream, delivers items in real time, provides `sendAction` and `isStreaming`
- `useClientData(session, { session: ["messageCount"] })` — reads the `messageCount` clientData from the latest state snapshot

## 5. Write tests

No real LLM calls. No network. Deterministic results:

```ts title="src/flows/hello-chat/__tests__/flow.test.ts"
import { testFlow } from "@flow-state-dev/testing";
import chatFlow from "../flow";

test("chat action streams a response and increments count", async () => {
  const result = await testFlow({
    flow: chatFlow,
    action: "chat",
    input: { message: "Hello!" },
    userId: "testuser",
    generators: {
      chat: { output: "Hi there!" },
    },
  });

  // User message was emitted
  expect(result.items).toContainEqual(
    expect.objectContaining({ type: "message", role: "user" })
  );

  // Assistant message was emitted
  expect(result.items).toContainEqual(
    expect.objectContaining({ type: "message", role: "assistant" })
  );

  // State was updated
  expect(result.session.state.messageCount).toBe(1);
});

test("message count accumulates across requests", async () => {
  const result = await testFlow({
    flow: chatFlow,
    action: "chat",
    input: { message: "Second message" },
    userId: "testuser",
    seed: {
      session: { state: { messageCount: 3 } },
    },
    generators: {
      chat: { output: "Response" },
    },
  });

  expect(result.session.state.messageCount).toBe(4);
});
```

The test harness creates an isolated runtime with in-memory stores, mocks the generator, and executes the full action pipeline — validation, session resolution, block execution, state persistence, lifecycle hooks. Same contracts as production.

## Next steps

- Add **[custom renderers](/docs/guides/react-integration)** to style messages, reasoning, and components
- Add **tools** to the generator for [function calling](/docs/concepts/blocks#generator--the-ai-block) (search, create artifacts, etc.)
- Use **[sequencer patterns](/docs/guides/sequencer-patterns)** for conditional logic, parallelism, and error recovery
- Add **resources and clientData** for richer state — see the [kitchen-sink example](https://github.com/fixpoint-labs/flow-state-dev) for a full demonstration
